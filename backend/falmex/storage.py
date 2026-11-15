"""Storage: immutable raw files + Parquet datasets + DuckDB metadata/query layer.

    data/raw/<sha256>.<ext>        original files, never modified
    data/processed/<dataset>.parquet  standardized tables
    data/falmex.duckdb             sources, datasets, findings
"""

import hashlib
import json
import threading
import uuid
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Literal

import duckdb
import pandas as pd
from pydantic import BaseModel

FilterOp = Literal["eq", "ne", "gt", "gte", "lt", "lte", "in", "contains"]
_SQL_OPS = {"eq": "=", "ne": "!=", "gt": ">", "gte": ">=", "lt": "<", "lte": "<="}


class Filter(BaseModel):
    field: str
    op: FilterOp = "eq"
    value: Any


class SourceRecord(BaseModel):
    source_id: str
    filename: str
    sha256: str
    size_bytes: int
    media_type: str
    ingested_at: datetime
    synthetic: bool | None = False


class DatasetRecord(BaseModel):
    dataset_id: str
    name: str
    synthetic: bool
    created_at: datetime
    n_rows: int
    columns: list[str]
    source_ids: list[str]
    report: dict


def _now() -> datetime:
    return datetime.now(UTC)


def records(frame: pd.DataFrame) -> list[dict]:
    """DataFrame -> JSON-safe list of dicts (NaN/NA -> None)."""
    return json.loads(frame.to_json(orient="records", date_format="iso"))


class Store:
    def __init__(self, data_dir: Path):
        self.data_dir = Path(data_dir)
        self.raw_dir = self.data_dir / "raw"
        self.processed_dir = self.data_dir / "processed"
        for d in (self.raw_dir, self.processed_dir):
            d.mkdir(parents=True, exist_ok=True)
        self._lock = threading.Lock()
        self._con = duckdb.connect(str(self.data_dir / "falmex.duckdb"))
        self._migrate()

    def close(self) -> None:
        self._con.close()

    def _migrate(self) -> None:
        self._con.execute(
            """
            CREATE TABLE IF NOT EXISTS sources (
                source_id VARCHAR PRIMARY KEY, filename VARCHAR, sha256 VARCHAR,
                size_bytes BIGINT, media_type VARCHAR, ingested_at TIMESTAMPTZ);
            CREATE TABLE IF NOT EXISTS datasets (
                dataset_id VARCHAR PRIMARY KEY, name VARCHAR, synthetic BOOLEAN,
                created_at TIMESTAMPTZ, n_rows BIGINT, columns JSON, source_ids JSON,
                report JSON);
            CREATE TABLE IF NOT EXISTS findings (
                finding_id VARCHAR PRIMARY KEY, dataset_id VARCHAR,
                created_at TIMESTAMPTZ, payload JSON);
            CREATE TABLE IF NOT EXISTS insights (
                insight_id VARCHAR PRIMARY KEY, finding_id VARCHAR, dataset_id VARCHAR,
                created_at TIMESTAMPTZ, payload JSON);
            CREATE TABLE IF NOT EXISTS innovations (
                innovation_id VARCHAR PRIMARY KEY, created_at TIMESTAMPTZ, payload JSON);
            CREATE TABLE IF NOT EXISTS media_analyses (
                source_id VARCHAR PRIMARY KEY, created_at TIMESTAMPTZ, payload JSON);
            CREATE TABLE IF NOT EXISTS reference_limits (
                limit_id VARCHAR PRIMARY KEY, created_at TIMESTAMPTZ, payload JSON);
            ALTER TABLE sources ADD COLUMN IF NOT EXISTS synthetic BOOLEAN DEFAULT FALSE;
            """
        )

    def _fetch(self, sql: str, params: list | None = None) -> list[dict]:
        with self._lock:
            cur = self._con.execute(sql, params or [])
            cols = [d[0] for d in cur.description]
            return [dict(zip(cols, row, strict=True)) for row in cur.fetchall()]

    def _exec(self, sql: str, params: list | None = None) -> None:
        with self._lock:
            self._con.execute(sql, params or [])

    # ---- sources -----------------------------------------------------------
    def save_raw(self, filename: str, content: bytes, media_type: str = "table",
                 synthetic: bool = False) -> SourceRecord:
        sha = hashlib.sha256(content).hexdigest()
        source_id = sha[:16]
        existing = self._fetch("SELECT * FROM sources WHERE source_id = ?", [source_id])
        if existing:
            return SourceRecord(**existing[0])
        path = self.raw_dir / f"{sha}{Path(filename).suffix.lower()}"
        if not path.exists():
            path.write_bytes(content)
        rec = SourceRecord(
            source_id=source_id, filename=filename, sha256=sha, size_bytes=len(content),
            media_type=media_type, ingested_at=_now(), synthetic=synthetic,
        )
        self._exec(
            "INSERT INTO sources (source_id, filename, sha256, size_bytes, media_type, "
            "ingested_at, synthetic) VALUES (?, ?, ?, ?, ?, ?, ?)",
            [rec.source_id, rec.filename, rec.sha256, rec.size_bytes, rec.media_type,
             rec.ingested_at, rec.synthetic],
        )
        return rec

    def get_sources(self, source_ids: list[str]) -> list[SourceRecord]:
        if not source_ids:
            return []
        marks = ",".join("?" * len(source_ids))
        rows = self._fetch(f"SELECT * FROM sources WHERE source_id IN ({marks})", source_ids)
        return [SourceRecord(**r) for r in rows]

    def raw_path(self, source: SourceRecord) -> Path:
        return self.raw_dir / f"{source.sha256}{Path(source.filename).suffix.lower()}"

    def list_media(self) -> list[SourceRecord]:
        rows = self._fetch(
            "SELECT * FROM sources WHERE media_type = 'media' ORDER BY ingested_at DESC"
        )
        return [SourceRecord(**r) for r in rows]

    def media_dir(self, source_id: str) -> Path:
        return self.data_dir / "media" / source_id

    def save_media_analysis(self, source_id: str, analysis: dict) -> None:
        self._exec("DELETE FROM media_analyses WHERE source_id = ?", [source_id])
        self._exec("INSERT INTO media_analyses VALUES (?, ?, ?)",
                   [source_id, _now(), json.dumps(analysis, default=str)])

    def get_media_analysis(self, source_id: str) -> dict | None:
        rows = self._fetch("SELECT payload FROM media_analyses WHERE source_id = ?",
                           [source_id])
        return json.loads(rows[0]["payload"]) if rows else None

    def analyzed_media(self) -> set[str]:
        return {r["source_id"] for r in self._fetch("SELECT source_id FROM media_analyses")}

    # ---- reference limits (cited values entered by the team) --------------------------
    def save_reference_limit(self, item: dict) -> None:
        self._exec("INSERT INTO reference_limits VALUES (?, ?, ?)",
                   [item["limit_id"], item["created_at"], json.dumps(item, default=str)])

    def list_reference_limits(self) -> list[dict]:
        rows = self._fetch("SELECT payload FROM reference_limits ORDER BY created_at")
        return [json.loads(r["payload"]) for r in rows]

    def delete_reference_limit(self, limit_id: str) -> bool:
        found = self._fetch("SELECT limit_id FROM reference_limits WHERE limit_id = ?",
                            [limit_id])
        self._exec("DELETE FROM reference_limits WHERE limit_id = ?", [limit_id])
        return bool(found)

    # ---- datasets ----------------------------------------------------------
    def create_dataset(
        self, name: str, frame: pd.DataFrame, *, synthetic: bool, source_ids: list[str],
        report: dict,
    ) -> DatasetRecord:
        dataset_id = uuid.uuid4().hex[:12]
        frame.to_parquet(self._parquet(dataset_id), index=False)
        rec = DatasetRecord(
            dataset_id=dataset_id, name=name, synthetic=synthetic, created_at=_now(),
            n_rows=len(frame), columns=list(frame.columns), source_ids=source_ids, report=report,
        )
        self._exec(
            "INSERT INTO datasets VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
            [rec.dataset_id, rec.name, rec.synthetic, rec.created_at, rec.n_rows,
             json.dumps(rec.columns), json.dumps(rec.source_ids), json.dumps(rec.report)],
        )
        return rec

    def replace_dataset(
        self, dataset_id: str, frame: pd.DataFrame, *, source_ids: list[str], report: dict
    ) -> DatasetRecord:
        """Swap in a new version of a dataset's table (e.g. after adding another file).

        Raw files are untouched; only the processed table and its metadata change.
        """
        tmp = self._parquet(dataset_id).with_suffix(".tmp")
        frame.to_parquet(tmp, index=False)
        tmp.replace(self._parquet(dataset_id))
        self._exec(
            "UPDATE datasets SET n_rows = ?, columns = ?, source_ids = ?, report = ? "
            "WHERE dataset_id = ?",
            [len(frame), json.dumps(list(frame.columns)), json.dumps(source_ids),
             json.dumps(report), dataset_id],
        )
        return self.get_dataset(dataset_id)

    def _parquet(self, dataset_id: str) -> Path:
        return self.processed_dir / f"{dataset_id}.parquet"

    @staticmethod
    def _dataset_from_row(row: dict) -> DatasetRecord:
        for key in ("columns", "source_ids", "report"):
            row[key] = json.loads(row[key])
        return DatasetRecord(**row)

    def list_datasets(self) -> list[DatasetRecord]:
        rows = self._fetch("SELECT * FROM datasets ORDER BY created_at DESC")
        return [self._dataset_from_row(r) for r in rows]

    def get_dataset(self, dataset_id: str) -> DatasetRecord | None:
        rows = self._fetch("SELECT * FROM datasets WHERE dataset_id = ?", [dataset_id])
        return self._dataset_from_row(rows[0]) if rows else None

    def load_frame(self, dataset_id: str) -> pd.DataFrame:
        return pd.read_parquet(self._parquet(dataset_id))

    def query_rows(
        self, dataset_id: str, filters: list[Filter], limit: int = 100, offset: int = 0,
        sort: str | None = None, descending: bool = False,
    ) -> tuple[list[dict], int]:
        """Filter a dataset. Column names are checked against the dataset, values are bound."""
        ds = self.get_dataset(dataset_id)
        if ds is None:
            raise KeyError(dataset_id)
        allowed = set(ds.columns)
        where, params = [], []
        for f in filters:
            if f.field not in allowed:
                raise ValueError(f"Unknown column '{f.field}'")
            col = f'"{f.field}"'
            if f.op == "in":
                values = f.value if isinstance(f.value, list) else [f.value]
                where.append(f"{col} IN ({','.join('?' * len(values))})")
                params.extend(values)
            elif f.op == "contains":
                where.append(f"CAST({col} AS VARCHAR) ILIKE ?")
                params.append(f"%{f.value}%")
            else:
                where.append(f"{col} {_SQL_OPS[f.op]} ?")
                params.append(f.value)
        clause = f"WHERE {' AND '.join(where)}" if where else ""
        src = f"read_parquet('{self._parquet(dataset_id).as_posix()}')"
        order = ""
        if sort:
            if sort not in allowed:
                raise ValueError(f"Unknown column '{sort}'")
            order = f'ORDER BY "{sort}" {"DESC" if descending else "ASC"} NULLS LAST'
        with self._lock:
            total = self._con.execute(f"SELECT count(*) FROM {src} {clause}", params).fetchone()[0]
            frame = self._con.execute(
                f"SELECT * FROM {src} {clause} {order} LIMIT ? OFFSET ?", [*params, limit, offset]
            ).df()
        return records(frame), int(total)

    # ---- findings ----------------------------------------------------------
    def save_findings(self, dataset_id: str, findings: list[dict]) -> None:
        """Replace all findings for a dataset with a fresh discovery run."""
        self._exec("DELETE FROM findings WHERE dataset_id = ?", [dataset_id])
        for f in findings:
            self._exec(
                "INSERT INTO findings VALUES (?, ?, ?, ?)",
                [f["finding_id"], dataset_id, f["created_at"], json.dumps(f, default=str)],
            )

    def update_finding(self, finding: dict) -> None:
        self._exec(
            "UPDATE findings SET payload = ? WHERE finding_id = ?",
            [json.dumps(finding, default=str), finding["finding_id"]],
        )

    def list_findings(self, dataset_id: str | None = None) -> list[dict]:
        if dataset_id:
            rows = self._fetch("SELECT payload FROM findings WHERE dataset_id = ?", [dataset_id])
        else:
            rows = self._fetch("SELECT payload FROM findings")
        return [json.loads(r["payload"]) for r in rows]

    def get_finding(self, finding_id: str) -> dict | None:
        rows = self._fetch("SELECT payload FROM findings WHERE finding_id = ?", [finding_id])
        return json.loads(rows[0]["payload"]) if rows else None

    # ---- insights (created by a person, never automatically) ----------------------------
    def save_insight(self, insight: dict) -> None:
        self._exec(
            "INSERT INTO insights VALUES (?, ?, ?, ?, ?)",
            [insight["insight_id"], insight["finding_id"], insight["dataset_id"],
             insight["created_at"], json.dumps(insight, default=str)],
        )

    def list_insights(self) -> list[dict]:
        rows = self._fetch("SELECT payload FROM insights ORDER BY created_at DESC")
        return [json.loads(r["payload"]) for r in rows]

    def get_insight(self, insight_id: str) -> dict | None:
        rows = self._fetch("SELECT payload FROM insights WHERE insight_id = ?", [insight_id])
        return json.loads(rows[0]["payload"]) if rows else None

    # ---- innovations (built on insights, decided by the team) ---------------------------
    def save_innovation(self, innovation: dict) -> None:
        """Insert or replace an innovation."""
        self._exec("DELETE FROM innovations WHERE innovation_id = ?",
                   [innovation["innovation_id"]])
        self._exec(
            "INSERT INTO innovations VALUES (?, ?, ?)",
            [innovation["innovation_id"], innovation["created_at"],
             json.dumps(innovation, default=str)],
        )

    def list_innovations(self) -> list[dict]:
        rows = self._fetch("SELECT payload FROM innovations ORDER BY created_at DESC")
        return [json.loads(r["payload"]) for r in rows]

    def get_innovation(self, innovation_id: str) -> dict | None:
        rows = self._fetch("SELECT payload FROM innovations WHERE innovation_id = ?",
                           [innovation_id])
        return json.loads(rows[0]["payload"]) if rows else None
