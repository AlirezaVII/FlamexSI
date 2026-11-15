import io
import json

import pandas as pd
import pytest

from falmex.ingest import UnsupportedFileError, read_file
from falmex.schema import Role, normalize_name


def test_normalize_name():
    assert normalize_name("Oxygen Concentration (%)") == "oxygen_concentration"
    assert normalize_name("  Flow-Rate ") == "flow_rate"


def test_schema_resolves_aliases(schema):
    assert schema.resolve("O2") == "oxygen"
    assert schema.resolve("Ambient Pressure") == "pressure"
    assert schema.resolve("Exp ID") == "experiment_id"
    assert schema.resolve("something_else") is None
    assert schema.id_column == "experiment_id"
    assert {v.name for v in schema.by_role(Role.OUTCOME)} >= {"extinction", "burning_rate"}


def test_read_csv_and_semicolon_csv():
    result = read_file("a.csv", b"oxygen,pressure\n21,101\n30,50\n")
    assert result.tables[0].frame.shape == (2, 2)
    result = read_file("b.csv", b"oxygen;pressure\n21;101\n")
    assert list(result.tables[0].frame.columns) == ["oxygen", "pressure"]


def test_read_json_records_and_wrapped():
    data = [{"oxygen": 21, "meta": {"material": "PMMA"}}]
    frame = read_file("a.json", json.dumps(data).encode()).tables[0].frame
    assert "meta.material" in frame.columns
    wrapped = read_file("b.json", json.dumps({"experiments": data}).encode())
    assert len(wrapped.tables[0].frame) == 1


def test_read_excel_multiple_sheets():
    buf = io.BytesIO()
    with pd.ExcelWriter(buf) as writer:
        pd.DataFrame({"oxygen": [21]}).to_excel(writer, sheet_name="s1", index=False)
        pd.DataFrame({"oxygen": [30]}).to_excel(writer, sheet_name="s2", index=False)
    result = read_file("a.xlsx", buf.getvalue())
    assert [t.name for t in result.tables] == ["s1", "s2"]


def test_media_files_become_assets():
    result = read_file("flame.mp4", b"\x00" * 10)
    assert result.tables == []
    assert result.assets[0].media_type == "video"


def test_unsupported_file():
    with pytest.raises(UnsupportedFileError):
        read_file("a.exe", b"")
