"""HTTP API. Run: uvicorn falmex.api:app --reload"""

import io
import math
import re
import uuid
from contextlib import asynccontextmanager
from datetime import UTC, datetime
from functools import lru_cache

from fastapi import FastAPI, File, Form, HTTPException, Request, UploadFile
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, JSONResponse
from pydantic import BaseModel, ConfigDict, Field

from falmex import (
    __version__,
    deep,
    flammability,
    questions,
    scientific_review,
    services,
    synthetic,
    trend,
    vision,
)
from falmex.ai import (
    get_provider,
    interpret_finding,
    search_plan,
    suggest_innovations,
    summarize_findings,
)
from falmex.ai.providers import LLMError, LLMProvider
from falmex.analysis.base import available_analyzers
from falmex.assistant import router as assistant_router
from falmex.engine import DiscoveryConfig, run_discovery
from falmex.evidence_chat import chat_router
from falmex.findings import (
    DEFAULT_WEIGHTS,
    Finding,
    Insight,
    Novelty,
    PriorKnowledge,
    Reference,
    SafetyArea,
    Status,
)
from falmex.ingest import UnsupportedFileError
from falmex.ingest.base import supported_extensions
from falmex.innovation import Innovation, InnovationKind, Stage
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
    """A discovery goal. Empty = open exploration of every condition and outcome."""

    goal: str | None = None  # the question in words, stored with the findings
    outcomes: list[str] | None = None
    conditions: list[str] | None = None
    # columns outside the standard schema, analysed in the role given here
    extra_outcomes: list[str] = []
    extra_conditions: list[str] = []
    weights: dict[str, float] | None = None  # ranking weights (see /api/meta)
    # what to keep together when splitting discovery / held-out data: the experiment ID by
    # default, or e.g. "_source_id" or a campaign column when experiments are not independent
    split_by: str | None = None
    analyzers: list[str] | None = None
    validators: list[str] | None = None
    test_fraction: float | None = Field(None, gt=0, lt=0.9)
    alpha: float | None = Field(None, gt=0, lt=0.5)


class ProbeRequest(BaseModel):
    probe: str
    params: dict = {}


class InsightRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)  # '   ' is empty

    statement: str = Field(min_length=10)
    scientific_interpretation: str = Field(min_length=10)
    fire_safety_relevance: str = Field(min_length=5)
    reviewer: str = Field(min_length=2)
    references: list[str] = []
    limitations: str = ""
    safety_areas: list[SafetyArea] = []
    related_finding_ids: list[str] = []


class PriorKnowledgeRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)  # '   ' is empty

    novelty: Novelty
    summary: str = Field(min_length=5)
    references: list[Reference] = []
    reviewer: str = Field(min_length=2)


class InnovationRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)  # '   ' is empty

    title: str = Field(min_length=3)
    kind: InnovationKind
    enables: str = Field(min_length=5)
    description: str = ""
    insight_ids: list[str] = Field(min_length=1)
    proposed_by: str = Field(min_length=2)


class InnovationUpdate(BaseModel):
    stage: Stage | None = None
    decision_note: str | None = None


class AnalyzeMediaRequest(BaseModel):
    fps: float | None = Field(None, gt=0, le=1_000_000)  # overrides the file's frame rate
    mm_per_px: float | None = Field(None, gt=0)  # calibration; lengths stay in px without it


class AttachMediaRequest(BaseModel):
    dataset_id: str
    experiment_id: str


class FlammabilityRequest(BaseModel):
    axis: str = "gravity"
    material: str | None = None
    pressure: float | None = Field(None, gt=0)
    at_x: float | None = None  # e.g. the gravity of the chosen environment
    at_oxygen: float | None = Field(None, gt=0, le=100)


class ReferenceLimitRequest(BaseModel):
    model_config = ConfigDict(str_strip_whitespace=True)  # '   ' is empty

    material: str = Field(min_length=1)
    kind: str = Field("MOC", min_length=2)
    oxygen_percent: float = Field(gt=0, le=100)
    pressure_kpa: float | None = Field(None, gt=0)
    gravity_g: float | None = Field(None, ge=0)
    flow_cm_s: float | None = Field(None, ge=0)
    source: str = Field(min_length=5)
    url: str = Field("", pattern=r"^(https?://\S+)?$")  # a javascript: link would run on click
    note: str = ""
    entered_by: str = Field(min_length=2)


# columns added to an experiment from its analyzed footage; lengths only when calibrated
FOOTAGE_COLUMNS = {
    "flame_circularity": ("circularity_median", False),
    "flame_blue_fraction": ("blue_fraction_median", False),
    "flame_soot_blue_ratio": ("soot_to_blue_ratio", False),
    "flame_growth_rate": ("growth_rate", True),
    "flame_extinction_radius": ("extinction_radius", True),
}
FRAME_NAME = re.compile(r"^frame_\d{4}\.jpg$")


class SyntheticRequest(BaseModel):
    n_experiments: int = Field(200, ge=10, le=100_000)
    seed: int = Field(0, ge=0, le=2**32 - 1)


@lru_cache(maxsize=1)
def _cached_showcase(min_samples: int, seed: int) -> dict:
    from falmex.pipeline import standardize

    base = Schema.load()
    frame, _ = standardize(synthetic.generate(300, seed=7), base, "showcase-synthetic")
    run_schema = base.extended(frame, extra_conditions=["sample_mass"])
    findings = run_discovery(
        frame, run_schema, dataset_id="showcase", synthetic=True,
        config=DiscoveryConfig(outcomes=["burn_time"], min_samples=min_samples, seed=seed,
                               extra={"extra_conditions": ["sample_mass"]}),
    )
    f = next(x for x in findings
             if x.condition == "sample_mass" and x.analyzer == "rank_correlation")
    holdout = next(v for v in f.validations if v.method == "holdout_replication").metrics
    perm = next(v for v in f.validations if v.method == "permutation_test").metrics
    checks = {p.params["control"]: p.metrics for p in f.deep if p.probe == "third_variable"}
    return {
        "synthetic": True,
        "dataset": "Synthetic test data (seed 7, 300 experiments) — not NASA data",
        "headline": f.headline,
        "status": f.status,
        "method": f.effect_metric,
        "n_experiments": f.evidence.n_experiments,
        "split": f.split.model_dump(),
        "discovery_effect": holdout["discovery_effect"],
        "unseen_effect": holdout["test_effect"],
        "shuffles_as_strong": perm["shuffles_as_strong"],
        "permutations": perm["permutations"],
        # third-variable check, all on the same rows (the full dataset)
        "effect_all_rows": checks["oxygen"]["effect_without_control"],
        "controls": {
            z: {"effect": m["effect_with_control"], "retained_share": m["retained_share"]}
            for z, m in checks.items() if z in ("oxygen", "pressure")
        },
        "explained_by": [p.params["control"] for p in f.deep
                         if p.probe == "third_variable" and p.verdict == "weakens"],
        "score": f.score,
        "rank": findings.index(f) + 1,
        "of": sum(x.status == Status.VALIDATED for x in findings),
    }


def _showcase(schema: Schema, min_samples: int, seed: int) -> dict:
    return _cached_showcase(min_samples, seed)


def create_app(settings: Settings | None = None, provider: LLMProvider | None = None) -> FastAPI:
    settings = settings or get_settings()

    @asynccontextmanager
    async def lifespan(app: FastAPI):
        app.state.store = Store(settings.data_dir)
        app.state.schema = Schema.load(settings.schema_path)
        app.state.provider = provider or get_provider(settings)
        yield
        app.state.store.close()

    app = FastAPI(title="FlamexSI API", version=__version__, lifespan=lifespan)

    @app.exception_handler(RequestValidationError)
    async def validation_error(_request: Request, exc: RequestValidationError):
        # FastAPI echoes the rejected input back; an infinite number or a huge string there
        # would break the JSON response itself. Keep where/what/limits, never the input.
        detail = [{k: v for k, v in e.items() if k in ("type", "loc", "msg", "ctx")}
                  for e in exc.errors()]
        for e in detail:
            if "ctx" in e:
                e["ctx"] = {k: v if isinstance(v, (int, str)) or (
                    isinstance(v, float) and math.isfinite(v)) else str(v)
                            for k, v in e["ctx"].items()}
        return JSONResponse(status_code=422, content={"detail": detail})
    app.include_router(chat_router())
    app.include_router(assistant_router())
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
            "probes": deep.available_probes(),
            "ranking_weights": DEFAULT_WEIGHTS,
            "file_types": supported_extensions(),
            "novelty": [n.value for n in Novelty],
            "safety_areas": [a.value for a in SafetyArea],
            "innovation_kinds": [k.value for k in InnovationKind],
            "innovation_stages": [s.value for s in Stage],
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

    @app.post("/api/datasets/nasa/flex", status_code=201)
    def load_flex(request: Request):
        """Load NASA's PSI-69 FLEX experimental table shipped with FlamexSI (274 tests)."""
        from pathlib import Path

        # shipped inside the package so it also exists in a non-editable install
        table = Path(__file__).resolve().parent / "datasets" / "PSI-69_Experimental table_FLEX.csv"
        existing = next((d for d in store(request).list_datasets()
                         if d.name.startswith("NASA PSI-69 FLEX")), None)
        if existing:
            return {"dataset": existing}
        dataset, _, _ = services.ingest_upload(
            store(request), schema(request), table.name, table.read_bytes(),
            name="NASA PSI-69 FLEX experimental table (274 tests)", synthetic=False,
        )
        return {"dataset": dataset}

    @app.post("/api/datasets/synthetic", status_code=201)
    def create_synthetic(request: Request, body: SyntheticRequest):
        frame = synthetic.generate(body.n_experiments, body.seed)
        buf = io.BytesIO()
        frame.to_csv(buf, index=False)
        dataset, _, _ = services.ingest_upload(
            store(request), schema(request), f"synthetic_seed{body.seed}_n{body.n_experiments}.csv",
            buf.getvalue(), name=f"Synthetic test data, not NASA (seed {body.seed})",
            synthetic=True,
        )
        return {"dataset": dataset}

    @app.post("/api/datasets/{dataset_id}/sources", status_code=201)
    async def add_source(request: Request, dataset_id: str, file: UploadFile = File(...)):
        """Add another file to a dataset; its rows link to experiments by experiment ID."""
        ds = dataset_or_404(request, dataset_id)
        content = await file.read()
        if len(content) > MAX_UPLOAD_BYTES:
            raise HTTPException(413, "File too large")
        try:
            dataset, source, assets = services.ingest_upload(
                store(request), schema(request), file.filename or "upload", content, into=ds,
            )
        except UnsupportedFileError as exc:
            raise HTTPException(415, str(exc)) from exc
        except (ValueError, UnicodeDecodeError) as exc:
            raise HTTPException(422, str(exc)) from exc
        return {"dataset": dataset, "source": source, "assets": assets}

    @app.get("/api/datasets/{dataset_id}/quality")
    def quality(request: Request, dataset_id: str):
        ds = dataset_or_404(request, dataset_id)
        frame = store(request).load_frame(dataset_id)
        return services.data_quality(frame, ds, schema(request), settings.min_samples)

    @app.get("/api/datasets/{dataset_id}/goals")
    def goals(request: Request, dataset_id: str):
        """Discovery goals this dataset can support, generated from its actual columns."""
        dataset_or_404(request, dataset_id)
        frame = store(request).load_frame(dataset_id)
        return {"goals": questions.discovery_goals(frame, schema(request)),
                "conditions": questions.candidate_conditions(frame, schema(request)),
                "split_options": questions.split_options(frame, schema(request))}

    @app.get("/api/showcase")
    def showcase(request: Request):
        """The landing page's 'why trust it' example, computed live by the engine on
        synthetic test data — never typed in by hand."""
        return _showcase(schema(request), settings.min_samples, settings.random_seed)

    @app.get("/api/datasets")
    def list_datasets(request: Request):
        return store(request).list_datasets()

    @app.get("/api/datasets/{dataset_id}")
    def get_dataset(request: Request, dataset_id: str):
        ds = dataset_or_404(request, dataset_id)
        frame = store(request).load_frame(dataset_id)
        return {"dataset": ds, "columns": services.column_stats(frame, schema(request)),
                "sources": store(request).get_sources(ds.source_ids)}

    def review_or_404(request: Request, dataset_id: str) -> dict:
        ds = dataset_or_404(request, dataset_id)
        review = scientific_review.scientific_review_for_dataset(
            ds,
            store(request).get_sources(ds.source_ids),
            services.load_findings(store(request), dataset_id),
        )
        if review is None:
            raise HTTPException(404, "No verified scientific review bundle for this dataset")
        return review

    @app.delete("/api/datasets/{dataset_id}", status_code=204)
    def delete_dataset(request: Request, dataset_id: str):
        if not store(request).delete_dataset(dataset_id):
            raise HTTPException(404, "Unknown dataset")

    @app.get("/api/datasets/{dataset_id}/scientific-review")
    def get_scientific_review(request: Request, dataset_id: str):
        return review_or_404(request, dataset_id)

    @app.get("/api/datasets/{dataset_id}/scientific-review/artifacts/{key}")
    def get_scientific_review_artifact(request: Request, dataset_id: str, key: str):
        review_or_404(request, dataset_id)
        try:
            path = scientific_review.artifact_path(key)
        except (KeyError, FileNotFoundError) as exc:
            raise HTTPException(404, "Unknown scientific review artifact") from exc
        return FileResponse(
            path, media_type=scientific_review.MEDIA_TYPES[path.suffix]
        )

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
            return services.compare_experiments(frame, schema(request), body.experiment_ids)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

    # ---- discovery & findings -----------------------------------------------
    @app.post("/api/datasets/{dataset_id}/discover")
    def discover(request: Request, dataset_id: str, body: DiscoverRequest | None = None):
        body = body or DiscoverRequest()
        ds = dataset_or_404(request, dataset_id)
        frame = store(request).load_frame(dataset_id)
        cfg = DiscoveryConfig(
            analyzers=body.analyzers, validators=body.validators, outcomes=body.outcomes,
            conditions=body.conditions, goal=body.goal or "Open exploration",
            weights=body.weights, split_by=body.split_by,
            test_fraction=body.test_fraction or settings.test_fraction,
            alpha=body.alpha or settings.alpha, min_samples=settings.min_samples,
            seed=settings.random_seed,
            extra={"extra_outcomes": body.extra_outcomes,
                   "extra_conditions": body.extra_conditions},
        )
        try:
            run_schema = schema(request).extended(
                frame, body.extra_outcomes, body.extra_conditions
            )
            findings = run_discovery(
                frame, run_schema, dataset_id=dataset_id,
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

    # Flight-evidence reports: the facts are fixed, so one Gemini answer per finding is
    # cached for the life of the process, and fresh requests are rate-limited per client.
    flight_reports: dict[str, object] = {}
    flight_calls: dict[str, list[float]] = {}
    FLIGHT_LIMIT, FLIGHT_WINDOW = 5, 600.0  # at most 5 new Gemini calls per client / 10 min

    @app.post("/api/flight-evidence/{finding_id}/interpret")
    def interpret_flight_evidence(request: Request, finding_id: str):
        # The packaged flight results remain available in synthetic-only workspaces.
        import json
        import time
        from pathlib import Path

        folder = Path(__file__).resolve().parent / "review_artifacts" / "review"
        source = folder / "planner_facts.json"
        facts = json.loads(source.read_text(encoding="utf-8"))
        if finding_id not in facts:
            raise HTTPException(404, "Unknown flight finding")
        if finding_id in flight_reports:
            return {"interpretation": flight_reports[finding_id], "cached": True}
        provider = request.app.state.provider
        if provider.name != "gemini":
            raise HTTPException(503, "Gemini is not configured on this server")
        client = (request.headers.get("x-forwarded-for") or "").split(",")[0].strip() or (
            request.client.host if request.client else "unknown"
        )
        now = time.monotonic()
        recent = [t for t in flight_calls.get(client, []) if now - t < FLIGHT_WINDOW]
        if len(recent) >= FLIGHT_LIMIT:
            raise HTTPException(429, "Too many report requests; try again in a few minutes")
        flight_calls[client] = [*recent, now]
        try:
            report = interpret_finding(Finding(**facts[finding_id]), provider)
        except LLMError as exc:
            raise HTTPException(502, "Gemini could not produce a report") from exc
        flight_reports[finding_id] = report
        return {"interpretation": report, "cached": False}

    @app.get("/api/findings/{finding_id}")
    def get_finding(request: Request, finding_id: str):
        return finding_or_404(request, finding_id)

    @app.get("/api/findings/{finding_id}/chart")
    def finding_chart(request: Request, finding_id: str, color_by: str | None = None):
        """Points labelled discovery / unseen, optionally coloured by a third variable, plus
        a LOWESS trend fitted on the discovery points only."""
        finding = finding_or_404(request, finding_id)
        frame = store(request).load_frame(finding.dataset_id)
        try:
            return trend.chart_data(finding, frame, schema(request).id_column, color_by,
                                    settings.test_fraction, settings.random_seed)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc

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

    def finding_context(request: Request, finding: Finding):
        frame = store(request).load_frame(finding.dataset_id)
        spec = finding.goal_spec or {}
        run_schema = schema(request).extended(
            frame, spec.get("extra_outcomes"), spec.get("extra_conditions")
        )
        return frame, run_schema

    @app.get("/api/findings/{finding_id}/deep")
    def deep_suggestions(request: Request, finding_id: str):
        """Follow-up questions generated for this finding from the data it came from."""
        finding = finding_or_404(request, finding_id)
        frame, run_schema = finding_context(request, finding)
        done = {(r.probe, tuple(sorted(r.params.items()))): r for r in finding.deep}
        out = []
        for spec in deep.suggest(finding, frame, run_schema):
            result = done.get((spec.probe, tuple(sorted(spec.params.items()))))
            out.append({"probe": spec.probe, "category": spec.category,
                        "question": spec.question, "params": spec.params, "result": result})
        return {"finding_id": finding_id, "suggestions": out}

    @app.post("/api/findings/{finding_id}/deep")
    def deep_run(request: Request, finding_id: str, body: ProbeRequest):
        finding = finding_or_404(request, finding_id)
        frame, run_schema = finding_context(request, finding)
        try:
            result = deep.run_probe(finding, frame, run_schema, body.probe, body.params,
                                    settings.min_samples)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        key = (result.probe, tuple(sorted(result.params.items())))
        finding.deep = [r for r in finding.deep
                        if (r.probe, tuple(sorted(r.params.items()))) != key] + [result]
        store(request).update_finding(finding.model_dump(mode="json"))
        return result

    # ---- step 8: prior knowledge, checked by a person for findings worth it ---------
    @app.post("/api/findings/{finding_id}/prior-knowledge/search")
    def prior_knowledge_search(request: Request, finding_id: str):
        """Search terms and links (NASA sources first) to check prior work. The AI words
        the queries; it never supplies references."""
        finding = finding_or_404(request, finding_id)
        return search_plan(finding, request.app.state.provider)

    @app.put("/api/findings/{finding_id}/prior-knowledge")
    def save_prior_knowledge(request: Request, finding_id: str, body: PriorKnowledgeRequest):
        finding = finding_or_404(request, finding_id)
        if finding.synthetic:
            raise HTTPException(409, "Prior knowledge is not recorded for synthetic test data.")
        if finding.status not in (Status.VALIDATED, Status.CANDIDATE):
            raise HTTPException(409, "Check prior knowledge only for validated or candidate "
                                     "findings.")
        finding.prior_knowledge = PriorKnowledge(**body.model_dump(),
                                                 reviewed_at=datetime.now(UTC))
        store(request).update_finding(finding.model_dump(mode="json"))
        return finding

    # ---- insights: promoted by a person from a reviewed, validated finding ---------
    @app.post("/api/findings/{finding_id}/insight", status_code=201)
    def promote(request: Request, finding_id: str, body: InsightRequest):
        finding = finding_or_404(request, finding_id)
        if finding.synthetic:
            raise HTTPException(409, "Findings from synthetic test data can never become "
                                     "insights.")
        if finding.status != Status.VALIDATED:
            raise HTTPException(409, "Only validated findings can be promoted to an insight.")
        for rid in body.related_finding_ids:
            related = store(request).get_finding(rid)
            if related is None:
                raise HTTPException(422, f"Related finding '{rid}' not found")
            if related.get("synthetic"):
                raise HTTPException(409, "An insight cannot rest on synthetic test data.")
        insight = Insight(
            insight_id=uuid.uuid4().hex[:12], finding_id=finding.finding_id,
            dataset_id=finding.dataset_id, created_at=datetime.now(UTC),
            finding_snapshot=finding.model_dump(mode="json"), **body.model_dump(),
        )
        store(request).save_insight(insight.model_dump(mode="json"))
        return insight

    @app.get("/api/insights")
    def list_insights(request: Request):
        return store(request).list_insights()

    @app.get("/api/insights/{insight_id}")
    def get_insight(request: Request, insight_id: str):
        insight = store(request).get_insight(insight_id)
        if insight is None:
            raise HTTPException(404, f"Insight '{insight_id}' not found")
        return insight

    # ---- beyond the challenge: innovation built on insights, decided by the team ----
    def insight_or_404(request: Request, insight_id: str) -> dict:
        insight = store(request).get_insight(insight_id)
        if insight is None:
            raise HTTPException(404, f"Insight '{insight_id}' not found")
        return insight

    @app.post("/api/insights/{insight_id}/innovation-suggestions")
    def innovation_suggestions(request: Request, insight_id: str):
        """AI-suggested directions for an insight. Not saved; the team decides."""
        insight = insight_or_404(request, insight_id)
        try:
            return {"insight_id": insight_id,
                    "suggestions": suggest_innovations(insight, request.app.state.provider)}
        except LLMError as exc:
            raise HTTPException(502, str(exc)) from exc

    @app.post("/api/innovations", status_code=201)
    def create_innovation(request: Request, body: InnovationRequest):
        for iid in body.insight_ids:
            insight_or_404(request, iid)
        now = datetime.now(UTC)
        innovation = Innovation(innovation_id=uuid.uuid4().hex[:12], created_at=now,
                                updated_at=now, **body.model_dump())
        store(request).save_innovation(innovation.model_dump(mode="json"))
        return innovation

    @app.get("/api/innovations")
    def list_innovations(request: Request):
        return store(request).list_innovations()

    @app.patch("/api/innovations/{innovation_id}")
    def update_innovation(request: Request, innovation_id: str, body: InnovationUpdate):
        raw = store(request).get_innovation(innovation_id)
        if raw is None:
            raise HTTPException(404, f"Innovation '{innovation_id}' not found")
        changes = body.model_dump(exclude_none=True)
        innovation = Innovation(**{**raw, **changes, "updated_at": datetime.now(UTC)})
        store(request).save_innovation(innovation.model_dump(mode="json"))
        return innovation

    # ---- flame footage: computer-vision metrics ---------------------------------------
    def media_or_404(request: Request, source_id: str):
        found = [s for s in store(request).get_sources([source_id]) if s.media_type == "media"]
        if not found:
            raise HTTPException(404, f"Footage '{source_id}' not found")
        return found[0]

    @app.get("/api/media")
    def list_media(request: Request):
        done = store(request).analyzed_media()
        return [{"source": m, "analyzed": m.source_id in done,
                 "kind": "video" if m.filename.lower().endswith(tuple(vision.VIDEO_EXT))
                 else "image"} for m in store(request).list_media()]

    @app.delete("/api/media/{source_id}", status_code=204)
    def delete_media(request: Request, source_id: str):
        if not store(request).delete_media(source_id):
            raise HTTPException(404, "Unknown footage")

    @app.post("/api/media/synthetic", status_code=201)
    def synthetic_media(request: Request):
        """SYNTHETIC test footage with known ground truth (not NASA)."""
        import tempfile
        from pathlib import Path

        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / "synthetic_flame_test.avi"
            vision.synthetic_clip(path)
            source = store(request).save_raw(path.name, path.read_bytes(), "media",
                                             synthetic=True)
        return {"source": source}

    @app.post("/api/media/{source_id}/analyze")
    def analyze_media(request: Request, source_id: str, body: AnalyzeMediaRequest | None = None):
        body = body or AnalyzeMediaRequest()
        source = media_or_404(request, source_id)
        try:
            result = vision.analyze(
                store(request).raw_path(source), store(request).media_dir(source_id),
                vision.Calibration(fps=body.fps, mm_per_px=body.mm_per_px),
            )
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        result.update(source=source.model_dump(mode="json"),
                      synthetic=bool(source.synthetic), analyzed_at=datetime.now(UTC))
        store(request).save_media_analysis(source_id, result)
        return result

    @app.get("/api/media/{source_id}/analysis")
    def media_analysis(request: Request, source_id: str):
        media_or_404(request, source_id)
        result = store(request).get_media_analysis(source_id)
        if result is None:
            raise HTTPException(404, "This footage has not been analyzed yet")
        return result

    @app.get("/api/media/{source_id}/frames/{name}")
    def media_frame(request: Request, source_id: str, name: str):
        if not FRAME_NAME.match(name):
            raise HTTPException(404, "Unknown frame")
        path = store(request).media_dir(source_id) / name
        if not path.is_file():
            raise HTTPException(404, "Unknown frame")
        return FileResponse(path, media_type="image/jpeg")

    @app.post("/api/media/{source_id}/attach")
    def attach_media(request: Request, source_id: str, body: AttachMediaRequest):
        """Write the footage's summary metrics into one experiment's rows."""
        source = media_or_404(request, source_id)
        result = store(request).get_media_analysis(source_id)
        if result is None:
            raise HTTPException(409, "Analyze the footage first")
        ds = dataset_or_404(request, body.dataset_id)
        if bool(source.synthetic) != ds.synthetic:
            raise HTTPException(409, "Synthetic footage and real data are never mixed.")
        frame = store(request).load_frame(ds.dataset_id)
        id_col = schema(request).id_column
        rows = frame[id_col].astype(str) == body.experiment_id
        if not rows.any():
            raise HTTPException(404, f"Experiment '{body.experiment_id}' not found")
        summary, calibrated = result["summary"], result.get("mm_per_px") is not None
        written, skipped = {}, []
        for col, (key, is_length) in FOOTAGE_COLUMNS.items():
            value = summary.get(key)
            if value is None or (is_length and not calibrated):
                skipped.append(col)
                continue
            if col not in frame:
                frame[col] = float("nan")
            frame.loc[rows, col] = value
            written[col] = value
        report = {**ds.report, "footage": [
            *[f for f in ds.report.get("footage", []) if f.get("source_id") != source_id],
            {"source_id": source_id, "filename": source.filename,
             "experiment_id": body.experiment_id, "columns": sorted(written)},
        ]}
        store(request).replace_dataset(ds.dataset_id, frame, source_ids=ds.source_ids,
                                       report=report)
        return {"written": written, "skipped": skipped,
                "note": None if calibrated else "Length metrics need a mm-per-pixel "
                "calibration and were not written."}

    # ---- flammability map (from loaded data) + cited reference limits -------------------
    @app.post("/api/datasets/{dataset_id}/flammability")
    def flammability_map(request: Request, dataset_id: str, body: FlammabilityRequest):
        ds = dataset_or_404(request, dataset_id)
        frame = store(request).load_frame(dataset_id)
        try:
            result = flammability.flammability_map(
                frame, axis=body.axis, material=body.material, pressure=body.pressure,
                at_x=body.at_x, at_oxygen=body.at_oxygen, seed=settings.random_seed)
        except ValueError as exc:
            raise HTTPException(422, str(exc)) from exc
        materials = (sorted(frame[flammability.MATERIAL].dropna().astype(str).unique())
                     if flammability.MATERIAL in frame else [])
        return {**result, "synthetic": ds.synthetic, "dataset": ds.name,
                "materials": materials,
                "axes": [a for a in flammability.AXES if a in frame]}

    @app.get("/api/reference-limits")
    def reference_limits(request: Request):
        return store(request).list_reference_limits()

    @app.post("/api/reference-limits", status_code=201)
    def add_reference_limit(request: Request, body: ReferenceLimitRequest):
        item = flammability.ReferenceLimit(limit_id=uuid.uuid4().hex[:12],
                                           created_at=datetime.now(UTC), **body.model_dump())
        store(request).save_reference_limit(item.model_dump(mode="json"))
        return item

    @app.delete("/api/reference-limits/{limit_id}", status_code=204)
    def delete_reference_limit(request: Request, limit_id: str):
        if not store(request).delete_reference_limit(limit_id):
            raise HTTPException(404, f"Reference limit '{limit_id}' not found")

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
