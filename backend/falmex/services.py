"""Use-cases shared by the API and scripts (API stays a thin HTTP layer)."""

import pandas as pd

from falmex.findings import Finding, SourceRef
from falmex.ingest import read_file
from falmex.pipeline import standardize
from falmex.schema import Schema, VarType
from falmex.storage import DatasetRecord, SourceRecord, Store, records


def ingest_upload(
    store: Store, schema: Schema, filename: str, content: bytes, *, name: str | None = None,
    synthetic: bool = False,
) -> tuple[DatasetRecord | None, SourceRecord, list[dict]]:
    """Save raw file, read it, standardize it and store it as one dataset.

    Returns (dataset or None if the file had no tables, source, media assets).
    """
    result = read_file(filename, content)
    source = store.save_raw(filename, content, "table" if result.tables else "media")
    assets = [a.__dict__ for a in result.assets]
    if not result.tables:
        return None, source, assets

    frames, reports = [], []
    for table in result.tables:
        frame, report = standardize(table.frame, schema, source.source_id)
        if len(result.tables) > 1:
            frame["_table"] = table.name
        frames.append(frame)
        reports.append({"table": table.name, **report.to_dict()})
    combined = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    dataset = store.create_dataset(
        name or filename, combined, synthetic=synthetic, source_ids=[source.source_id],
        report={"tables": reports},
    )
    return dataset, source, assets


def source_refs(store: Store, dataset: DatasetRecord) -> dict[str, SourceRef]:
    return {
        s.source_id: SourceRef(source_id=s.source_id, filename=s.filename, sha256=s.sha256)
        for s in store.get_sources(dataset.source_ids)
    }


def column_stats(frame: pd.DataFrame, schema: Schema) -> list[dict]:
    out = []
    for col in frame.columns:
        if col.startswith("_"):
            continue
        s = frame[col]
        var = schema.get(col)
        info = {
            "name": col,
            "known": var is not None,
            "role": var.role.value if var else None,
            "type": var.type.value if var else str(s.dtype),
            "unit": var.unit if var else None,
            "count": int(s.notna().sum()),
            "missing": int(s.isna().sum()),
        }
        numeric_unknown = (var is None and pd.api.types.is_numeric_dtype(s)
                           and not pd.api.types.is_bool_dtype(s))
        if (var is not None and var.type == VarType.NUMERIC) or numeric_unknown:
            num = pd.to_numeric(s, errors="coerce")
            info.update(min=_f(num.min()), max=_f(num.max()), mean=_f(num.mean()))
        else:
            info["top_values"] = {str(k): int(v) for k, v in s.value_counts().head(20).items()}
        out.append(info)
    return out


def _f(v) -> float | None:
    return None if pd.isna(v) else float(v)


def compare_experiments(frame: pd.DataFrame, schema: Schema, ids: list[str]) -> list[dict]:
    id_col = schema.id_column
    if not id_col or id_col not in frame:
        raise ValueError("Dataset has no experiment id column")
    subset = frame[frame[id_col].astype(str).isin(ids)]
    cols = [c for c in subset.columns if not c.startswith("_") and c != id_col]
    agg = {}
    for c in cols:
        numeric = pd.api.types.is_numeric_dtype(subset[c]) and not pd.api.types.is_bool_dtype(
            subset[c])
        agg[c] = "mean" if numeric else "first"
    grouped = subset.groupby(subset[id_col].astype(str)).agg(agg)
    grouped["n_rows"] = subset.groupby(subset[id_col].astype(str)).size()
    return records(grouped.reset_index())


def load_findings(store: Store, dataset_id: str | None = None) -> list[Finding]:
    return [Finding(**f) for f in store.list_findings(dataset_id)]
