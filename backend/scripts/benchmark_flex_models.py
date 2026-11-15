"""Compare pre-ignition predictors on expanding FLEX date windows (requires scikit-learn)."""
import csv
import json
from collections import defaultdict
from math import isfinite
from statistics import mean, median

from build_flex_decision_review import DATA, MODELS, TASKS, date, estimate
from sklearn.ensemble import ExtraTreesRegressor
from sklearn.linear_model import Ridge
from sklearn.pipeline import make_pipeline
from sklearn.preprocessing import StandardScaler


def observations(raw, xi, yi, ratio):
    rows = []
    for row in raw:
        try:
            # Pressure, oxygen, nitrogen, carbon dioxide, helium, initial diameter.
            features = [float(row[k]) for k in (5, 6, 7, 8, 9, 10)]
            outcome = float(row[yi]) / (float(row[10]) if ratio else 1)
        except (ValueError, ZeroDivisionError):
            continue
        if not all(map(isfinite, [*features, outcome])):
            continue
        fuel = row[4]
        features.append(float(fuel == "Methanol"))
        rows.append((date(row[2]), fuel, features, outcome, float(row[xi])))
    return rows


def evaluate(train, test):
    features = [r[2] for r in train]
    outcomes = [r[3] for r in train]
    test_features = [r[2] for r in test]
    models = {
        "Ridge": make_pipeline(StandardScaler(), Ridge(alpha=10)),
        "Extra Trees": ExtraTreesRegressor(n_estimators=100, min_samples_leaf=5, random_state=69),
    }
    predictions = {k: m.fit(features, outcomes).predict(test_features) for k, m in models.items()}
    grouped = defaultdict(list)
    for _, fuel, _, y, x in train:
        grouped[fuel].append((x, y))
    predictions["Fuel median"] = [median(y for _, y in grouped[r[1]]) for r in test]
    predictions["Planner"] = [estimate(grouped[r[1]], r[4])[0] for r in test]
    return {k: [abs(float(p) - r[3]) for p, r in zip(values, test, strict=True)]
            for k, values in predictions.items()}


def benchmark():
    with DATA.open(encoding="cp1252", newline="") as source:
        raw = list(csv.reader(source))[1:]
    days = sorted({date(r[2]) for r in raw})
    boundaries = [days[i * len(days) // 5] for i in range(1, 5)]
    results = []
    for title, _, _, xi, yi, ratio, _ in TASKS:
        rows = observations(raw, xi, yi, ratio)
        development = defaultdict(list)
        for start, end in zip(boundaries[:-1], boundaries[1:], strict=True):
            errors = evaluate([r for r in rows if r[0] < start],
                              [r for r in rows if start <= r[0] < end])
            for model, values in errors.items():
                development[model].extend(values)
        selection_mae = {k: mean(v) for k, v in development.items()}
        chosen = min(selection_mae, key=selection_mae.get)
        train = [r for r in rows if r[0] < boundaries[-1]]
        test = [r for r in rows if r[0] >= boundaries[-1]]
        final = {k: mean(v) for k, v in evaluate(train, test).items()}
        results.append(dict(title=title, chosen=chosen, train=len(train), test=len(test),
                            developmentMAE=selection_mae, finalMAE=final))
    return results


if __name__ == "__main__":
    MODELS.with_name("benchmark.json").write_text(json.dumps(benchmark(), indent=2) + "\n")
