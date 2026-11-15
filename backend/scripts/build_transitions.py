"""Fire Behavior Transition Finder on the NASA PSI-69 FLEX table.

Question: at what initial oxygen level does a burning droplet stop ending in extinction
(the visible flame goes out while fuel remains) and start ending in disruption or burning to
completion? FLEX's stated goal was the limiting oxygen index; this looks for where the
recorded end of the test changes, which is a related but different boundary.

Method (per fuel):
1. Logistic fit of P(test ends in extinction) on oxygen mole fraction.
2. Transition oxygen = where that probability is 50%; 95% interval from 2000 bootstrap
   resamples of the experiments.
3. Shuffle test: the oxygen-outcome link is re-fitted on 2000 random relabelings.
4. Later-date check: the transition is fitted on the earliest 80% of test dates and its
   predictions scored on the latest 20% (balanced accuracy vs always predicting extinction).
A transition is reported only when the interval lies inside the tested oxygen range, the
shuffle p-value is below 0.01 and the later-date check beats the baseline. Otherwise the
result says no transition is supported. Output: frontend/src/lib/flight/transitions.json.
"""

import json
from datetime import datetime
from pathlib import Path

import numpy as np
import pandas as pd
from sklearn.linear_model import LogisticRegression

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend/review_seed/PSI-69_Experimental table_FLEX.csv"
OUT = ROOT / "frontend/src/lib/flight/transitions.json"
O2 = "O initial ambient composition; mole fraction"
CO2 = "CO initial ambient composition; mole fraction"
HE = "He initial ambient composition; mole fraction"
RNG = np.random.default_rng(42)
B = 2000


def date(value: str) -> datetime:
    fmt = "%m/%d/%y" if len(value.split("/")[-1]) == 2 else "%m/%d/%Y"
    return datetime.strptime(value, fmt)


def fit(x: np.ndarray, y: np.ndarray):
    if len(np.unique(y)) < 2:
        return None
    model = LogisticRegression(C=1e4, max_iter=2000).fit(x.reshape(-1, 1), y)
    return float(model.coef_[0][0]), float(model.intercept_[0])


def midpoint(params) -> float | None:
    if params is None or params[0] == 0:
        return None
    slope, icept = params
    return -icept / slope


def balanced_accuracy(y: np.ndarray, p: np.ndarray) -> float:
    recalls = [np.mean(p[y == c] == c) for c in (0, 1) if np.any(y == c)]
    return float(np.mean(recalls))


def analyse(frame: pd.DataFrame) -> dict:
    x = frame[O2].to_numpy(float)
    y = (frame["Test end"] == "Extinction").astype(int).to_numpy()
    base = fit(x, y)
    point = midpoint(base)
    boots = []
    for _ in range(B):
        idx = RNG.integers(0, len(x), len(x))
        m = midpoint(fit(x[idx], y[idx]))
        if m is not None and np.isfinite(m):
            boots.append(m)
    lo, hi = (np.percentile(boots, [2.5, 97.5]) if len(boots) > B // 2 else (None, None))
    slope = base[0] if base else 0.0
    null = [abs(p[0]) for p in (fit(x, RNG.permutation(y)) for _ in range(B)) if p]
    p_value = (1 + sum(n >= abs(slope) for n in null)) / (1 + len(null))
    # later-date check
    dates = frame["Test Date"].map(date)
    cutoff = sorted(dates.unique())[int(0.8 * dates.nunique())]
    train, test = frame[dates < cutoff], frame[dates >= cutoff]
    later = None
    tp = fit(train[O2].to_numpy(float), (train["Test end"] == "Extinction").astype(int).to_numpy())
    if tp is not None and len(test) >= 5:
        tx = test[O2].to_numpy(float)
        ty = (test["Test end"] == "Extinction").astype(int).to_numpy()
        pred = (1 / (1 + np.exp(-(tp[0] * tx + tp[1]))) >= 0.5).astype(int)
        later = {
            "test_experiments": int(len(test)),
            "cutoff": cutoff.date().isoformat(),
            "balanced_accuracy": round(balanced_accuracy(ty, pred), 3),
            "baseline": round(balanced_accuracy(ty, np.ones_like(ty)), 3),
        }
    tested = [float(x.min()), float(x.max())]
    supported = bool(
        point is not None and lo is not None and tested[0] < lo and hi < tested[1]
        and p_value < 0.01 and later is not None
        and later["balanced_accuracy"] > later["baseline"] and slope < 0
    )
    status = (
        "supported" if supported
        else "candidate" if (point is not None and lo is not None and p_value < 0.01
                             and tested[0] < lo and hi < tested[1])
        else "none"
    )
    by_level = (
        frame.groupby(O2)["Test end"].value_counts().unstack(fill_value=0)
        .reindex(columns=["Extinction", "Disruption", "Completion"], fill_value=0)
    )
    return {
        "n": int(len(frame)),
        "tested_oxygen": tested,
        "transition_oxygen": round(point, 4) if point is not None else None,
        "interval": [round(float(lo), 4), round(float(hi), 4)] if lo is not None else None,
        "shuffle_p": round(float(p_value), 4),
        "later_dates": later,
        "supported": supported,
        "status": status,
        "levels": [
            {"oxygen": float(o), "extinction": int(r.Extinction), "disruption": int(r.Disruption),
             "completion": int(r.Completion)}
            for o, r in by_level.iterrows()
        ],
    }


def build() -> dict:
    df = pd.read_csv(DATA, encoding="cp1252")
    df = df[df["Test end"].notna() & df[O2].notna()]
    result = {"method": __doc__.split("Method (per fuel):")[1].split("Output:")[0].strip(),
              "fuels": {}}
    for fuel, part in df.groupby("Fuel"):
        entry = analyse(part)
        # does the boundary hold when the suppressant is CO2 vs helium vs nitrogen only?
        groups = {
            "with CO2": part[part[CO2] > 0],
            "with helium": part[part[HE] > 0],
            "nitrogen only": part[(part[CO2].fillna(0) == 0) & (part[HE].fillna(0) == 0)],
        }
        entry["by_diluent"] = {}
        for name, g in groups.items():
            gx = g[O2].to_numpy(float)
            gy = (g["Test end"] == "Extinction").astype(int).to_numpy()
            m = midpoint(fit(gx, gy)) if len(g) >= 15 else None
            ok = m is not None and gx.min() < m < gx.max()
            entry["by_diluent"][name] = {
                "n": int(len(g)),
                "transition_oxygen": round(m, 4) if ok else None,
            }
        result["fuels"][fuel] = entry
    return result


if __name__ == "__main__":
    out = build()
    OUT.write_text(json.dumps(out, indent=1))
    for fuel, e in out["fuels"].items():
        print(fuel, e["n"], e["status"], e["transition_oxygen"], e["interval"],
              "p", e["shuffle_p"], "later", e["later_dates"])
