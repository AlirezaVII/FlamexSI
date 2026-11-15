import pandas as pd
import pytest

from falmex.storage import Filter


def _dataset(store):
    frame = pd.DataFrame({
        "experiment_id": ["E1", "E2", "E3"],
        "oxygen": [21.0, 30.0, 40.0],
        "material": ["PMMA", "Cotton", "PMMA"],
    })
    return store.create_dataset("t", frame, synthetic=False, source_ids=[], report={})


def test_save_raw_is_content_addressed(store):
    a = store.save_raw("a.csv", b"x,y\n1,2\n")
    b = store.save_raw("renamed.csv", b"x,y\n1,2\n")
    assert a.source_id == b.source_id
    assert a.filename == "a.csv"
    assert len(list(store.raw_dir.iterdir())) == 1


def test_dataset_roundtrip(store):
    ds = _dataset(store)
    assert store.get_dataset(ds.dataset_id).n_rows == 3
    assert [d.dataset_id for d in store.list_datasets()] == [ds.dataset_id]
    assert len(store.load_frame(ds.dataset_id)) == 3


def test_query_filters(store):
    ds = _dataset(store)
    rows, total = store.query_rows(ds.dataset_id, [Filter(field="oxygen", op="gte", value=30)])
    assert total == 2
    rows, total = store.query_rows(
        ds.dataset_id, [Filter(field="material", op="in", value=["Cotton"])]
    )
    assert [r["experiment_id"] for r in rows] == ["E2"]
    rows, _ = store.query_rows(ds.dataset_id, [], sort="oxygen", descending=True, limit=1)
    assert rows[0]["experiment_id"] == "E3"


def test_query_rejects_unknown_columns(store):
    ds = _dataset(store)
    with pytest.raises(ValueError):
        store.query_rows(ds.dataset_id, [Filter(field='oxygen" OR 1=1 --', value=1)])
    with pytest.raises(ValueError):
        store.query_rows(ds.dataset_id, [], sort="nope")


def test_findings_roundtrip(store):
    f = {"finding_id": "f1", "created_at": "2026-01-01T00:00:00Z", "score": 1}
    store.save_findings("d1", [f])
    assert store.get_finding("f1")["score"] == 1
    store.update_finding({**f, "score": 2})
    assert store.list_findings("d1")[0]["score"] == 2
    store.save_findings("d1", [])
    assert store.get_finding("f1") is None
