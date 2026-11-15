"""Audit the published FLEX planner against its original late-date observations."""
import csv
import hashlib
import json
import random
from collections import defaultdict
from math import isfinite
from statistics import mean, median, quantiles

from build_flex_decision_review import DATA, MODELS, TASKS, date, estimate

REPLICATES = 10000
SEED = 69


def audit():
    with DATA.open(encoding="cp1252", newline="") as source:
        rows = list(csv.reader(source))[1:]
    dates = sorted({date(row[2]) for row in rows})
    cutoff = dates[int(0.8 * len(dates))]
    models = {model["title"]: model for model in json.loads(MODELS.read_text())}
    results = []
    for title, _, _, xi, yi, ratio, _ in TASKS:
        train = defaultdict(list)
        holdout = []
        for line, row in enumerate(rows, start=2):
            try:
                x = float(row[xi])
                y = float(row[yi]) / (float(row[10]) if ratio else 1)
            except (ValueError, ZeroDivisionError):
                continue
            if not (isfinite(x) and isfinite(y)):
                continue
            day = date(row[2])
            if day < cutoff:
                train[row[4]].append((x, y))
            else:
                holdout.append((line, day, row[4], x, y))
        groups = defaultdict(list)
        model_errors, baseline_errors = [], []
        for _, day, fuel, x, y in holdout:
            pred, _ = estimate(train[fuel], x)
            error = abs(y - pred)
            baseline = abs(y - median(v for _, v in train[fuel]))
            model_errors.append(error)
            baseline_errors.append(baseline)
            groups[day].append(baseline - error)
        model = models[title]
        assert len(holdout) == model["test"]
        assert abs(mean(model_errors) - model["mae"]) < 1e-10
        assert abs(mean(baseline_errors) - model["baseline"]) < 1e-10
        clusters = [(sum(values), len(values)) for _, values in sorted(groups.items())]
        rng = random.Random(SEED)
        draws = []
        for _ in range(REPLICATES):
            sample = rng.choices(clusters, k=len(clusters))
            draws.append(sum(s for s, _ in sample) / sum(n for _, n in sample))
        percentiles = quantiles(draws, n=1000, method="inclusive")
        results.append(dict(title=title, days=len(groups), rows=len(holdout),
                            gain=mean(baseline_errors) - mean(model_errors),
                            low=percentiles[24], high=percentiles[974],
                            sourceLines=[line for line, *_ in holdout]))
    return dict(sha256=hashlib.sha256(DATA.read_bytes()).hexdigest(),
                cutoff=cutoff.date().isoformat(), seed=SEED, replicates=REPLICATES, results=results)


if __name__ == "__main__":
    MODELS.with_name("holdout-audit.json").write_text(json.dumps(audit(), indent=2) + "\n")
