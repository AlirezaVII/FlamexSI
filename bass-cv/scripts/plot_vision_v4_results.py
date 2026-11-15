#!/usr/bin/env python3
"""Plot v4 development candidate comparison and frozen confirmation results."""
import json
from pathlib import Path

import matplotlib.pyplot as plt
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
development = json.loads((ROOT / "vision-v4/development-comparison.json").read_text())
confirmation = json.loads((ROOT / "confirmation-v4/metrics.json").read_text())
dev_tests = list(development["config"].get("development_tests", ["B1", "B2", "B3", "B4", "B5", "B6", "B7", "B8", "B12"]))
conf_tests = ["B9", "B10", "B11"]

fig, axes = plt.subplots(1, 2, figsize=(16, 6.8))
x = np.arange(len(dev_tests))
width = 0.36
for offset, candidate, color in ((-width / 2, "extra_trees", "#777777"), (width / 2, "lightgbm", "#1479b8")):
    values = [development["candidates"][candidate]["per_test"][t]["positive_macro_iou"] for t in dev_tests]
    bars = axes[0].bar(x + offset, values, width, label=candidate, color=color)
    axes[0].bar_label(bars, fmt="%.3f", fontsize=8, padding=2)
axes[0].set_title("v4 grouped development: identical folds and samples")
axes[0].set_ylabel("Positive-frame Macro IoU")
axes[0].set_xticks(x, dev_tests)
axes[0].set_ylim(0, 0.9)
axes[0].legend()
axes[0].grid(axis="y", alpha=0.2)

x = np.arange(len(conf_tests))
for offset, metric, label, color in ((-width / 2, "positive_macro_iou", "Macro IoU", "#1479b8"),
                                    (width / 2, "positive_macro_dice", "Macro Dice", "#e57b25")):
    values = [confirmation["per_test"][t][metric] for t in conf_tests]
    bars = axes[1].bar(x + offset, values, width, label=label, color=color)
    axes[1].bar_label(bars, fmt="%.3f", fontsize=9, padding=2)
axes[1].set_title("Frozen LightGBM v4 on newly reserved confirmation videos")
axes[1].set_xticks(x, conf_tests)
axes[1].set_ylim(0, 0.95)
axes[1].legend()
axes[1].grid(axis="y", alpha=0.2)
fig.text(0.5, 0.015,
         "Development and confirmation roles are separate; AI-assistant coarse masks; not expert external validation",
         ha="center", fontsize=10, color="#444444")
fig.tight_layout(rect=(0, 0.045, 1, 1))
fig.savefig(ROOT / "vision-v4/results-comparison.png", dpi=170, bbox_inches="tight")
plt.close(fig)

summary = {
    "selected_candidate": development["selected_candidate"],
    "selection_rule": development["selection_rule"],
    "development_pooled": {name: data["pooled"] for name, data in development["candidates"].items()},
    "development_per_test": {
        name: {test: values["positive_macro_iou"] for test, values in data["per_test"].items()}
        for name, data in development["candidates"].items()
    },
    "v4_frozen_confirmation_pooled": confirmation["pooled"],
    "v4_frozen_confirmation_per_test": confirmation["per_test"],
    "v4_model_sha256": confirmation["model_sha256"],
    "comparison_caution": "v4 confirmation uses B9/B10/B11; earlier v3 confirmation used different videos B6/B8/B12, so pooled scores are not a same-video head-to-head comparison.",
}
(ROOT / "vision-v4/summary.json").write_text(json.dumps(summary, indent=2), encoding="utf-8")
print(json.dumps({"selected_candidate": summary["selected_candidate"],
                  "development_macro_iou": {k: v["positive_macro_iou"] for k, v in summary["development_pooled"].items()},
                  "confirmation_macro_iou": confirmation["pooled"]["positive_macro_iou"],
                  "confirmation_macro_dice": confirmation["pooled"]["positive_macro_dice"]}, indent=2))
