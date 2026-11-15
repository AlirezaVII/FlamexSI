#!/usr/bin/env python3
"""Generate a compact figure from saved holdout metrics."""
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
data = json.loads((ROOT / "results/metrics.json").read_text())
labels = ["B1", "B2", "B3", "Pooled"]
metrics = [data["per_test_holdout_metrics"].get(x, data["pooled_holdout_metrics"]) for x in labels]
iou = [m["positive_macro_iou"] for m in metrics]
dice = [m["positive_macro_dice"] for m in metrics]

x = np.arange(len(labels))
width = 0.34
fig, ax = plt.subplots(figsize=(9, 5.2), dpi=180)
ax.bar(x - width / 2, iou, width, label="Macro IoU (positive frames)", color="#2878b5")
ax.bar(x + width / 2, dice, width, label="Macro Dice (positive frames)", color="#e07a2f")
for positions, values in ((x - width / 2, iou), (x + width / 2, dice)):
    for position, value in zip(positions, values):
        ax.text(position, value + 0.018, f"{value:.3f}", ha="center", va="bottom", fontsize=9)
ax.set_xticks(x, labels)
ax.set_ylim(0, 0.78)
ax.set_ylabel("Score")
ax.set_title("Falmex BASS-II color baseline — grouped holdout results")
ax.grid(axis="y", alpha=0.22)
ax.legend(loc="upper right")
fig.text(0.5, 0.01, "24 frames / 3 tests; coarse AI-assistant annotations; not external validation",
         ha="center", fontsize=8, color="#444444")
fig.tight_layout(rect=(0, 0.045, 1, 1))
fig.savefig(ROOT / "results/metrics-by-test.png", bbox_inches="tight")
