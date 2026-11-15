#!/usr/bin/env python3
"""Plot Falmex Vision development and frozen-confirmation metrics."""
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
v2 = json.loads((ROOT / "confirmation/metrics.json").read_text())
v3dev = json.loads((ROOT / "vision-v3/development-metrics.json").read_text())
v3 = json.loads((ROOT / "confirmation-v3/metrics.json").read_text())

fig, axes = plt.subplots(1, 2, figsize=(12, 5), dpi=180)
for ax, tests, left_title in [
    (axes[0], ["B4", "B5", "B7"], "Same videos: v2 confirmation vs v3 grouped development"),
    (axes[1], ["B6", "B8", "B12"], "Frozen v3 on newly reserved confirmation videos"),
]:
    x = np.arange(len(tests))
    if left_title.startswith("Same"):
        first = [v2["per_test"][t]["positive_macro_dice"] for t in tests]
        second = [v3dev["per_test"][t]["positive_macro_dice"] for t in tests]
        labels = ("v2 frozen confirmation", "v3 grouped development")
        colors = ("#8b8b8b", "#2878b5")
    else:
        first = [v3["per_test"][t]["positive_macro_iou"] for t in tests]
        second = [v3["per_test"][t]["positive_macro_dice"] for t in tests]
        labels = ("Macro IoU", "Macro Dice")
        colors = ("#2878b5", "#e07a2f")
    ax.bar(x - 0.18, first, 0.36, label=labels[0], color=colors[0])
    ax.bar(x + 0.18, second, 0.36, label=labels[1], color=colors[1])
    for positions, values in ((x - 0.18, first), (x + 0.18, second)):
        for position, value in zip(positions, values):
            ax.text(position, value + 0.018, f"{value:.3f}", ha="center", fontsize=8)
    ax.set_xticks(x, tests)
    ax.set_ylim(0, 0.88)
    ax.set_title(left_title, fontsize=10)
    ax.grid(axis="y", alpha=0.2)
    ax.legend(fontsize=8, loc="upper right")
axes[0].set_ylabel("Score on positive frames")
fig.text(0.5, 0.01, "Different evaluation roles are labeled explicitly; AI-assistant coarse masks; not expert external validation",
         ha="center", fontsize=8, color="#444444")
fig.tight_layout(rect=(0, 0.045, 1, 1))
output = ROOT / "vision-v3/results-comparison.png"
fig.savefig(output, bbox_inches="tight")

summary = {
    "v2_frozen_confirmation_pooled": v2["pooled"],
    "v3_grouped_development_pooled": v3dev["pooled"],
    "v3_frozen_confirmation_pooled": v3["pooled"],
    "v3_frozen_confirmation_per_test": v3["per_test"],
    "v2_model_sha256": v2["model_sha256"],
    "v3_model_sha256": v3["model_sha256"],
}
(ROOT / "vision-v3/summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
