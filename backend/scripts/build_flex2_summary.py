"""FLEX-2 (PSI-68) raw instrument logs -> one summary row per test point.

Reads, for each test point, NASA's main log "<TEST>.txt" (sequence timestamps and a 1 Hz table
of the narrow- and wide-view radiometers with chamber pressure and temperature) and
"<TEST>_MDCA_Testpoint_Settings.txt" (commanded settings). Nothing is modelled. Per test:
  sequence    date, igniter on time and power, the burn-to-completion window
  setup       fiber-supported or free droplet, which fuel dispenser, soot sampler used
  flame       wide-view radiometer (the narrow one saturates); baseline = median of the
              readings before the igniter came on; "lit" = 1 Hz readings above 20% of the
              peak (the slow decay of hot gas afterwards is not counted). The hot igniter
              wire itself glows, so a flame is "seen" only when the radiometer stays lit for
              at least 2 s starting 1 s after the igniter switched off; flame seconds =
              lit readings; first flame = first lit reading
  chamber     median pressure (psia) and temperature (°C); their rise during the test
The atmosphere (oxygen, diluent) is not in this table, and not in NASA's public files: the
per-test "<TEST>_Chamber_Readings.txt" logs were checked (686 of 690 download; 4 return "File
not found") and hold only four pressure transducers (psia) and four temperatures (°C).
Output: backend/falmex/datasets/PSI-68_FLEX2_test_summary.csv and
frontend/src/lib/flight/flex2.json
Usage: python backend/scripts/build_flex2_summary.py <folder with the downloaded txt files>
"""

import csv
import json
import re
import sys
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT_CSV = ROOT / "backend/falmex/datasets/PSI-68_FLEX2_test_summary.csv"
OUT_JSON = ROOT / "frontend/src/lib/flight/flex2.json"
ROW = re.compile(
    r"^(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+(\d{4}-\d\d-\d\d \d\d:\d\d:\d\d\.\d+)\s+"
    r"([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)(?:\s+\d+){8}\s+([-\d.]+)\s+([-\d.]+)\s*$")
TS = "%Y-%m-%d %H:%M:%S.%f"


def header(text: str) -> dict:
    out = {}
    for line in text.splitlines():
        m = re.match(r"^([A-Za-z][^:\t]*?):\t+(.*)$", line)
        if m:
            out[m.group(1).strip()] = m.group(2).strip()
    return out


def when(s: str | None):
    try:
        return datetime.strptime(s, TS) if s else None
    except ValueError:
        return None


def settings(path: Path) -> dict:
    if not path.is_file():
        return {}
    rows = list(csv.reader(path.open(encoding="latin-1")))
    return dict(zip(rows[0], rows[1], strict=False)) if len(rows) > 1 else {}


def summarize(test: str, folder: Path) -> dict | None:
    main = folder / f"{test}.txt"
    if not main.is_file() or main.stat().st_size < 200:
        return None
    text = main.read_text(encoding="latin-1")
    h = header(text)
    s = settings(folder / f"{test}_MDCA_Testpoint_Settings.txt")
    rows = [m.groups() for line in text.splitlines() if (m := ROW.match(line.strip()))]
    ign = when(h.get("AS Burn to Completion/Igniter On"))
    rec = {
        "test_point": test,
        "date": (ign or when(h.get("AS Started")) or datetime(1, 1, 1)).date().isoformat()
        if (ign or when(h.get("AS Started"))) else None,
        "igniter_on_ms": pd.to_numeric(h.get("Igniter On Time (milliseconds)"), errors="coerce"),
        "igniter_w": pd.to_numeric(h.get("Igniter Wattage"), errors="coerce"),
        "burn_window_ms": pd.to_numeric(h.get("Burn to Completion (milliseconds)"),
                                        errors="coerce"),
        "fiber_supported": {"Yes": True, "No": False}.get(
            s.get("TP_PARAMETER_FIBER_USAGE_FLAG(N/A)")),
        "dispenser": 1 if s.get("DISPENSER_1_PROFILE(N/A)", "None") != "None"
        else 2 if s.get("DISPENSER_2_PROFILE(N/A)", "None") != "None" else None,
        "soot_sampler": {"Yes": True, "No": False}.get(
            s.get("TP_PARAMETER_SOOT_SAMPLER_USAGE_FLAG(N/A)")),
        "dispensed": bool(h.get("AS Dispense Start")),
        "log_rows": len(rows),
    }
    if not rows or ign is None:
        rec["flame_seen"] = None
        return rec
    df = pd.DataFrame(rows, columns=["mp", "rt", "narrow", "narrow_sd", "wide", "wide_sd",
                                     "psia", "degc"])
    for c in df.columns[2:]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df["t"] = [(when(x) - ign).total_seconds() if when(x) else np.nan for x in df["mp"]]
    pre, post = df[df["t"] < 0], df[df["t"] >= 0]
    if len(pre) < 3 or post.empty:
        rec["flame_seen"] = None
        return rec
    base = float(pre["wide"].median())
    spread = float((pre["wide"] - base).abs().max())
    peak = float(post["wide"].max() - base)
    off = when(h.get("AS Igniter Off/Retract Start"))
    off_s = (off - ign).total_seconds() if off else float(rec["igniter_on_ms"] or 0) / 1000
    above = (post["wide"] - base > 0.2 * peak).to_numpy() if peak >= max(1e-4, 10 * spread) \
        else np.zeros(len(post), bool)
    after = int((above & (post["t"] > off_s + 1).to_numpy()).sum())
    seen = after >= 2
    if not seen:
        above = np.zeros(len(post), bool)
    rec.update(
        flame_seen=seen,
        igniter_off_s=round(off_s, 2),
        lit_after_igniter_s=after,
        flame_seconds=int(above.sum()),
        first_flame_s=round(float(post["t"][above].iloc[0]), 1) if seen else None,
        wide_peak_above_base=round(float(post["wide"].max() - base), 6),
        narrow_peak_above_base=round(float(post["narrow"].max() - pre["narrow"].median()), 6),
        chamber_psia=round(float(df["psia"].median()), 2),
        chamber_degc=round(float(df["degc"].median()), 2),
        temp_rise_c=round(float(post["degc"].max() - pre["degc"].median()), 2),
        pressure_rise_psia=round(float(post["psia"].max() - pre["psia"].median()), 3),
    )
    return rec


def build(folder: Path) -> pd.DataFrame:
    tests = sorted({p.stem for p in folder.glob("*.txt") if "_" not in p.stem})
    recs = [r for t in tests if (r := summarize(t, folder))]
    return pd.DataFrame(recs)


if __name__ == "__main__":
    folder = Path(sys.argv[1])
    df = build(folder)
    df.to_csv(OUT_CSV, index=False)
    seen = df[df["flame_seen"] == True]  # noqa: E712
    by_month = df.dropna(subset=["date"]).assign(month=lambda d: d["date"].str[:7])
    summary = {
        "source": "NASA PSI-68 (FLEX-2), per-test main logs and MDCA test-point settings",
        "method": __doc__.split("\n\n", 1)[1].split("Output:")[0].strip(),
        "tests": int(len(df)),
        "with_log": int(df["flame_seen"].notna().sum()),
        "flame_seen": int(len(seen)),
        "fiber_supported": int((df["fiber_supported"] == True).sum()),  # noqa: E712
        "free_droplet": int((df["fiber_supported"] == False).sum()),  # noqa: E712
        "soot_sampler": int((df["soot_sampler"] == True).sum()),  # noqa: E712
        "median_flame_seconds": float(seen["flame_seconds"].median()) if len(seen) else None,
        "median_first_flame_s": float(seen["first_flame_s"].median()) if len(seen) else None,
        "median_psia": float(df["chamber_psia"].median()) if "chamber_psia" in df else None,
        "psia_range": [float(df["chamber_psia"].min()), float(df["chamber_psia"].max())]
        if "chamber_psia" in df else None,
        "median_temp_rise_c": float(seen["temp_rise_c"].median()) if len(seen) else None,
        "median_pressure_rise_psia": float(seen["pressure_rise_psia"].median())
        if len(seen) else None,
        "dates": [df["date"].dropna().min(), df["date"].dropna().max()],
        "per_month": by_month.groupby("month").agg(
            tests=("test_point", "count"),
            flames=("flame_seen", lambda x: int((x == True).sum()))  # noqa: E712
        ).reset_index().to_dict("records"),
        "flame_seconds_hist": np.histogram(seen["flame_seconds"], bins=[0, 2, 5, 10, 20, 40, 80])
        [0].tolist() if len(seen) else [],
        "flame_seconds_bins": [0, 2, 5, 10, 20, 40, 80],
    }
    OUT_JSON.write_text(json.dumps(summary, indent=1, default=str) + "\n")
    print(json.dumps({k: v for k, v in summary.items() if k not in ("method", "per_month")},
                     default=str))
