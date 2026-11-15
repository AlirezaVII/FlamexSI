"""Extract and refit the three published D² histories in Dietrich et al. Fig. 6.

This is a secondary, downsampled vector-figure proof-of-method. It is not raw
camera data, a complete per-test history, or independent replication of PSI-69.
"""

from __future__ import annotations

import argparse
import hashlib
import json
from pathlib import Path
from typing import Any

import matplotlib

matplotlib.use("Agg")
import matplotlib.pyplot as plt
import numpy as np
import pandas as pd

from falmex.analysis.timeseries import linear_d2_fit, normalized_time_window

PAGE_INDEX = 8
ARTICLE_PAGE = 73
SOURCE_DOI = "10.1007/s12217-014-9372-2"
SOURCE_URL = (
    "https://bpb-us-w2.wpmucdn.com/sites.coecis.cornell.edu/dist/9/231/files/2018/09/"
    "2014-MST-Droplet-combustion-experiments-aboard-the-2je8ess-12toi72.pdf"
)
X0 = 266.37701416015625
X2 = 298.93682861328125
Y0 = 522.759033203125
Y8 = 306.9310302734375
X_SCALE = (X2 - X0) / 2.0
Y_SCALE = (Y0 - Y8) / 8.0

SERIES = {
    "CO2": {
        "color": (1.0, 0.0, 0.0),
        "plot_color": "#D55E00",
        "extinction_x": 477.56829833984375,
        "published_k": 0.45,
        "label": "CO₂-diluted",
        "candidate_psi69_test": 110,
    },
    "N2": {
        "color": (0.0, 1.0, 0.27450981736183167),
        "plot_color": "#009E73",
        "extinction_x": 475.00830078125,
        "published_k": 0.52,
        "label": "N₂-only",
        "candidate_psi69_test": 203,
    },
    "He": {
        "color": (0.49803921580314636, 0.0, 1.0),
        "plot_color": "#7B61A8",
        "extinction_x": 389.25030517578125,
        "published_k": 0.70,
        "label": "He-diluted",
        "candidate_psi69_test": 257,
    },
}
WINDOWS = [
    ("central_80", 0.10, 0.90, "primary"),
    ("central_60", 0.20, 0.80, "sensitivity"),
    ("full_pre_extinction", 0.00, 1.00, "sensitivity"),
    ("early_80", 0.00, 0.80, "sensitivity"),
    ("late_20", 0.80, 1.00, "near_extinction"),
]


def sha256(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as handle:
        for block in iter(lambda: handle.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def extract_vector_points(pdf_path: Path) -> pd.DataFrame:
    """Read filled vector-marker centers from the lower D² panel only."""
    try:
        import pymupdf
    except ImportError as exc:  # pragma: no cover - depends on optional runtime package
        raise RuntimeError("PyMuPDF is required for Figure 6 vector extraction") from exc

    records = []
    with pymupdf.open(pdf_path) as document:
        page = document[PAGE_INDEX]
        for drawing in page.get_drawings():
            fill = drawing.get("fill")
            if fill is None:
                continue
            rect = drawing["rect"]
            # Data markers are ~2.24 pt; the ~4.48 pt legend markers are excluded.
            if not (1.5 <= rect.width <= 3.0 and 1.5 <= rect.height <= 3.0):
                continue
            x = (rect.x0 + rect.x1) / 2.0
            y = (rect.y0 + rect.y1) / 2.0
            if not (X0 - 2.0 <= x <= 580.0 and 300.0 <= y <= Y0 + 1.0):
                continue
            for key, spec in SERIES.items():
                if np.allclose(fill, spec["color"], atol=1e-6):
                    extinction_time = (spec["extinction_x"] - X0) / X_SCALE
                    records.append(
                        {
                            "series": key,
                            "diluent_label": spec["label"],
                            "x_pdf_pt": x,
                            "y_pdf_pt": y,
                            "marker_width_pdf_pt": rect.width,
                            "time_s": (x - X0) / X_SCALE,
                            "d2_mm2": (Y0 - y) / Y_SCALE,
                            "extinction_time_s": extinction_time,
                            "period": "pre_extinction"
                            if x < spec["extinction_x"]
                            else "post_extinction",
                            "data_status": "published_downsampled_vector_digitization_not_raw",
                            "source_doi": SOURCE_DOI,
                            "source_figure": "Figure 6, lower D² panel, article page 73",
                        }
                    )
                    break
    frame = pd.DataFrame(records)
    if frame.empty:
        raise ValueError("No Figure 6 data markers were extracted; check the PDF and calibration")
    frame = frame.sort_values(["series", "time_s", "d2_mm2"]).reset_index(drop=True)
    frame["point_index"] = frame.groupby("series").cumcount() + 1
    counts = frame.groupby("series").size().to_dict()
    expected = {"CO2": 165, "N2": 66, "He": 171}
    if counts != expected:
        raise ValueError(f"Unexpected Figure 6 marker counts: {counts}; expected {expected}")
    return frame


def fit_histories(frame: pd.DataFrame) -> pd.DataFrame:
    records: list[dict[str, Any]] = []
    for key, spec in SERIES.items():
        series = frame[frame.series == key]
        pre = series[series.period == "pre_extinction"]
        extinction_time = float(pre.extinction_time_s.iloc[0])
        for name, start, end, role in WINDOWS:
            mask = normalized_time_window(
                pre.time_s, start, end, origin_s=0.0, duration_s=extinction_time
            )
            fit = linear_d2_fit(pre.loc[mask, "time_s"], pre.loc[mask, "d2_mm2"])
            records.append(
                {
                    "series": key,
                    "window": name,
                    "role": role,
                    "window_start_fraction": start,
                    "window_end_fraction": end,
                    "published_k_mm2_s": spec["published_k"],
                    "k_minus_published_mm2_s": fit["burning_rate_constant_mm2_s"]
                    - spec["published_k"],
                    "k_relative_difference": fit["burning_rate_constant_mm2_s"]
                    / spec["published_k"]
                    - 1.0,
                    **fit,
                }
            )
        post = series[series.period == "post_extinction"]
        if len(post) >= 3:
            fit = linear_d2_fit(post.time_s, post.d2_mm2)
            records.append(
                {
                    "series": key,
                    "window": "post_extinction_vaporization",
                    "role": "descriptive_not_combustion",
                    "window_start_fraction": np.nan,
                    "window_end_fraction": np.nan,
                    "published_k_mm2_s": np.nan,
                    "k_minus_published_mm2_s": np.nan,
                    "k_relative_difference": np.nan,
                    **fit,
                }
            )
    fits = pd.DataFrame(records)
    primary = fits[fits.window == "central_80"].set_index("series")
    late = fits[fits.window == "late_20"].set_index("series")
    fits["late_to_primary_k_ratio"] = np.nan
    fits["late_k_reduction_fraction"] = np.nan
    for key in SERIES:
        ratio = float(
            late.loc[key, "burning_rate_constant_mm2_s"]
            / primary.loc[key, "burning_rate_constant_mm2_s"]
        )
        mask = fits.series == key
        fits.loc[mask, "late_to_primary_k_ratio"] = ratio
        fits.loc[mask, "late_k_reduction_fraction"] = 1.0 - ratio
    return fits


def make_plot(frame: pd.DataFrame, fits: pd.DataFrame, output: Path) -> None:
    fig, axes = plt.subplots(2, 2, figsize=(12, 9), constrained_layout=True)
    for axis, key in zip(axes.flat[:3], ["CO2", "N2", "He"], strict=True):
        spec = SERIES[key]
        series = frame[frame.series == key]
        pre = series[series.period == "pre_extinction"]
        post = series[series.period == "post_extinction"]
        axis.scatter(pre.time_s, pre.d2_mm2, s=15, color=spec["plot_color"], label="Pre-extinction")
        axis.scatter(
            post.time_s,
            post.d2_mm2,
            s=15,
            facecolors="none",
            edgecolors=spec["plot_color"],
            label="Post-extinction vaporization",
        )
        for window, style in [("central_80", "-"), ("late_20", "--")]:
            fit = fits[(fits.series == key) & (fits.window == window)].iloc[0]
            grid = np.linspace(fit.time_min_s, fit.time_max_s, 100)
            axis.plot(
                grid,
                fit.intercept_mm2 + fit.slope_mm2_s * grid,
                style,
                color="black" if window == "central_80" else "#0072B2",
                linewidth=1.8,
                label=f"{window}: K={fit.burning_rate_constant_mm2_s:.3f}",
            )
        axis.axvline(
            series.extinction_time_s.iloc[0], color="#666666", linestyle=":", linewidth=1.2
        )
        axis.set_title(f"{spec['label']} | published K={spec['published_k']:.2f} mm²/s")
        axis.set_xlabel("Time from igniter energization (s)")
        axis.set_ylabel("D² (mm²)")
        axis.grid(alpha=0.18)
        axis.legend(fontsize=8, frameon=False)

    axis = axes.flat[3]
    primary = fits[fits.window == "central_80"].set_index("series").loc[["CO2", "N2", "He"]]
    positions = np.arange(3)
    axis.bar(
        positions - 0.18,
        [SERIES[key]["published_k"] for key in primary.index],
        width=0.36,
        color="#BBBBBB",
        label="Paper-reported K",
    )
    axis.bar(
        positions + 0.18,
        primary.burning_rate_constant_mm2_s,
        width=0.36,
        color="#0072B2",
        label="Central-80% vector refit",
    )
    axis.set_xticks(positions, primary.index)
    axis.set_ylabel("K (mm²/s)")
    axis.set_title("Refit comparison — not independent replication")
    axis.grid(axis="y", alpha=0.18)
    axis.legend(frameon=False, fontsize=9)
    fig.suptitle("Dietrich et al. (2014), Figure 6: secondary vector-marker analysis", fontsize=14)
    fig.text(
        0.5,
        -0.025,
        (
            "Published, downsampled curves; no test IDs are printed in the figure. "
            "Late-20% slopes diagnose near-extinction change; "
            "post-extinction slopes are vaporization."
        ),
        ha="center",
        fontsize=9,
    )
    fig.savefig(output, dpi=180, bbox_inches="tight")
    plt.close(fig)


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--pdf", type=Path, required=True, help="Locally obtained article PDF")
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    args.output.mkdir(parents=True, exist_ok=True)

    frame = extract_vector_points(args.pdf)
    fits = fit_histories(frame)
    frame.to_csv(args.output / "figure6_d2_vector_points.csv", index=False)
    fits.to_csv(args.output / "figure6_fit_summary.csv", index=False)
    make_plot(frame, fits, args.output / "figure6_refit_review.png")

    primary = fits[fits.window == "central_80"].copy()
    payload = {
        "analysis_type": "secondary vector-figure proof-of-method",
        "raw_images_recovered": False,
        "raw_per_test_d_t_histories_recovered": False,
        "independent_replication": False,
        "data_assimilation_executed": False,
        "source": {
            "authors": "Dietrich et al.",
            "year": 2014,
            "doi": SOURCE_DOI,
            "accessible_pdf_url": SOURCE_URL,
            "pdf_sha256": sha256(args.pdf),
            "pdf_page_index_zero_based": PAGE_INDEX,
            "article_page": ARTICLE_PAGE,
            "figure": 6,
            "published_downsampling": "Only one of every three experimental points is plotted",
        },
        "calibration": {
            "x_time_0_pdf_pt": X0,
            "x_time_2s_pdf_pt": X2,
            "y_d2_0_pdf_pt": Y0,
            "y_d2_8mm2_pdf_pt": Y8,
            "pdf_points_per_second": X_SCALE,
            "pdf_points_per_mm2": Y_SCALE,
            "legend_exclusion": "Markers wider than 3 PDF points excluded",
        },
        "primary_fit": "OLS on central 80% of pre-extinction time (0.10 to 0.90)",
        "series": primary[
            [
                "series",
                "n",
                "burning_rate_constant_mm2_s",
                "published_k_mm2_s",
                "k_minus_published_mm2_s",
                "k_relative_difference",
                "rmse_mm2",
                "r_squared",
                "late_to_primary_k_ratio",
                "late_k_reduction_fraction",
            ]
        ].to_dict(orient="records"),
        "candidate_row_mapping": {
            "status": "not_asserted_as_explicit_figure_identifiers",
            "basis": (
                "Composition, D0, published K and extinction time agree with "
                "unique candidate rows"
            ),
            "candidates": {key: spec["candidate_psi69_test"] for key, spec in SERIES.items()},
        },
        "limitations": [
            "Only three methanol curves are available in this figure.",
            "The figure is a published, downsampled secondary representation, not raw D(t).",
            "Figure 6 does not print per-curve test identifiers.",
            "The three environments are not fully matched in pressure, droplet size and protocol.",
            "Window fits are descriptive; no independent-point OLS p-values are reported.",
            "Post-extinction D² slopes are vaporization diagnostics, not hot-flame burning rates.",
            "Three curves cannot support a general diluent effect or data assimilation validation.",
        ],
    }
    with (args.output / "figure6_analysis_summary.json").open("w", encoding="utf-8") as handle:
        json.dump(payload, handle, ensure_ascii=False, indent=2)
    print(f"Extracted {len(frame)} published vector markers")
    print(
        primary[["series", "n", "burning_rate_constant_mm2_s", "published_k_mm2_s"]].to_string(
            index=False
        )
    )
    print("Raw histories recovered: false; independent replication: false")


if __name__ == "__main__":
    main()
