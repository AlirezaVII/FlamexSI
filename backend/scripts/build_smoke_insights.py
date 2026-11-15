"""Smoke detection evidence from NASA SAME (2007) and SAME-R (2010), PSI-101 / PSI-102.

Reads backend/falmex/datasets/PSI-101_SAME_smoke_tests.csv (build_same_table.py) and tests
three questions, each in both flights separately, so the second flight is a replication:
  1 aging      does smoke held in the chamber grow? Paired: the same sample before and after
               secondary aging (test "23" vs "23a"); exact sign test.
  2 material   do materials make different particle sizes? Kruskal-Wallis on the count mean
               diameter of unaged smoke (aging under 120 s).
  3 detector   does the ISS smoke detector (light scattering) respond to particle size beyond
               the amount of smoke? Spearman partial correlation of detector signal with count
               mean diameter, holding the mass moment M1 fixed; 2000 shuffles.
DBP (dibutyl phthalate) is a calibration aerosol, not a fire fuel, and is left out.
Output: frontend/src/lib/flight/smoke.json
"""

import json
import re
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend/falmex/datasets/PSI-101_SAME_smoke_tests.csv"
OUT = ROOT / "frontend/src/lib/flight/smoke.json"
D = "count_mean_diameter_um"
DET = "iss_detector_scatter_v"
M1 = "mass_moment_m1"
FRESH = 120  # s of aging below which smoke counts as fresh
CEILING = 6.1  # V; readings above this are at the detector's full-scale output
rng = np.random.default_rng(7)


def aging(g: pd.DataFrame) -> dict:
    pairs = []
    for _, r in g[g["test_id"].str.match(r"^\d+\s*a$")].iterrows():
        base = g[g["test_id"] == re.sub(r"\s*a$", "", r["test_id"])]
        if len(base) and pd.notna(base.iloc[0][D]) and pd.notna(r[D]):
            pairs.append({"material": r["material"], "before": base.iloc[0][D], "after": r[D],
                          "aging_s": r["aging_time_s"]})
    p = pd.DataFrame(pairs)
    grew = int((p["after"] > p["before"]).sum())
    return {"pairs": len(p), "grew": grew,
            "median_ratio": round(float((p["after"] / p["before"]).median()), 2),
            "p_value": float(stats.binomtest(grew, len(p)).pvalue),
            "median_aging_s": round(float(p["aging_s"].median()))}


def material(g: pd.DataFrame) -> dict:
    fresh = g[(g["aging_time_s"] < FRESH) & g[D].notna()]
    groups = {m: x[D].to_numpy() for m, x in fresh.groupby("material") if len(x) >= 3}
    h = stats.kruskal(*groups.values()) if len(groups) >= 2 else None
    return {"p_value": float(h.pvalue) if h else None,
            "fresh_median_um": {m: round(float(np.median(v)), 3) for m, v in groups.items()},
            "n": {m: len(v) for m, v in groups.items()}}


def partial(x, y, z) -> float:
    rx, ry, rz = (pd.Series(v).rank().to_numpy() for v in (x, y, z))
    res = [a - np.polyval(np.polyfit(rz, a, 1), rz) for a in (rx, ry)]
    return float(np.corrcoef(*res)[0, 1])


def detector(g: pd.DataFrame) -> dict:
    h = g.dropna(subset=[DET, D, M1])
    r = partial(h[DET], h[D], h[M1])
    null = [partial(rng.permutation(h[DET].to_numpy()), h[D], h[M1]) for _ in range(2000)]
    return {"n": len(h), "partial_rho": round(r, 3),
            "shuffles_as_strong": int(sum(abs(v) >= abs(r) for v in null)), "shuffles": 2000,
            "rho_with_mass": round(float(stats.spearmanr(h[DET], h[M1]).statistic), 3),
            "rho_with_size": round(float(stats.spearmanr(h[DET], h[D]).statistic), 3)}


def build() -> dict:
    df = pd.read_csv(DATA, dtype={"test_id": str})
    fuels = df[~df["calibration_aerosol"]]
    flights = {fl: {"tests": len(g), "aging": aging(g), "material": material(g),
                    "detector": detector(g)} for fl, g in fuels.groupby("flight")}
    det = fuels.dropna(subset=[DET])
    by_material = []
    for m, g in fuels.groupby("material"):
        d = g.dropna(subset=[DET])
        by_material.append({
            "material": m, "tests": len(g),
            "fresh_diameter_um": round(float(g.loc[g["aging_time_s"] < FRESH, D].median()), 3),
            "aged_diameter_um": round(float(g.loc[g["aging_time_s"] >= 400, D].median()), 3),
            "detector_median_v": round(float(d[DET].median()), 2),
            "at_full_scale": round(float((d[DET] > CEILING).mean()), 2),
        })
    by_material.sort(key=lambda m: m["fresh_diameter_um"])
    return {
        "source": "NASA PSI-101 (SAME-R) and PSI-102 (SAME), 'Combined SAMER Results' reduced "
                  "data, sheet 'Reduced Data with ISS Det'",
        "method": __doc__.split("\n\n", 1)[1].split("Output:")[0].strip(),
        "tests": len(df), "fuel_tests": len(fuels),
        "full_scale_share": round(float((det[DET] > CEILING).mean()), 2),
        "flights": flights, "materials": by_material,
    }


if __name__ == "__main__":
    out = build()
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    for fl, v in out["flights"].items():
        print(fl, v["aging"], v["material"]["p_value"], v["detector"])
    for m in out["materials"]:
        print(m)
