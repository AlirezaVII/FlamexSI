"""Saffire-I (PSI-98) and Saffire-II (PSI-99): which samples burned, and what the box saw.

Source: NASA PSI-98 "Saffire-I Sample <k> Sensor Data Complete TM graphs.xlsx" (k = 1, 2)
and PSI-99 "Saffire Sensor Data Sample <k>.xlsx" (k = 1..9), both flown on Cygnus cargo
craft, sheet "Calibrated Data" (about 30 readings per second; dates from its clock). Nothing is
modelled. Per sample, with fixed rules:
  conditions  median of the 30 s before the igniter came on: oxygen and CO2 (%), pressure
              (psia), air speed (mean of the two anemometers, cm/s), humidity, inlet air
  igniter     on = igniter current above 0.5 A; when it came on and for how long
  burned      a sample thermocouple (TC7-TC12, on the sample) stays more than 100 °C above
              its pre-ignition median for at least 5 s, counted only from 2 s after the
              igniter switched off (the hot igniter wire heats nearby thermocouples itself)
  flame       per responding thermocouple: peak rise and its time after ignition; how long
              the sample stayed hot (> 100 °C rise) after the igniter switched off; the time
              between the first and the last thermocouple peak (the flame front passing
              along the sample; no positions are given, so no speed)
  box         oxygen and CO2 change: median of the record's last 30 s minus the
              pre-ignition median, with the sensor's noise (half the 5-95% spread before
              ignition; the oxygen sensor steps by ~0.2% with no flame, so smaller changes
              are not readable); pressure rise (highest reading after ignition minus the
              median); the hottest plume thermocouple (TC1-TC6, downstream air)
  radiometers peak rise above the pre-ignition median; the igniter alone raises some
              radiometers by up to ~30 units, so they are not used to decide "burned"
Output: frontend/src/lib/flight/saffire12.json
Usage: python backend/scripts/build_saffire12_summary.py <folder with saffire1/ and saffire2/>
"""

import json
import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "frontend/src/lib/flight/saffire12.json"
SAMPLE_TC = [f"Sample Temp {i} (TC{i + 6})" for i in range(1, 7)]
PLUME_TC = [f"Plume Temp {i} (TC{i})" for i in range(1, 7)]
RAD = [f"Radiometer {i}" for i in range(1, 5)]
HOT, HOLD, AFTER = 100.0, 5.0, 2.0  # °C rise, seconds, seconds after the igniter is off
S1 = "saffire1/Saffire-I Sample {} Sensor Data Complete TM graphs.xlsx"
S2 = "saffire2/Saffire Sensor Data Sample {}.xlsx"
FLIGHTS = {
    "Saffire-I": {"psi": "PSI-98", "files": [(k, S1.format(k)) for k in (1, 2)]},
    "Saffire-II": {"psi": "PSI-99", "files": [(k, S2.format(k)) for k in range(1, 10)]},
}


def load(path: Path) -> pd.DataFrame:
    """The 'Calibrated Data' sheet; its second row holds the units."""
    df = pd.read_excel(path, sheet_name="Calibrated Data", skiprows=[1], engine="openpyxl")
    df = df.loc[:, [c for c in df.columns if not str(c).startswith("Unnamed")]]
    df.columns = [str(c) for c in df.columns]
    for c in df.columns:
        if c != "Timestamp (ms)":
            df[c] = pd.to_numeric(df[c], errors="coerce")
    return df


def r(x, nd=2):
    return None if x is None or not np.isfinite(x) else round(float(x), nd)


def summary(df: pd.DataFrame) -> dict:
    t = df["Elapsed Time (s)"]
    dt = float(t.diff().median())
    on = t[df["Igniter Current"] > 0.5]
    if on.empty:
        return {"igniter_on": False}
    t0, t_off = float(on.min()), float(on.max())
    pre = df[(t >= t0 - 30) & (t < t0)]
    post = df[t >= t0]
    when = pd.to_datetime(float(df["Epoch Time"].iloc[0]), unit="ms", utc=True)
    out: dict = {
        "recorded_utc": when.strftime("%Y-%m-%d %H:%M"),
        "igniter_on_at_s": r(t0, 1), "igniter_on_for_s": r(t_off - t0, 1),
        "igniter_peak_a": r(df["Igniter Current"].max()),
        "record_after_ignition_s": r(float(t.max()) - t0, 0),
        "before": {
            "oxygen_pct": r(pre["O2"].median()), "co2_pct": r(pre["CO2"].median(), 3),
            "pressure_psia": r(pre["Ambient Pressure"].median()),
            "air_speed_cm_s": r(pre[["Anemometer 1", "Anemometer 2"]].mean(axis=1).median(), 1),
            "humidity_pct": r(pre["Humidity"].median(), 1),
            "inlet_air_c": r(pre["Test Section Inlet Temp"].median(), 1),
        },
    }
    late = post["Elapsed Time (s)"] >= t_off + AFTER
    tcs, hot_until = [], None
    for c in SAMPLE_TC:
        rise = post[c] - pre[c].median()
        held = float((rise[late] > HOT).sum()) * dt
        if rise.max() <= HOT:
            continue
        hot_t = post["Elapsed Time (s)"][rise > HOT]
        tcs.append({"thermocouple": c.split("(")[1].rstrip(")"),
                    "peak_rise_c": r(rise.max(), 0),
                    "peak_c": r(post[c].max(), 0),
                    "peak_at_s": r(float(post.loc[rise.idxmax(), "Elapsed Time (s)"]) - t0, 1),
                    "hot_after_igniter_s": r(held, 1)})
        if held >= HOLD:
            hot_until = max(hot_until or 0.0, float(hot_t.max()))
    burned = any(x["hot_after_igniter_s"] >= HOLD for x in tcs)
    out["burned"] = burned
    out["sample_thermocouples"] = tcs
    if burned:
        out["hot_after_igniter_off_s"] = r(hot_until - t_off, 1)
        peaks = [x["peak_at_s"] for x in tcs if x["hot_after_igniter_s"] >= HOLD]
        if len(peaks) >= 2:
            out["front_lag_s"] = r(max(peaks) - min(peaks), 1)
    end = df[t >= float(t.max()) - 30]  # the last 30 s of the record
    plume = post[PLUME_TC].max() - pre[PLUME_TC].median()
    rad = post[RAD].max() - pre[RAD].median()
    out["box"] = {
        "oxygen_change_pct": r(end["O2"].median() - pre["O2"].median()),
        "oxygen_noise_pct": r((pre["O2"].quantile(0.95) - pre["O2"].quantile(0.05)) / 2),
        "co2_change_pct": r(end["CO2"].median() - pre["CO2"].median(), 3),
        "co2_noise_pct": r((pre["CO2"].quantile(0.95) - pre["CO2"].quantile(0.05)) / 2, 3),
        "pressure_rise_psia": r(post["Ambient Pressure"].max()
                                - pre["Ambient Pressure"].median(), 3),
        "plume_peak_rise_c": r(plume.max(), 0),
        "radiometer_peak_rise": r(rad.max(), 0),
    }
    if burned:  # 1 s bins from 10 s before ignition: hottest sample thermocouple rise
        w = df[(t >= t0 - 10)].copy()
        w["bin"] = ((w["Elapsed Time (s)"] - t0) // 1).astype(int)
        hot = (w[SAMPLE_TC] - pre[SAMPLE_TC].median()).max(axis=1)
        g = hot.groupby(w["bin"]).max()
        out["series"] = [[int(b), r(v, 0)] for b, v in g.items()]
    return out


def build(folder: Path) -> dict:
    flights = []
    for name, meta in FLIGHTS.items():
        samples = []
        for k, rel in meta["files"]:
            s = summary(load(folder / rel))
            samples.append({"sample": k, "file": Path(rel).name, **s})
            print(name, k, "burned" if s.get("burned") else "no", flush=True)
        flights.append({"name": name, "psi": meta["psi"],
                        "date_utc": min(s["recorded_utc"][:10] for s in samples),
                        "samples": samples,
                        "burned": [s["sample"] for s in samples if s.get("burned")]})
    return {
        "source": "NASA PSI-98 (Saffire-I) and PSI-99 (Saffire-II) per-sample sensor "
                  "workbooks, sheet 'Calibrated Data'",
        "method": __doc__.split("\n\n", 1)[1].split("Output:")[0].strip(),
        "rule": {"hot_rise_c": HOT, "hold_s": HOLD, "after_igniter_off_s": AFTER},
        "flights": flights,
        "note": "The workbooks name samples by number only; materials are not given in them, "
                "so none are claimed here.",
    }


if __name__ == "__main__":
    out = build(Path(sys.argv[1]))
    OUT.write_text(json.dumps(out, indent=1, ensure_ascii=False) + "\n")
    for f in out["flights"]:
        for s in f["samples"]:
            print(f["name"], s["sample"], {k: s.get(k) for k in
                  ("burned", "igniter_on_for_s", "hot_after_igniter_off_s", "front_lag_s")},
                  s["box"])
