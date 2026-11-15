"""Per-test FLEX records for the 3D flame lab (frontend/src/lib/flight/flex_tests.json).

Straight from NASA's PSI-69 FLEX experimental table, renamed and rounded; no modelling.
Kept: tests with a starting diameter, a burning rate and a burn time (what the replay needs).
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend/falmex/datasets/PSI-69_Experimental table_FLEX.csv"
OUT = ROOT / "frontend/src/lib/flight/flex_tests.json"
COLS = {
    "FLEX Test #": "n", "FLEX Identifier": "id", "Test Date": "date", "Fuel": "fuel",
    "Ambient pressure; mmHg": "p", "O initial ambient composition; mole fraction": "o2",
    "N initial ambient composition; mole fraction": "n2",
    "CO initial ambient composition; mole fraction": "co2",
    "He initial ambient composition; mole fraction": "he",
    "Droplet initial diameter; mm": "d0", "Visible flame extinction diameter; mm": "dext",
    "Burning rate; mm": "k", "Burn time; s": "tb", "Test end": "end",
}


def build() -> list[dict]:
    df = pd.read_csv(DATA, encoding="cp1252").rename(columns=COLS)[list(COLS.values())]
    for c in ["p", "o2", "n2", "co2", "he", "d0", "dext", "k", "tb"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")  # the table marks missing values with "–"
    df = df.dropna(subset=["d0", "k", "tb"])
    df = df[(df["d0"] > 0) & (df["k"] > 0) & (df["tb"] > 0)]
    out = []
    for r in df.itertuples(index=False):
        rec = {k: (round(v, 4) if isinstance(v, float) else v) for k, v in r._asdict().items()}
        rec["n"] = int(rec["n"])
        rec = {k: (None if isinstance(v, float) and pd.isna(v) else v) for k, v in rec.items()}
        if rec["p"] is not None and rec["p"] <= 0:
            rec["p"] = None  # the table writes 0 for a missing pressure
        out.append(rec)
    return out


if __name__ == "__main__":
    tests = build()
    OUT.write_text(json.dumps(tests, separators=(",", ":")) + "\n")
    print(len(tests), "tests;", OUT.stat().st_size, "bytes")
