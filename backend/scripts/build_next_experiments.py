"""Which FLEX-type experiment should come next? A coverage-gap map of the PSI-69 table.

Each cell is fuel x oxygen band x pressure band. The value of a new test in a cell is scored
from three stated parts:
  habitat   1 if the cell holds the Moon-base / rover atmosphere named in the challenge
            (30% oxygen or more at 10.2 psi = 527 mmHg or less), 0.5 for ISS air (21%, 760 mmHg)
  boundary  1 if the cell lies inside the 95% interval of the extinction-transition oxygen
            found by build_transitions.py (where the boundary is least certain)
  scarcity  1 / (1 + tests already in the cell)
value = 0.45 habitat + 0.30 boundary + 0.25 scarcity. Output:
frontend/src/lib/flight/next_experiments.json (top suggestions plus the full grid).
"""

import json
from pathlib import Path

import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend/review_seed/PSI-69_Experimental table_FLEX.csv"
TRANSITIONS = ROOT / "frontend/src/lib/flight/transitions.json"
OUT = ROOT / "frontend/src/lib/flight/next_experiments.json"
O2 = "O initial ambient composition; mole fraction"
P = "Ambient pressure; mmHg"
OXYGEN_BANDS = [(0.12, 0.16), (0.16, 0.20), (0.20, 0.24), (0.24, 0.28), (0.28, 0.32), (0.32, 0.40)]
PRESSURE_BANDS = [(1, 424), (424, 527), (527, 700), (700, 800), (800, 2400)]  # mmHg
# 424-527 mmHg = 8.2-10.2 psi, the window of the planned Moon-base / rover atmosphere
MOON = (0.30, 527)  # oxygen >= 30% at <= 10.2 psi (challenge text)
ISS = (0.21, 760)


def band_label(lo, hi, pct=False):
    return f"{lo * 100:.0f}–{hi * 100:.0f}%" if pct else f"{lo:.0f}–{hi:.0f} mmHg"


def build() -> dict:
    df = pd.read_csv(DATA, encoding="cp1252").dropna(subset=[O2, P])
    df = df[df[P] > 0]  # a pressure of 0 marks a missing value in the table
    trans = json.loads(TRANSITIONS.read_text())["fuels"]
    cells = []
    for fuel, part in df.groupby("Fuel"):
        interval = trans.get(fuel, {}).get("interval") or [None, None]
        for olo, ohi in OXYGEN_BANDS:
            for plo, phi in PRESSURE_BANDS:
                inside = part[(part[O2] >= olo) & (part[O2] < ohi)
                              & (part[P] >= plo) & (part[P] < phi)]
                n = int(len(inside))
                habitat = (1.0 if (ohi > MOON[0] and (plo, phi) == (424, 527)) else
                           0.5 if (olo <= ISS[0] < ohi and plo <= ISS[1] < phi) else 0.0)
                boundary = (1.0 if interval[0] is not None
                            and olo < interval[1] and ohi > interval[0] else 0.0)
                scarcity = 1 / (1 + n)
                value = 0.45 * habitat + 0.30 * boundary + 0.25 * scarcity
                why = []
                if habitat == 1:
                    why.append("Moon-base / rover atmosphere (30%+ O2 at 10.2 psi or less)")
                elif habitat == 0.5:
                    why.append("ISS cabin air")
                if boundary:
                    why.append("inside the uncertain extinction-transition band")
                why.append("no tests yet" if n == 0 else f"only {n} test{'s' if n > 1 else ''}"
                           if n < 4 else f"{n} tests already")
                cells.append({
                    "fuel": fuel, "oxygen": band_label(olo, ohi, pct=True),
                    "pressure": band_label(plo, phi), "tests": n,
                    "habitat": habitat, "boundary": boundary, "scarcity": round(scarcity, 3),
                    "value": round(value, 3), "why": why,
                })
    cells.sort(key=lambda c: (-c["value"], c["tests"]))
    suggestions, seen = [], set()
    for c in cells:  # one suggestion per fuel and oxygen band
        if (c["fuel"], c["oxygen"]) in seen:
            continue
        seen.add((c["fuel"], c["oxygen"]))
        suggestions.append(c)
        if len(suggestions) == 6:
            break
    moon = [c for c in cells if c["habitat"] == 1]
    return {"method": __doc__.split("\n\n", 1)[1].split("Output:")[0].strip(),
            "moon_base_tests": sum(c["tests"] for c in moon),
            "suggestions": suggestions, "grid": cells}


if __name__ == "__main__":
    out = build()
    OUT.write_text(json.dumps(out, indent=1))
    for c in out["suggestions"]:
        print(c["fuel"], c["oxygen"], c["pressure"], c["tests"], c["value"], c["why"])
