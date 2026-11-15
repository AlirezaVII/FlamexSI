"""Discovery question engine.

Builds the discovery goals a dataset can support from the columns it actually has, so the
questions follow the data instead of being written in advance. Wording is deliberately
non-causal ("associated with"), because discovery finds statistical associations.

Level 1 (here): which goals can this dataset answer?
Level 2 (deep.py): which follow-up questions does a given finding raise?
"""

import pandas as pd

from falmex.schema import Role, Schema, VarType, infer_type


def _label(name: str) -> str:
    return name.replace("_", " ")


def outcome_question(name: str, kind: VarType) -> str:
    if kind == VarType.BOOLEAN:
        return f"Which conditions are associated with whether {_label(name)} occurs?"
    if kind == VarType.CATEGORICAL:
        return f"Which conditions are associated with differences in {_label(name)}?"
    return f"Which conditions are associated with changes in {_label(name)}?"


def discovery_goals(frame: pd.DataFrame, schema: Schema) -> list[dict]:
    present = [c for c in frame.columns if not c.startswith("_")]
    conditions = [v.name for v in schema.by_role(Role.CONDITION) if v.name in present]
    outcomes = [v for v in schema.by_role(Role.OUTCOME) if v.name in present]
    mapped = {v.name for v in schema.variables.values()}
    unmapped = [c for c in present if c not in mapped
                and infer_type(frame[c]) in (VarType.NUMERIC, VarType.BOOLEAN)
                and frame[c].nunique(dropna=True) > 1]

    goals = [{
        "id": "open",
        "kind": "open",
        "question": "Which condition–outcome associations exist in this dataset?",
        "description": f"Tests every condition ({len(conditions)}) against every outcome "
                       f"({len(outcomes)}).",
        "outcomes": [],
        "extra_outcomes": [],
    }]
    for v in outcomes:
        goals.append({
            "id": f"outcome:{v.name}",
            "kind": "outcome",
            "question": outcome_question(v.name, v.type),
            "description": v.description,
            "outcomes": [v.name],
            "extra_outcomes": [],
        })
    for c in unmapped:
        goals.append({
            "id": f"column:{c}",
            "kind": "unmapped",
            "question": outcome_question(c, infer_type(frame[c])),
            "description": "A column from the data file that is not in the standard schema, "
                           "treated as an outcome for this goal.",
            "outcomes": [c],
            "extra_outcomes": [c],
        })
    return goals


def candidate_conditions(frame: pd.DataFrame, schema: Schema) -> dict:
    """Conditions available for a goal: mapped ones, plus unmapped columns that could be."""
    present = [c for c in frame.columns if not c.startswith("_")]
    mapped = {v.name for v in schema.variables.values()}
    return {
        "mapped": [v.name for v in schema.by_role(Role.CONDITION) if v.name in present],
        "unmapped": [c for c in present if c not in mapped and frame[c].nunique(dropna=True) > 1
                     and infer_type(frame[c]) != VarType.TEXT],
    }


def split_options(frame: pd.DataFrame, schema: Schema) -> list[dict]:
    """What the discovery / held-out split can keep together, from the dataset's columns.

    Experiments that share a source file, campaign or facility may not be independent;
    splitting by that group keeps them on one side so nothing leaks into the test part.
    """
    id_col = schema.id_column
    out = []
    if id_col and id_col in frame:
        out.append({"column": id_col, "label": "Experiment (default)",
                    "groups": int(frame[id_col].nunique())})
    if "_source_id" in frame and frame["_source_id"].nunique() > 1:
        out.append({"column": "_source_id", "label": "Source file",
                    "groups": int(frame["_source_id"].nunique())})
    mapped = {v.name for v in schema.variables.values() if v.role != Role.META}
    for c in frame.columns:
        if c.startswith("_") or c in mapped:
            continue
        n = frame[c].nunique(dropna=True)
        kind = infer_type(frame[c])
        if kind in (VarType.CATEGORICAL, VarType.TEXT) and 2 <= n <= len(frame) / 3:
            out.append({"column": c, "label": f"Column: {_label(c)}", "groups": int(n)})
    return out
