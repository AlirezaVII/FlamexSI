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
    def save_raw(self, filename: str, content: bytes, media_type: str = "table") -> SourceRecord:
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
            media_type=media_type, ingested_at=_now(),
        )
        self._exec(
            "INSERT INTO sources VALUES (?, ?, ?, ?, ?, ?)",
            [rec.source_id, rec.filename, rec.sha256, rec.size_bytes, rec.media_type,
             rec.ingested_at],
        )
        return rec

    def get_sources(self, source_ids: list[str]) -> list[SourceRecord]:
        if not source_ids:
            return []
        marks = ",".join("?" * len(source_ids))
        rows = self._fetch(f"SELECT * FROM sources WHERE source_id IN ({marks})", source_ids)
        return [SourceRecord(**r) for r in rows]

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
