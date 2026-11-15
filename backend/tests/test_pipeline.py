import pandas as pd
import pytest

from falmex.pipeline import ROW_COL, SOURCE_COL, standardize


def test_maps_aliases_and_converts_units(schema):
    raw = pd.DataFrame({
        "Test ID": ["E1", "E2"],
        "Pressure (atm)": [1.0, 0.5],
        "O2 [fraction]": [0.21, 0.4],
        "temperature_C": [20.0, 0.0],
        "Flow (m/s)": [0.1, 0.2],
        "Fuel": [" PMMA ", "Cotton"],
    })
    out, report = standardize(raw, schema, "src1")
    assert out["pressure"].tolist() == pytest.approx([101.325, 50.6625])
    assert out["oxygen"].tolist() == pytest.approx([21.0, 40.0])
    assert out["temperature"].tolist() == pytest.approx([293.15, 273.15])
    assert out["flow_rate"].tolist() == pytest.approx([10.0, 20.0])
    assert out["material"].tolist() == ["PMMA", "Cotton"]
    assert out["experiment_id"].tolist() == ["E1", "E2"]
    mapped = {c.raw: c.canonical for c in report.columns}
    assert mapped["Pressure (atm)"] == "pressure"


def test_booleans_and_coercion_failures(schema):
    raw = pd.DataFrame({
        "experiment_id": ["a", "b", "c", "d"],
        "extinguished": ["yes", "No", 1, "maybe"],
        "burning_rate": ["1.5", "x", None, 2],
    })
    out, report = standardize(raw, schema, "src")
    assert out["extinction"].tolist()[:3] == [True, False, True]
    assert pd.isna(out["extinction"].iloc[3])
    assert report.coercion_failures == {"extinction": 1, "burning_rate": 1}


def test_unknown_columns_kept_and_rows_cleaned(schema):
    raw = pd.DataFrame({
        "experiment_id": ["a", "a", None, "b"],
        "Camera Angle": [1, 1, None, 2],
    })
    out, report = standardize(raw, schema, "src")
    assert "camera_angle" in out.columns
    assert report.duplicate_rows_dropped == 1
    assert report.empty_rows_dropped == 1
    assert report.rows_out == 2


def test_provenance_and_generated_ids(schema):
    out, report = standardize(pd.DataFrame({"oxygen": [21, 22]}), schema, "abcdef1234")
    assert set(out[SOURCE_COL]) == {"abcdef1234"}
    assert out[ROW_COL].tolist() == [0, 1]
    assert out["experiment_id"].tolist() == ["abcdef12-0", "abcdef12-1"]
    assert any("generated IDs" in w for w in report.warnings)


def test_unknown_unit_warns(schema):
    _, report = standardize(pd.DataFrame({"pressure (furlongs)": [1]}), schema, "s")
    assert any("furlongs" in w for w in report.warnings)
