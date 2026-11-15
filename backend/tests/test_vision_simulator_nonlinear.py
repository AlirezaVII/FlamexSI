"""Footage metrics (vision), flammability map, interaction/curvature analyzers and chart data."""

import numpy as np
import pandas as pd
import pytest

from falmex import synthetic, vision
from falmex.analysis import get_analyzers
from falmex.engine import DiscoveryConfig, run_discovery
from falmex.flammability import flammability_map
from falmex.pipeline import standardize


# ---- non-linear analyzers ------------------------------------------------------------------
def _discover(frame, schema, analyzers):
    return run_discovery(frame, schema, dataset_id="t", synthetic=True,
                         config=DiscoveryConfig(analyzers=analyzers))


def test_interaction_finds_the_planted_one_and_nothing_else(schema):
    for seed in (1, 5):
        frame, _ = standardize(synthetic.generate(300, seed=seed), schema, "s")
        found = _discover(frame, schema, ["interaction"])
        validated = {(f.condition, f.outcome) for f in found if f.status == "validated"}
        assert validated == synthetic.INTERACTIONS
        f = next(x for x in found if (x.condition, x.outcome) in synthetic.INTERACTIONS)
        assert "stronger at higher flow rate" in f.headline
        assert f.details["focus"] == "oxygen"
        # combined conditions get no single-column deep probes, and evidence still works
        assert f.deep == [] and f.evidence.n_experiments == 300


def test_curvature_detects_a_real_bend_and_not_a_straight_line(schema):
    rng = np.random.default_rng(0)
    n = 240
    x = rng.uniform(15, 40, n)
    frame = pd.DataFrame({
        "experiment_id": [f"E{i}" for i in range(n)],
        "oxygen": x,
        "pressure": rng.uniform(30, 110, n),
        "burning_rate": -0.01 * (x - 27.5) ** 2 + rng.normal(0, 0.3, n),  # peaks mid-range
        "flame_length": 0.2 * x + rng.normal(0, 0.5, n),  # a straight line
    })
    found = _discover(frame, schema, ["curvature"])
    status = {(f.condition, f.outcome): f for f in found}
    bend = status[("oxygen", "burning_rate")]
    assert bend.status == "validated" and bend.details["bend"] == "downward"
    assert 24 < bend.details["turning_point"] < 31
    assert status[("oxygen", "flame_length")].status != "validated"
    assert all(f.status != "validated" for f in found if f.condition == "pressure")


def test_freedman_lane_keeps_main_effects(schema):
    frame, _ = standardize(synthetic.generate(200, seed=2), schema, "s")
    analyzer = get_analyzers(["interaction"])[0]
    data = frame[["oxygen", "flow_rate", "burn_time"]].dropna()
    shuffled = analyzer.permute(data, "oxygen × flow_rate", "burn_time",
                                np.random.default_rng(0))
    # the oxygen main effect survives the permutation; only the interaction is destroyed
    assert np.corrcoef(shuffled["oxygen"], shuffled["burn_time"])[0, 1] < -0.6


# ---- chart data ----------------------------------------------------------------------------
def test_chart_rebuilds_the_exact_split_and_fits_on_discovery_only(client):
    did = client.post("/api/datasets/synthetic",
                      json={"n_experiments": 300, "seed": 3}).json()["dataset"]["dataset_id"]
    found = client.post(f"/api/datasets/{did}/discover", json={}).json()["findings"]
    f = next(x for x in found if x["analyzer"] == "rank_correlation"
             and x["status"] == "validated")
    chart = client.get(f"/api/findings/{f['finding_id']}/chart").json()
    assert chart["holdout_points"] == f["split"]["holdout_rows"]
    assert chart["discovery_points"] == f["split"]["discovery_rows"]
    assert {p["split"] for p in chart["points"]} == {"discovery", "holdout"}
    t = chart["trend"]
    assert t and len(t["x"]) == len(t["y"]) == len(t["low"]) == len(t["high"])
    assert all(lo <= y <= hi for lo, y, hi in zip(t["low"], t["y"], t["high"], strict=True)
               if None not in (lo, y, hi))

    coloured = client.get(f"/api/findings/{f['finding_id']}/chart",
                          params={"color_by": "material"}).json()
    assert coloured["color_kind"] == "categorical"
    assert client.get(f"/api/findings/{f['finding_id']}/chart",
                      params={"color_by": "nope"}).status_code == 422

    inter = next(x for x in found if x["analyzer"] == "interaction"
                 and x["status"] == "validated")
    ichart = client.get(f"/api/findings/{inter['finding_id']}/chart").json()
    assert ichart["x"] == "oxygen" and ichart["color_by"] == "flow_rate"


# ---- flammability map ----------------------------------------------------------------------
def test_flammability_map_recovers_a_known_boundary():
    rng = np.random.default_rng(4)
    n = 600
    oxygen = rng.uniform(12, 40, n)
    gravity = rng.choice([0.0, 0.16, 0.38, 1.0], n)
    # true 50% boundary: oxygen = 20 + 6·gravity (more oxygen needed at higher gravity)
    logit = 0.8 * (oxygen - (20 + 6 * gravity))
    burned = rng.random(n) < 1 / (1 + np.exp(-logit))
    frame = pd.DataFrame({"oxygen": oxygen, "gravity": gravity, "extinction": ~burned})
    out = flammability_map(frame, axis="gravity", material=None, pressure=None,
                           at_x=0.38, at_oxygen=30.0)
    pt = out["point"]
    assert abs(pt["oxygen_limit_50"] - (20 + 6 * 0.38)) < 1.0
    lo, hi = pt["oxygen_limit_ci"]
    assert lo < 20 + 6 * 0.38 < hi
    assert pt["p_burn"] > 0.95 and pt["extrapolation"] == []
    edges = {b["x"]: b["oxygen"] for b in out["boundary"]}
    assert edges[min(edges)] < edges[max(edges)]  # boundary rises with gravity


def test_flammability_map_refuses_thin_data():
    frame = pd.DataFrame({"oxygen": [20.0] * 10, "gravity": [0.0] * 10,
                          "extinction": [True] * 10})
    with pytest.raises(ValueError, match="Not enough data"):
        flammability_map(frame, axis="gravity", material=None, pressure=None,
                         at_x=None, at_oxygen=None)
    with pytest.raises(ValueError, match="no flow_rate"):
        flammability_map(frame, axis="flow_rate", material=None, pressure=None,
                         at_x=None, at_oxygen=None)


def test_flammability_and_reference_limit_api(client):
    did = client.post("/api/datasets/synthetic",
                      json={"n_experiments": 300, "seed": 1}).json()["dataset"]["dataset_id"]
    res = client.post(f"/api/datasets/{did}/flammability",
                      json={"axis": "gravity", "at_x": 0.38, "at_oxygen": 21}).json()
    assert res["synthetic"] is True and res["n"] == 300
    assert "pressure" in res["predictors"] and res["materials"]
    assert client.post(f"/api/datasets/{did}/flammability",
                       json={"axis": "nonsense"}).status_code == 422

    body = {"material": "PMMA", "oxygen_percent": 18.0, "source": "A cited report, p. 3",
            "entered_by": "QA"}
    assert client.post("/api/reference-limits", json={**body, "source": ""}).status_code == 422
    made = client.post("/api/reference-limits", json=body).json()
    assert [x["limit_id"] for x in client.get("/api/reference-limits").json()] == \
        [made["limit_id"]]
    assert client.delete(f"/api/reference-limits/{made['limit_id']}").status_code == 204
    assert client.delete(f"/api/reference-limits/{made['limit_id']}").status_code == 404


# ---- vision --------------------------------------------------------------------------------
def test_vision_measures_known_ground_truth(tmp_path):
    clip = tmp_path / "clip.avi"
    vision.synthetic_clip(clip)
    out = vision.analyze(clip, tmp_path / "frames", vision.Calibration(mm_per_px=0.1))
    s = out["summary"]
    # ground truth: the clip's ellipse has semi-axes r and r·(1 + 0.004·i), r = 20 + 40·t px,
    # so the equivalent radius is r·sqrt(1 + 0.004·i); growth runs to frame 53 at 24 fps
    i = np.arange(54)
    t = i / 24
    true = np.polyfit(t, (20 + 40 * t) * np.sqrt(1 + 0.004 * i), 1)[0] * 0.1  # mm/s
    assert abs(s["growth_rate"] - true) / true < 0.02 and s["growth_fit_r2"] > 0.98
    assert s["extinguished_in_clip"] is True
    assert s["circularity_median"] > 0.9  # near-circular outline
    assert s["blue_fraction_median"] > 0.4 and s["soot_fraction_median"] > 0.15
    assert out["frames"][-1]["present"] is False
    assert any(f.get("image") for f in out["frames"])
    assert len(list((tmp_path / "frames").glob("frame_*.jpg"))) == out["frames_analyzed"]


def test_vision_shape_metric_separates_circle_from_elongated(tmp_path):
    import cv2

    for name, axes, expect in (("circle", (60, 60), "high"), ("long", (25, 90), "low")):
        img = np.zeros((300, 300, 3), np.uint8)
        cv2.ellipse(img, (150, 150), axes, 0, 0, 360, (255, 140, 40), -1)
        path = tmp_path / f"{name}.png"
        cv2.imwrite(str(path), img)
        c = vision.analyze(path, tmp_path / name)["summary"]["circularity_median"]
        assert (c > 0.95) if expect == "high" else (c < 0.75)


def test_media_api_analyze_and_attach(client):
    src = client.post("/api/media/synthetic").json()["source"]
    sid = src["source_id"]
    assert src["synthetic"] is True
    listed = client.get("/api/media").json()
    assert listed[0]["analyzed"] is False and listed[0]["kind"] == "video"
    assert client.get(f"/api/media/{sid}/analysis").status_code == 404

    res = client.post(f"/api/media/{sid}/analyze", json={"fps": 24}).json()
    assert res["synthetic"] is True and res["summary"]["growth_rate_unit"] == "px/s"
    img = next(f["image"] for f in res["frames"] if f.get("image"))
    assert client.get(f"/api/media/{sid}/frames/{img}").status_code == 200
    assert client.get(f"/api/media/{sid}/frames/..%2Fx.jpg").status_code == 404

    did = client.post("/api/datasets/synthetic",
                      json={"n_experiments": 50, "seed": 0}).json()["dataset"]["dataset_id"]
    att = client.post(f"/api/media/{sid}/attach",
                      json={"dataset_id": did, "experiment_id": "SYN-0001"}).json()
    assert "flame_circularity" in att["written"]
    assert "flame_growth_rate" in att["skipped"]  # not calibrated -> no length columns
    rows = client.post(f"/api/datasets/{did}/query", json={
        "filters": [{"field": "experiment_id", "op": "eq", "value": "SYN-0001"}]}).json()
    assert rows["rows"][0]["flame_circularity"] == att["written"]["flame_circularity"]

    csv = b"experiment_id,oxygen\nE1,21\nE2,30\n"
    real = client.post("/api/datasets", files={"file": ("r.csv", csv, "text/csv")}).json()
    assert client.post(f"/api/media/{sid}/attach", json={
        "dataset_id": real["dataset"]["dataset_id"], "experiment_id": "E1"}).status_code == 409


def test_bright_page_is_not_reported_as_a_flame():
    import cv2
    import numpy as np

    from falmex import vision

    page = np.full((400, 600, 3), 245, np.uint8)  # a screenshot / slide
    cv2.circle(page, (150, 150), 50, (120, 150, 220), -1)
    m = vision._measure(page, vision._threshold([page]))
    assert m["present"] is False and "frame" in m["rejected"]
    s = vision.summarize([{**m, "index": 0, "time_s": None}], None, None)
    assert s["note"].startswith("This does not look like flame footage")


def test_orange_button_on_dark_page_is_not_a_flame():
    import cv2
    import numpy as np

    from falmex import vision

    page = np.full((400, 600, 3), 25, np.uint8)  # dark app screenshot with an orange button
    cv2.rectangle(page, (400, 150), (520, 190), (60, 120, 230), -1)
    m = vision._measure(page, vision._threshold([page]))
    assert m["present"] is False and "rectangle" in m["rejected"]
