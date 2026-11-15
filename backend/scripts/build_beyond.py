"""Numbers for the "Moon, Mars and Earth" page, computed from NASA's FLEX table (PSI-69).

NASA's recommended exploration-habitat atmosphere is 34% oxygen at 56.5 kPa (NASA/TP-2010-
216134). FLEX burned droplets at 30-40% oxygen too, at about 72 kPa, so the flight data
already says something about burning in that atmosphere. Per fuel: tests in air-like
oxygen (19-23%) and in enriched oxygen (30-40%), with the median burning rate K (mm^2/s,
the d^2-law slope) and median pressure. Pressure differs between the two groups as well,
so this is a description of the data, not an oxygen-only effect; the oxygen effect with
pressure held fixed is the validated finding on the Findings page.
Output: frontend/src/lib/flight/beyond.json
Usage: python backend/scripts/build_beyond.py
"""

import json
from pathlib import Path

import pandas as pd

from falmex.ingest.base import read_file

ROOT = Path(__file__).resolve().parents[2]
TABLE = ROOT / "backend/falmex/datasets/PSI-69_Experimental table_FLEX.csv"
OUT = ROOT / "frontend/src/lib/flight/beyond.json"
BANDS = {"air": (0.19, 0.23), "enriched": (0.30, 0.40)}
KPA_PER_MMHG = 0.133322


def build() -> dict:
    df = read_file(TABLE.name, TABLE.read_bytes()).tables[0].frame
    o2 = pd.to_numeric(df["O initial ambient composition; mole fraction"], errors="coerce")
    k = pd.to_numeric(df["Burning rate; mm"], errors="coerce")
    p = pd.to_numeric(df["Ambient pressure; mmHg"], errors="coerce")
    fuels = {}
    for fuel in sorted(df["Fuel"].dropna().unique()):
        row = {}
        for band, (lo, hi) in BANDS.items():
            m = (o2 >= lo) & (o2 <= hi) & k.notna() & (df["Fuel"] == fuel)
            row[band] = {"n": int(m.sum()), "oxygen": [lo, hi],
                         "median_k_mm2_s": round(float(k[m].median()), 3),
                         "median_pressure_kpa": round(float(p[m].median()) * KPA_PER_MMHG, 1)}
        row["change_pct"] = round(100 * (row["enriched"]["median_k_mm2_s"]
                                         / row["air"]["median_k_mm2_s"] - 1))
        fuels[fuel] = row
    return {
        "source": "NASA PSI-69, FLEX experimental table (274 tests)",
        "method": __doc__.split("\n\n", 1)[0].strip(),
        "habitat_atmosphere": {"oxygen": 0.34, "pressure_kpa": 56.5,
                               "reference": "NASA/TP-2010-216134"},
        "oxygen_range_tested": [round(float(o2.min()), 2), round(float(o2.max()), 2)],
        "fuels": fuels,
    }


if __name__ == "__main__":
    out = build()
    OUT.write_text(json.dumps(out, indent=1) + "\n")
    print(json.dumps(out["fuels"], indent=1))
