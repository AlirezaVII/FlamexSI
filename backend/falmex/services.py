"""Use-cases shared by the API and scripts (API stays a thin HTTP layer)."""

import pandas as pd

from falmex.findings import Finding, SourceRef
from falmex.ingest import read_file
from falmex.pipeline import standardize
from falmex.schema import Role, Schema, VarType, infer_type
from falmex.storage import DatasetRecord, SourceRecord, Store


def ingest_upload(
    store: Store, schema: Schema, filename: str, content: bytes, *, name: str | None = None,
    synthetic: bool = False, into: DatasetRecord | None = None,
) -> tuple[DatasetRecord | None, SourceRecord, list[dict]]:
    """Save the raw file unchanged, read it, standardize it and store it.

    Creates a new dataset, or with `into` adds the file to an existing one: rows of every
    file keep their source, and rows of the same experiment are linked by its experiment ID.
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
    for r in reports:
        r["source_id"], r["filename"] = source.source_id, filename
    if into is not None:
        if source.source_id in into.source_ids:
            raise ValueError(f"'{filename}' is already part of this dataset")
        existing = store.load_frame(into.dataset_id)
        merged = pd.concat([existing, combined], ignore_index=True)
        dataset = store.replace_dataset(
            into.dataset_id, merged, source_ids=[*into.source_ids, source.source_id],
            report={"tables": [*into.report.get("tables", []), *reports]},
        )
        return dataset, source, assets
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
            "type": var.type.value if var else infer_type(s).value,
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


def _group(name: str, schema: Schema) -> str:
    var = schema.get(name)
    if var is None:
        return "other"
    return {Role.CONDITION: "condition", Role.OUTCOME: "outcome"}.get(var.role, "other")


def _is_numeric(s: pd.Series) -> bool:
    return pd.api.types.is_numeric_dtype(s) and not pd.api.types.is_bool_dtype(s)


def data_quality(frame: pd.DataFrame, dataset: DatasetRecord, schema: Schema,
                 min_samples: int = 8) -> dict:
    """What we have, what is missing, and what was changed on the way in."""
    cols = [c for c in frame.columns if not c.startswith("_")]
    tables = dataset.report.get("tables", [])
    rows_in = sum(t.get("rows_in", 0) for t in tables)
    removed: dict[str, int] = {}
    for t in tables:
        for reason, n in (t.get("rows_removed") or {
            "empty row (every value missing)": t.get("empty_rows_dropped", 0),
            "exact duplicate row": t.get("duplicate_rows_dropped", 0),
        }).items():
            removed[reason] = removed.get(reason, 0) + n
    conversions = [c for t in tables for c in t.get("unit_conversions", [])]
    invalid = {}
    outliers = {}
    for t in tables:
        for k, v in t.get("coercion_failures", {}).items():
            invalid[k] = invalid.get(k, 0) + v
        for k, v in t.get("outliers_flagged", {}).items():
            outliers[k] = outliers.get(k, 0) + v

    variables = []
    for c in cols:
        s = frame[c]
        var = schema.get(c)
        count = int(s.notna().sum())
        unique = int(s.nunique(dropna=True))
        problem = None
        if count < min_samples:
            problem = f"only {count} values"
        elif unique < 2:
            problem = "constant (one value)"
        conv = next((x for x in conversions if x["column"] == c), None)
        variables.append({
            "name": c,
            "group": _group(c, schema) if var else "unmapped",
            "mapped": var is not None,
            "type": var.type.value if var else infer_type(s).value,
            "unit": var.unit if var else None,
            "converted_from": conv["from"] if conv else None,
            "completeness": round(count / len(frame), 4) if len(frame) else 0.0,
            "missing": int(len(frame) - count),
            "invalid_values": invalid.get(c, 0),
            "outliers_flagged": outliers.get(c, 0),
            "usable": problem is None,
            "problem": problem,
        })

    id_col = schema.id_column
    per_exp = frame.groupby(id_col).size() if id_col in frame else pd.Series(dtype=int)
    cells = len(frame) * len(cols)
    missing_cells = int(frame[cols].isna().sum().sum()) if cols else 0
    return {
        "synthetic": dataset.synthetic,
        "rows_in": rows_in,
        "rows_out": len(frame),
        "rows_removed": removed,
        "missing_cell_share": round(missing_cells / cells, 4) if cells else 0.0,
        "duplicate_row_share": round(removed.get("exact duplicate row", 0) / rows_in, 4)
        if rows_in else 0.0,
        "unit_conversions": conversions,
        "invalid_values_set_missing": sum(invalid.values()),
        "outliers_flagged": sum(outliers.values()),
        "variables_mapped": sum(v["mapped"] for v in variables),
        "variables_unmapped": sum(not v["mapped"] for v in variables),
        "variables_usable": sum(v["usable"] for v in variables),
        "experiments": int(per_exp.size),
        "experiments_with_repeated_measurements": int((per_exp > 1).sum()),
        "sources": len(dataset.source_ids),
        "variables": variables,
    }


def compare_experiments(frame: pd.DataFrame, schema: Schema, ids: list[str]) -> dict:
    """Side-by-side view built from whatever columns the dataset has.

    Repeated measurements are summarised (mean, spread, count) instead of hidden in a mean,
    variables that differ are marked, and pairs of experiments with similar conditions but
    different outcomes are pointed out — often the most interesting comparisons.
    """
    id_col = schema.id_column
    if not id_col or id_col not in frame:
        raise ValueError("Dataset has no experiment id column")
    key = frame[id_col].astype(str)
    found = [i for i in dict.fromkeys(ids) if (key == i).any()]
    subset = frame[key.isin(found)]
    by_exp = {i: subset[key[subset.index] == i] for i in found}
    cols = [c for c in frame.columns if not c.startswith("_") and c != id_col]

    variables = []
    for c in cols:
        full = frame[c]
        var = schema.get(c)
        entry = {"name": c, "group": _group(c, schema), "unit": var.unit if var else None,
                 "type": var.type.value if var else infer_type(full).value, "values": {}}
        if _is_numeric(full):
            span = float(full.max() - full.min()) if full.notna().any() else 0.0
            means = []
            for i, part in by_exp.items():
                v = part[c].dropna().astype(float)
                stats = {"n": int(v.size)}
                if v.size:
                    stats.update(mean=float(v.mean()), min=float(v.min()), max=float(v.max()),
                                 std=float(v.std(ddof=1)) if v.size > 1 else None)
                    means.append(stats["mean"])
                entry["values"][i] = stats
            entry["kind"] = "numeric"
            entry["dataset_range"] = span
            entry["differs"] = bool(means) and span > 0 and (max(means) - min(means)) / span > 0.05
        else:
            seen = []
            for i, part in by_exp.items():
                vals = sorted({str(v) for v in part[c].dropna()})
                entry["values"][i] = {"n": int(part[c].notna().sum()), "values": vals}
                seen.append(tuple(vals))
            entry["kind"] = "categorical"
            entry["differs"] = len(set(seen)) > 1
        variables.append(entry)

    return {
        "experiments": found,
        "missing": [i for i in ids if i not in found],
        "variables": variables,
        "similar_conditions_different_outcomes": _near_twins(found, variables),
    }


def _near_twins(ids: list[str], variables: list[dict], cond_tol: float = 0.1,
                out_gap: float = 0.25) -> list[dict]:
    conds = [v for v in variables if v["group"] == "condition"]
    outs = [v for v in variables if v["group"] == "outcome"]
    pairs = []
    for a_i, a in enumerate(ids):
        for b in ids[a_i + 1:]:
            compared, similar = 0, True
            for v in conds:
                va, vb = v["values"].get(a, {}), v["values"].get(b, {})
                if v["kind"] == "numeric":
                    if "mean" not in va or "mean" not in vb or not v["dataset_range"]:
                        continue
                    compared += 1
                    if abs(va["mean"] - vb["mean"]) / v["dataset_range"] > cond_tol:
                        similar = False
                elif va.get("values") and vb.get("values"):
                    compared += 1
                    if va["values"] != vb["values"]:
                        similar = False
            if not similar or compared == 0:
                continue
            diffs = []
            for v in outs:
                va, vb = v["values"].get(a, {}), v["values"].get(b, {})
                if v["kind"] == "numeric":
                    if "mean" in va and "mean" in vb and v["dataset_range"] and \
                            abs(va["mean"] - vb["mean"]) / v["dataset_range"] > out_gap:
                        diffs.append({"name": v["name"], "a": va["mean"], "b": vb["mean"]})
                elif va.get("values") and vb.get("values") and va["values"] != vb["values"]:
                    diffs.append({"name": v["name"], "a": va["values"], "b": vb["values"]})
            if diffs:
                pairs.append({"a": a, "b": b, "conditions_compared": compared,
                              "outcome_differences": diffs})
    return pairs


def load_findings(store: Store, dataset_id: str | None = None) -> list[Finding]:
    return [Finding(**f) for f in store.list_findings(dataset_id)]
