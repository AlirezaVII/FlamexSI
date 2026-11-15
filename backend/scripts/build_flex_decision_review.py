"""Rebuild the embedded FLEX experimental models from repository root inputs."""
import csv
import json
from collections import defaultdict
from datetime import datetime
from math import isfinite
from pathlib import Path
from statistics import mean, median

ROOT = Path(__file__).resolve().parents[2]
DATA = ROOT / "backend/review_seed/PSI-69_Experimental table_FLEX.csv"
REVIEW = ROOT / "backend/falmex/review_artifacts/review/eight_findings_review.csv"
PAGE = ROOT / "frontend/public/flex-comparison.html"
TASKS = [
    ("Oxygen → burning rate", "Initial oxygen mole fraction", "Burning rate (source scale)", 6, 12, False,
     "Compare the two fuels at the same oxygen fraction. Their positive associations differ in strength, so fuel matters when planning a follow-up test."),
    ("Initial diameter → extinction diameter", "Initial diameter (mm)", "Visible extinction diameter (mm)", 10, 11, False,
     "Account for starting droplet size when comparing visible extinction. Match initial diameters across experiments before interpreting differences."),
    ("Oxygen → extinction diameter ratio", "Initial oxygen mole fraction", "Extinction / initial diameter", 6, 11, True,
     "Compare normalized extinction diameters within one fuel. The ratio shares a measurement with extinction diameter, so the two results provide overlapping evidence."),
]


def date(value):
    fmt = "%m/%d/%y" if len(value.split("/")[-1]) == 2 else "%m/%d/%Y"
    return datetime.strptime(value, fmt)


def estimate(samples, x):
    # At the fifth-neighbour boundary include every tie, independent of row order.
    distances = [round(abs(value - x), 10) for value, _ in samples]
    radius = sorted(distances)[min(4, len(samples) - 1)]
    neighbors = [y for (_, y), d in zip(samples, distances) if d <= radius]
    return median(neighbors), len(neighbors)


def build():
    with DATA.open(encoding="cp1252") as source:
        rows = list(csv.reader(source))[1:]
    with REVIEW.open() as source:
        reviews = list(csv.DictReader(source))
    findings = json.loads((ROOT / "backend/review_seed/findings.json").read_text())["findings"]
    dates = sorted({date(r[2]) for r in rows})
    cutoff = dates[int(0.8 * len(dates))]
    tasks = []
    for index, (title, xname, yname, xi, yi, ratio, insight) in enumerate(TASKS):
        training = defaultdict(list)
        testing = []
        for row in rows:
            try:
                x, y = float(row[xi]), float(row[yi])
                if ratio:
                    y /= float(row[10])
            except (ValueError, ZeroDivisionError):
                continue
            if not (isfinite(x) and isfinite(y)):
                continue
            fuel = row[4]
            if date(row[2]) < cutoff:
                training[fuel].append([x, y])
            else:
                testing.append((fuel, x, y))
        errors, baseline = [], []
        for fuel, x, y in testing:
            prediction, _ = estimate(training[fuel], x)
            errors.append(abs(y - prediction))
            baseline.append(abs(y - median(p[1] for p in training[fuel])))
        options = {fuel: [[x, *estimate(samples, x)] for x in sorted({p[0] for p in samples})]
                   for fuel, samples in training.items()}
        review = reviews[index]
        finding = next(f for f in findings if all(f[k] == review[k] for k in ("condition", "outcome", "analyzer")))
        tasks.append(dict(id=finding["finding_id"], title=title, xname=xname, yname=yname, insight=insight, options=options,
                          train=sum(map(len, training.values())), test=len(testing), mae=mean(errors),
                          baseline=mean(baseline), cutoff=cutoff.date().isoformat(),
                          rho=float(review["date_holdout_effect"]), finding=review["review_id"]))
    tasks.sort(key=lambda t: 1 - t["mae"] / t["baseline"], reverse=True)
    page = PAGE.read_text()
    start = page.index('<script type="application/json" id="models">') + len('<script type="application/json" id="models">')
    end = page.index("</script>", start)
    PAGE.write_text(page[:start] + json.dumps(tasks, ensure_ascii=False) + page[end:])
    for t in tasks:
        print(t["title"], t["train"], t["test"], t["mae"], t["baseline"], t["cutoff"])


if __name__ == "__main__":
    build()
