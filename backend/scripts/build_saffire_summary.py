"""Saffire-III (PSI-100): the Cygnus telemetry of a real fire in a spacecraft, per sample.

Source: NASA PSI-100, "Saffire_Data_Table2017.161.00.42.03-EU.csv" (engineering units, Cygnus
flight of 5 June 2017). Cleaning: one row with a negative clock is dropped; radiometer values
of -1000 or less are "sensor off" sentinels and cabin channels that read exactly 0 are
missing values, both set empty. Time is RelativeSeconds / 1000.

Per ignited sample (igniter current above 0.5 A), with fixed rules:
  burn          a radiometer pair is "lit" while its mean is 10 units above its median of
                the 120 s before that sample's ignition; first/last lit time, peak and its time
  spread        the time between the peaks of the two radiometer pairs (the flame front passing
                one pair, then the other); no distance is given in the file, so no speed
  smoke         the first time the responding Cygnus scatter detector is 0.2 above its median
                of the 120 s before ignition for three samples in a row; peak and its time
  cabin         rise of pressure and temperature (max in the window minus the pre-ignition median)
Each sample's window runs from its ignition to the next sample's ignition (at most 15 min),
so one burn is never credited to another.
Output: frontend/src/lib/flight/saffire.json
Usage: python backend/scripts/build_saffire_summary.py <path to the EU csv>
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/src/lib/flight/saffire.json"
RAD = ["Radiometer1value", "Radiometer2value", "Radiometer3value", "Radiometer4value"]
PAIRS = {"radiometers 1+3": ["Radiometer1value", "Radiometer3value"],
         "radiometers 2+4": ["Radiometer2value", "Radiometer4value"]}
SCAT = ["CDH_F1PCM_SMK_DET_SCAT_SENS_P", "CDH_F2PCM_SMK_DET_SCAT_SENS_P"]
OBS = ["CDH_F1PCM_SMK_DET_OBS_SENS_P", "CDH_F2PCM_SMK_DET_OBS_SENS_P"]
PRES, TEMP = "F1PCM_AIR_PRES_EPS1_SIG_POS", "PCM_ETS_TEMP_SIG"


def load(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df.columns = [c.replace("P@", "").replace("sfsHk.", "") for c in df.columns]
    df = df[df["RelativeSeconds"] >= 0].copy()
    df["s"] = df["RelativeSeconds"] / 1000
    for c in RAD:
        df.loc[df[c] <= -1000, c] = np.nan
    for c in SCAT + OBS + [PRES, TEMP]:
        df.loc[df[c] == 0, c] = np.nan
    return df


def first_run(mask: pd.Series, times: pd.Series, n: int = 3):
    run = mask.astype(int).rolling(n).sum() >= n
    hit = times[run.to_numpy()]
    return float(hit.iloc[0]) - (n - 1) * 0.5 if len(hit) else None


def ignitions(df: pd.DataFrame) -> dict[int, float]:
    out = {}
    for k in range(1, 10):
        on = df[df[f"Sample{k}IgniterCurrent"] > 0.5]
        if not on.empty:
            out[k] = float(on["s"].min())
    return out


def sample_summary(df: pd.DataFrame, k: int, t_next: float | None) -> dict:
    """One sample, from its ignition until the next sample is ignited (at most 15 min)."""
    on = df[df[f"Sample{k}IgniterCurrent"] > 0.5]
    t0 = float(on["s"].min())
    end = min(t0 + 900, t_next) if t_next else t0 + 900
    pre = df[(df["s"] >= t0 - 120) & (df["s"] < t0)]
    win = df[(df["s"] >= t0) & (df["s"] < end)]
    out = {"sample": k, "ignition_s": round(t0, 1), "window_s": round(end - t0, 1),
           "igniter_on_s": round(float(on["s"].max()) - t0, 1), "pairs": {}}
    for name, cols in PAIRS.items():
        base = float(pre[cols].mean(axis=1).median())
        sig = win[cols].mean(axis=1)
        lit = win["s"][sig > base + 10]
        if lit.empty:
            out["pairs"][name] = {"lit": False}
            continue
        i = sig.idxmax()
        out["pairs"][name] = {
            "lit": True, "first_s": round(float(lit.min()) - t0, 1),
            "last_s": round(float(lit.max()) - t0, 1),
            "peak": round(float(sig.max() - base), 1),
            "peak_s": round(float(win.loc[i, "s"]) - t0, 1)}
    lit_pairs = [p for p in out["pairs"].values() if p["lit"]]
    if lit_pairs:
        out["burn_s"] = round(max(p["last_s"] for p in lit_pairs)
                              - min(p["first_s"] for p in lit_pairs), 1)
    if len(lit_pairs) == 2:
        out["spread_lag_s"] = round(abs(lit_pairs[1]["peak_s"] - lit_pairs[0]["peak_s"]), 1)
    det = {}
    for c in SCAT + OBS:
        b = pre[c].median()
        w = win[["s", c]].dropna()
        if w.empty or np.isnan(b):
            det[c] = {"responded": False}
            continue
        t = first_run(w[c] > b + 0.2, w["s"])
        det[c] = {"responded": t is not None, "baseline": round(float(b), 3),
                  "peak": round(float(w[c].max()), 3)}
        if t is not None:
            det[c]["first_s"] = round(t - t0, 1)
            det[c]["peak_s"] = round(float(w.loc[w[c].idxmax(), "s"]) - t0, 1)
    out["detectors"] = det
    for key, c, unit in [("pressure", PRES, "psi"), ("temperature", TEMP, "°C")]:
        b, m = pre[c].median(), win[c].max()
        out[key] = {"before": round(float(b), 3), "max": round(float(m), 3),
                    "rise": round(float(m - b), 3), "unit": unit}
    return out


def series(df: pd.DataFrame, t_from: float, t_to: float) -> list[list]:
    w = df[(df["s"] >= t_from) & (df["s"] <= t_to)].copy()
    w["bin"] = (w["s"] // 10) * 10
    g = w.groupby("bin").agg({**{c: "mean" for c in RAD}, SCAT[1]: "mean"})
    return [[round(float(b), 0), round(float(r[RAD[0]] + r[RAD[2]]) / 2, 1),
             round(float(r[RAD[1]] + r[RAD[3]]) / 2, 1),
             None if np.isnan(r[SCAT[1]]) else round(float(r[SCAT[1]]), 3)]
            for b, r in g.iterrows()]


def build(path: Path) -> dict:
    df = load(path)
    ign = ignitions(df)
    times = sorted(ign.values())
    samples = [sample_summary(df, k, next((t for t in times if t > t0), None))
               for k, t0 in ign.items()]
    t_first = min(s["ignition_s"] for s in samples)
    return {
        "source": "NASA PSI-100 (Saffire-III), Saffire_Data_Table2017.161.00.42.03-EU.csv, "
                  "Cygnus telemetry of 5 June 2017",
        "method": __doc__.split("\n\n", 1)[1].split("Output:")[0].strip(),
        "samples": sorted(samples, key=lambda s: s["ignition_s"]),
        "ignited_in_file": [s["sample"] for s in samples],
        "series_columns": ["t_s", "radiometers 1+3", "radiometers 2+4", "smoke scatter F2"],
        "series_t0": t_first,
        "series": series(df, t_first - 120, t_first + 1300),
    }


if __name__ == "__main__":
    out = build(Path(sys.argv[1]))
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    for s in out["samples"]:
        print(json.dumps({k: v for k, v in s.items() if k != "detectors"}))
        print("  detectors:", {k[-12:]: v for k, v in s["detectors"].items()})
