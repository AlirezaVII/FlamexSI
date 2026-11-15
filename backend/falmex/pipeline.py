"""Clean + standardize raw tables into the canonical schema.

Every step is recorded in a `PipelineReport` so the dashboard can show exactly
what happened to the data (nothing is silently dropped or renamed).
"""

import re
from dataclasses import dataclass, field

import numpy as np
import pandas as pd

from falmex.schema import Schema, VarType, normalize_name

SOURCE_COL = "_source_id"
ROW_COL = "_row"

_TRUE = {"true", "yes", "y", "1", "t", "extinguished", "ignited"}
_FALSE = {"false", "no", "n", "0", "f"}


@dataclass
class ColumnMapping:
    raw: str
    canonical: str
    known: bool
    unit_from: str | None = None


@dataclass
class PipelineReport:
    rows_in: int = 0
    rows_out: int = 0
    empty_rows_dropped: int = 0
    duplicate_rows_dropped: int = 0
    columns: list[ColumnMapping] = field(default_factory=list)
    coercion_failures: dict[str, int] = field(default_factory=dict)
    warnings: list[str] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "rows_in": self.rows_in,
            "rows_out": self.rows_out,
            "empty_rows_dropped": self.empty_rows_dropped,
            "duplicate_rows_dropped": self.duplicate_rows_dropped,
            "columns": [c.__dict__ for c in self.columns],
            "coercion_failures": self.coercion_failures,
            "warnings": self.warnings,
        }


def _split_unit(raw: str, schema: Schema) -> tuple[str | None, str | None]:
    """Find the canonical variable and an optional unit hint in a column name.

    Handles 'Pressure (atm)', 'pressure_atm', 'O2 [fraction]'.
    """
    hint = None
    m = re.search(r"[\(\[]\s*([^\)\]]+?)\s*[\)\]]", raw)
    if m:
        hint = m.group(1)
    canonical = schema.resolve(raw)
    if canonical is None:
        parts = normalize_name(raw).split("_")
        for i in range(len(parts) - 1, 0, -1):
            canonical = schema.resolve("_".join(parts[:i]))
            if canonical:
                hint = hint or "_".join(parts[i:])
                break
    return canonical, hint


def _match_unit(var_units: dict, hint: str | None) -> str | None:
    if not hint:
        return None
    norm = normalize_name(hint.replace("/", "_per_"))
    for unit in var_units:
        if normalize_name(unit) == norm or unit.lower() == hint.lower():
            return unit
    return None


def _to_bool(series: pd.Series) -> tuple[pd.Series, int]:
    def conv(v):
        if pd.isna(v):
            return pd.NA
        if isinstance(v, bool | np.bool_):
            return bool(v)
        s = str(v).strip().lower()
        if s in _TRUE:
            return True
        if s in _FALSE:
            return False
        return "__bad__"

    out = series.map(conv)
    bad = int((out == "__bad__").sum())
    out = out.where(out != "__bad__", pd.NA)
    return out.astype("boolean"), bad


def standardize(
    frame: pd.DataFrame, schema: Schema, source_id: str
) -> tuple[pd.DataFrame, PipelineReport]:
    report = PipelineReport(rows_in=len(frame))
    df = frame.copy()
    df.columns = [str(c).strip() for c in df.columns]

    # 1. drop fully empty rows and exact duplicates
    before = len(df)
    df = df.dropna(how="all")
    report.empty_rows_dropped = before - len(df)
    before = len(df)
    df = df.drop_duplicates()
    report.duplicate_rows_dropped = before - len(df)

    # 2. map columns to canonical names (unknown columns are kept, just normalized)
    out = pd.DataFrame(index=df.index)
    for raw in df.columns:
        canonical, hint = _split_unit(raw, schema)
        var = schema.get(canonical) if canonical else None
        if var is None:
            name = normalize_name(raw) or raw
            report.columns.append(ColumnMapping(raw, name, known=False))
            out[name] = df[raw]
            continue
        if canonical in out.columns:
            report.warnings.append(f"Column '{raw}' duplicates '{canonical}'; kept the first.")
            continue

        series = df[raw]
        unit = _match_unit(var.units, hint)
        mapping = ColumnMapping(raw, canonical, known=True, unit_from=unit)
        hint_norm = normalize_name(hint) if hint else ""
        if hint_norm and unit is None and var.unit and hint_norm != normalize_name(var.unit):
            report.warnings.append(
                f"Column '{raw}': unit '{hint}' not recognised for '{canonical}' "
                f"(expected {var.unit}); values left unconverted."
            )

        # 3. coerce types
        if var.type == VarType.NUMERIC:
            numeric = pd.to_numeric(series, errors="coerce")
            bad = int((numeric.isna() & series.notna()).sum())
            if unit:
                numeric = numeric.map(var.units[unit].apply)
            series = numeric.astype("float64")
        elif var.type == VarType.BOOLEAN:
            series, bad = _to_bool(series)
        else:
            series = series.astype("string").str.strip()
            bad = 0
        if bad:
            report.coercion_failures[canonical] = bad
        report.columns.append(mapping)
        out[canonical] = series

    # 4. provenance: every row remembers its source file and row number
    out[SOURCE_COL] = source_id
    out[ROW_COL] = out.index.astype("int64")
    id_col = schema.id_column
    if id_col and id_col not in out.columns:
        out[id_col] = [f"{source_id[:8]}-{i}" for i in out[ROW_COL]]
        report.warnings.append(f"No '{id_col}' column found; generated IDs from row numbers.")
    out = out.reset_index(drop=True)
    report.rows_out = len(out)
    return out, report
