from pathlib import Path

import pandas as pd
import pytest

from falmex.ingest import read_file
from falmex.pipeline import standardize
from falmex.services import ingest_upload

FIXTURE = Path(__file__).parent / "fixtures" / "PSI-69_FLEX_regression.csv"


def _standardized_flex(schema):
    result = read_file(FIXTURE.name, FIXTURE.read_bytes())
    frame, report = standardize(result.tables[0].frame, schema, "37c88ce8ae9391b7")
    return result, frame, report


def test_real_flex_cp1252_and_adapter_decisions(schema):
    result, frame, report = _standardized_flex(schema)
    assert result.metadata["encoding"] == "cp1252"
    assert result.metadata["adapter"] == "nasa_flex_psi69"
    assert result.metadata["approximate_burn_time_test_ids"] == ["223", "224"]
    assert result.metadata["invalid_pressure_test_ids"] == ["114"]
    assert len(frame) == 7
    assert report.rows_in == report.rows_out == 7


def test_flex_identifiers_units_and_missing_markers(schema):
    _, frame, report = _standardized_flex(schema)
    rows = frame.set_index("experiment_id")

    assert set(rows.index) == {"1", "20", "24", "40", "114", "223", "224"}
    assert rows.loc["1", "oxygen"] == pytest.approx(21.0)
    assert rows.loc["1", "pressure"] == pytest.approx(757.7 * 0.133322368)
    # FLEX K is D² per time. It must never enter the generic mm/s burning_rate variable.
    assert rows.loc["1", "droplet_burning_rate_constant"] == pytest.approx(0.52)
    assert schema.get("droplet_burning_rate_constant").unit == "mm2_per_s"
    assert "burning_rate" not in frame.columns
    assert pd.isna(rows.loc["24", "initial_droplet_diameter"])
    assert pd.isna(rows.loc["40", "visible_extinction_diameter"])

    conversions = {item["column"]: item for item in report.to_dict()["unit_conversions"]}
    assert conversions["oxygen"]["from"] == "mole fraction"
    assert conversions["oxygen"]["to"] == "percent_o2"
    assert conversions["pressure"]["from"] == "mmHg"
    assert conversions["pressure"]["to"] == "kPa"


def test_flex_invalid_pressure_is_flagged_not_accepted_or_dropped(schema):
    _, frame, _ = _standardized_flex(schema)
    row = frame.set_index("experiment_id").loc["114"]
    assert pd.isna(row["pressure"])
    assert row["ambient_pressure_raw_mmhg"] == 0
    assert row["pressure_quality"] == "invalid_nonpositive"
    assert row["visible_extinction_diameter"] == pytest.approx(1.68)


def test_flex_approximate_burn_time_and_three_endpoints(schema):
    _, frame, _ = _standardized_flex(schema)
    rows = frame.set_index("experiment_id")

    assert rows.loc["223", "burn_time"] == 6
    assert rows.loc["224", "burn_time"] == 9
    assert bool(rows.loc["223", "burn_time_approximate"])
    assert rows.loc["223", "burn_time_original"] == "~6"
    assert set(frame["test_end"].dropna()) == {"Extinction", "Disruption", "Completion"}

    assert rows.loc["114", "test_end_extinction_versus_completion"] == True  # noqa: E712
    assert rows.loc["224", "test_end_extinction_versus_completion"] == False  # noqa: E712
    assert pd.isna(rows.loc["1", "test_end_extinction_versus_completion"])
    assert frame["test_end_extinction_versus_completion"].isna().sum() == 3


def test_flex_ingestion_metadata_is_persisted(schema, store):
    dataset, source, _ = ingest_upload(store, schema, FIXTURE.name, FIXTURE.read_bytes())
    assert dataset is not None
    assert dataset.report["ingestion"] == [{
        **read_file(FIXTURE.name, FIXTURE.read_bytes()).metadata,
        "source_id": source.source_id,
        "filename": FIXTURE.name,
        "sha256": source.sha256,
    }]
    assert len(store.load_frame(dataset.dataset_id)) == 7


def test_flex_d2_quantities_are_derived_not_regressed(schema):
    _, frame, _ = _standardized_flex(schema)
    row = frame.set_index("experiment_id").loc["114"]
    expected_residual = 3.23**2 - 1.68**2 - 0.42 * 18.9

    assert row["extinction_diameter_ratio"] == pytest.approx(1.68 / 3.23)
    assert row["d2_law_residual_mm2"] == pytest.approx(expected_residual)
    assert row["d2_law_normalized_residual"] == pytest.approx(expected_residual / 3.23**2)
    assert schema.get("d2_law_residual_mm2").role.value == "meta"
    assert pd.isna(frame.set_index("experiment_id").loc["24", "d2_law_residual_mm2"])


def test_open_discovery_runs_on_an_uploaded_flex_table(tmp_path):
    """Dry run for real challenge data: upload the PSI-69 table as a user would and run
    open discovery. Bootstrap resamples repeat row labels; this used to fail with
    'cannot reindex on an axis with duplicate labels'."""
    from pathlib import Path

    from fastapi.testclient import TestClient

    from falmex.ai.providers import MockProvider
    from falmex.api import create_app
    from falmex.settings import Settings

    seed = Path(__file__).resolve().parents[1] / "review_seed"
    table = seed / "PSI-69_Experimental table_FLEX.csv"
    app = create_app(Settings(data_dir=tmp_path, llm_provider="mock"), provider=MockProvider())
    with TestClient(app) as client:
        upload = client.post("/api/datasets", files={"file": (table.name, table.read_bytes())})
        assert upload.status_code == 201
        dataset = upload.json()["dataset"]["dataset_id"]
        result = client.post(f"/api/datasets/{dataset}/discover", json={})
        assert result.status_code == 200, result.text
        assert result.json()["tested"] > 0
