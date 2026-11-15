"""Reproduce the three expanding-window evaluations from the PSI-69 table."""
import csv
from collections import defaultdict
from datetime import datetime
from pathlib import Path
from statistics import mean, median

SOURCE = (Path(__file__).resolve().parents[1] / "review_seed"
          / "PSI-69_Experimental table_FLEX.csv")
EXTINCTION = "Visible flame extinction diameter; mm"
INITIAL = "Droplet initial diameter; mm"


def read_experiments():
    with SOURCE.open(encoding="cp1252", newline="") as source:
        experiments = []
        for row in csv.DictReader(source):
            date = row["Test Date"]
            date_format = "%m/%d/%Y" if len(date.split("/")[-1]) == 4 else "%m/%d/%y"
            experiments.append((datetime.strptime(date, date_format).date(), row))
        return experiments


def observations(experiments, predictor, outcome):
    rows = []
    for date, row in experiments:
        try:
            x = float(row[predictor])
            if outcome == "ratio":
                y = float(row[EXTINCTION]) / float(row[INITIAL])
            else:
                y = float(row[outcome])
        except (ValueError, ZeroDivisionError):
            continue
        rows.append((date, row["Fuel"], x, y))
    return rows


def evaluate(rows, start, end):
    training = defaultdict(list)
    errors = []
    for date, fuel, x, y in rows:
        if date < start:
            training[fuel].append((x, y))
    for date, fuel, x, y in rows:
        if date < start or (end and date >= end):
            continue
        neighbors = sorted((round(abs(x - train_x), 10), train_y)
                           for train_x, train_y in training[fuel])
        cutoff = neighbors[min(5, len(neighbors)) - 1][0]
        estimate = median(value for distance, value in neighbors if distance <= cutoff)
        baseline = median(value for _, value in neighbors)
        errors.append((abs(y - estimate), abs(y - baseline)))
    return len(errors), *(mean(column) for column in zip(*errors, strict=True))


if __name__ == "__main__":
    data = read_experiments()
    dates = sorted({date for date, _ in data})
    oxygen = "O initial ambient composition; mole fraction"
    tasks = [(oxygen, "ratio"), (INITIAL, EXTINCTION), (oxygen, "Burning rate; mm")]
    for predictor, outcome in tasks:
        rows = observations(data, predictor, outcome)
        for fifth in (2, 3, 4):
            start = dates[len(dates) * fifth // 5]
            end = dates[len(dates) * (fifth + 1) // 5] if fifth < 4 else None
            n, error, baseline = evaluate(rows, start, end)
            print(outcome, start, n, f"{error:.4f}", f"{baseline:.4f}")
