"""HTTP API. Run: uvicorn falmex.api:app --reload"""

import io
from contextlib import asynccontextmanager

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

from falmex import __version__, services, synthetic
from falmex.ai import get_provider, interpret_finding, summarize_findings
from falmex.ai.providers import LLMError, LLMProvider
from falmex.analysis.base import available_analyzers
from falmex.engine import DiscoveryConfig, run_discovery
from falmex.findings import Finding, Status
from falmex.ingest import UnsupportedFileError
from falmex.ingest.base import supported_extensions
from falmex.schema import Schema
from falmex.settings import Settings, get_settings
from falmex.storage import DatasetRecord, Filter, Store
from falmex.validation import available_validators

MAX_UPLOAD_BYTES = 200 * 1024 * 1024


class QueryRequest(BaseModel):
    filters: list[Filter] = []
    limit: int = Field(100, ge=1, le=5000)
    offset: int = Field(0, ge=0)
    sort: str | None = None
    descending: bool = False


class CompareRequest(BaseModel):
    experiment_ids: list[str] = Field(min_length=1, max_length=50)


class DiscoverRequest(BaseModel):
    outcomes: list[str] | None = None
    analyzers: list[str] | None = None
    validators: list[str] | None = None
    test_fraction: float | None = Field(None, gt=0, lt=0.9)
    alpha: float | None = Field(None, gt=0, lt=0.5)


class SyntheticRequest(BaseModel):
    n_experiments: int = Field(200, ge=10, le=100_000)
    seed: int = 0


def create_app(settings: Settings | None = None, provider: LLMProvider | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.store = Store(settings.data_dir)
        app.state.schema = Schema.load(settings.schema_path)
        app.state.provider = provider or get_provider(settings)
        yield
        app.state.store.close()

    app = FastAPI(title="Falmex API", version=__version__, lifespan=lifespan)
    app.add_middleware(
        CORSMiddleware, allow_origins=settings.cors_origins, allow_methods=["*"],
        allow_headers=["*"],
    )

    def store(request: Request) -> Store:
        return request.app.state.store

    def schema(request: Request) -> Schema:
        return request.app.state.schema

    def dataset_or_404(request: Request, dataset_id: str) -> DatasetRecord:
        ds = store(request).get_dataset(dataset_id)
        if ds is None:
            raise HTTPException(404, f"Dataset '{dataset_id}' not found")
        return ds

    def finding_or_404(request: Request, finding_id: str) -> Finding:
        raw = store(request).get_finding(finding_id)
        if raw is None:
            raise HTTPException(404, f"Finding '{finding_id}' not found")
        return Finding(**raw)

    # ---- meta ---------------------------------------------------------------
    @app.get("/health")
    def health(request: Request):
        p = request.app.state.provider
        return {"status": "ok", "version": __version__, "llm": {"provider": p.name,
                                                               "model": p.model}}

    @app.get("/api/meta")
    def meta(request: Request):
        return {
            "variables": [
                {"name": v.name, "role": v.role, "type": v.type, "unit": v.unit,
                 "description": v.description}
                for v in schema(request).variables.values()
            ],
            "analyzers": available_analyzers(),
            "validators": available_validators(),
            "file_types": supported_extensions(),
        }

    # ---- datasets -----------------------------------------------------------
    @app.post("/api/datasets", status_code=201)
    async def upload(
        request: Request, file: UploadFile = File(...), name: str | None = Form(None),
        synthetic_data: bool = Form(False),
    ):
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File too large")
        try:
            dataset, source, assets = services.ingest_upload(
                store(request), schema(request), file.filename or "upload", content,
                name=name, synthetic=synthetic_data,
            )
        except UnsupportedFileError as exc:
            raise HTTPException(415, str(exc)) from exc
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(422, f"Could not read file: {exc}") from exc
        return {"dataset": dataset, "source": source, "assets": assets}

    @app.post("/api/datasets/synthetic", status_code=201)
    def create_synthetic(request: Request, body: SyntheticRequest):
        frame = synthetic.generate(body.n_experiments, body.seed)
        buf = io.BytesIO()
        frame.to_csv(buf, index=False)
        dataset, _, _ = services.ingest_upload(
            store(request), schema(request), f"synthetic_seed{body.seed}_n{body.n_experiments}.csv",
            buf.getvalue(), name=f"SYNTHETIC test data (seed {body.seed})", synthetic=True,
        )
        return {"dataset": dataset}

    @app.get("/api/datasets")
    def list_datasets(request: Request):
        return store(request).list_datasets()

    @app.get("/api/datasets/{dataset_id}")
    def get_dataset(request: Request, dataset_id: str):
        ds = dataset_or_404(request, dataset_id)
        frame = store(request).load_frame(dataset_id)
        return {"dataset": ds, "columns": services.column_stats(frame, schema(request)),
                "sources": store(request).get_sources(ds.source_ids)}

    @app.post("/api/datasets/{dataset_id}/query")
    def query(request: Request, dataset_id: str, body: QueryRequest):
        dataset_or_404(request, dataset_id)
        try:
            rows, total = store(request).query_rows(
                dataset_id, body.filters, body.limit, body.offset, body.sort, body.descending
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {"rows": rows, "total": total, "limit": body.limit, "offset": body.offset}

    @app.get("/api/datasets/{dataset_id}/experiments/{experiment_id}")
    def experiment(request: Request, dataset_id: str, experiment_id: str):
        dataset_or_404(request, dataset_id)
        id_col = schema(request).id_column
        rows, total = store(request).query_rows(
            dataset_id, [Filter(field=id_col, op="eq", value=experiment_id)], limit=5000
        )
        if not total:
            raise HTTPException(404, f"Experiment '{experiment_id}' not found")
        findings = [
            f for f in services.load_findings(store(request), dataset_id)
            if experiment_id in f.evidence.experiment_ids
        ]
        return {"experiment_id": experiment_id, "rows": rows,
                "findings": [{"finding_id": f.finding_id, "headline": f.headline,
                              "status": f.status} for f in findings]}

    @app.post("/api/datasets/{dataset_id}/compare")
    def compare(request: Request, dataset_id: str, body: CompareRequest):
        dataset_or_404(request, dataset_id)
        frame = store(request).load_frame(dataset_id)
        try:
            rows = services.compare_experiments(frame, schema(request), body.experiment_ids)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        return {"experiments": rows}

    # ---- discovery & findings -----------------------------------------------
    @app.post("/api/datasets/{dataset_id}/discover")
    def discover(request: Request, dataset_id: str, body: DiscoverRequest | None = None):
        body = body or DiscoverRequest()
        ds = dataset_or_404(request, dataset_id)
        cfg = DiscoveryConfig(
            analyzers=body.analyzers, validators=body.validators, outcomes=body.outcomes,
            test_fraction=body.test_fraction or settings.test_fraction,
            alpha=body.alpha or settings.alpha, min_samples=settings.min_samples,
            seed=settings.random_seed,
        )
        try:
            findings = run_discovery(
                store(request).load_frame(dataset_id), schema(request), dataset_id=dataset_id,
                synthetic=ds.synthetic, sources=services.source_refs(store(request), ds),
                config=cfg,
            )
        except (ValueError, KeyError) as exc:
            raise HTTPException(422, str(exc)) from exc
        store(request).save_findings(dataset_id, [f.model_dump(mode="json") for f in findings])
        counts = {s.value: sum(f.status == s for f in findings) for s in Status}
        return {"dataset_id": dataset_id, "tested": len(findings), "by_status": counts,
                "findings": findings}

    @app.get("/api/findings")
    def list_findings(
        request: Request, dataset_id: str | None = None, status: Status | None = None,
        outcome: str | None = None, condition: str | None = None, limit: int = 100,
    ):
        findings = services.load_findings(store(request), dataset_id)
        if status:
            findings = [f for f in findings if f.status == status]
        if outcome:
            findings = [f for f in findings if f.outcome == outcome]
        if condition:
            findings = [f for f in findings if f.condition == condition]
        findings.sort(key=lambda f: f.score, reverse=True)
        return findings[:limit]

    @app.get("/api/findings/{finding_id}")
    def get_finding(request: Request, finding_id: str):
        return finding_or_404(request, finding_id)

    @app.post("/api/findings/{finding_id}/interpret")
    def interpret(request: Request, finding_id: str, force: bool = False):
        finding = finding_or_404(request, finding_id)
        if finding.interpretation and not force:
            return finding
        try:
            finding.interpretation = interpret_finding(finding, request.app.state.provider)
        except LLMError as exc:
            raise HTTPException(502, str(exc)) from exc
        store(request).update_finding(finding.model_dump(mode="json"))
        return finding

    @app.get("/api/datasets/{dataset_id}/summary")
    def summary(request: Request, dataset_id: str):
        dataset_or_404(request, dataset_id)
        findings = sorted(services.load_findings(store(request), dataset_id),
                          key=lambda f: f.score, reverse=True)
        if not findings:
            raise HTTPException(409, "Run discovery first")
        try:
            return summarize_findings(findings, request.app.state.provider)
        except LLMError as exc:
            raise HTTPException(502, str(exc)) from exc

    return app


app = create_app()
