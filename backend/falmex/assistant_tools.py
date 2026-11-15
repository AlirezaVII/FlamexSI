"""Tools Ask FlamexSI can run on the real data. Gemini only chooses a tool and its arguments;
the numbers, charts and replays are computed here from the shipped NASA files.

Each tool returns a result the page draws (kind: scatter | bars | line | table | replay) and a
short evidence card the answer can cite.
"""

import json
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd
from scipy import stats

HERE = Path(__file__).parent
FLEX = HERE / "datasets" / "PSI-69_Experimental table_FLEX.csv"
KNOW = HERE / "knowledge"

VARS = {  # tool name -> (column, label, unit)
    "oxygen": ("o2", "Oxygen", "mole fraction"),
    "pressure": ("p_kpa", "Pressure", "kPa"),
    "helium": ("he", "Helium", "mole fraction"),
    "co2": ("co2", "CO₂", "mole fraction"),
    "initial_diameter": ("d0", "Starting droplet diameter", "mm"),
    "burning_rate": ("k", "Burning rate K", "mm²/s"),
    "burn_time": ("tb", "Burn time", "s"),
    "extinction_diameter": ("dext", "Extinction diameter", "mm"),
    "extinction_ratio": ("ratio", "Extinction diameter / starting diameter", ""),
}
COLS = {"FLEX Test #": "n", "FLEX Identifier": "id", "Test Date": "date", "Fuel": "fuel",
        "Ambient pressure; mmHg": "p", "O initial ambient composition; mole fraction": "o2",
        "N initial ambient composition; mole fraction": "n2",
        "CO initial ambient composition; mole fraction": "co2",
        "He initial ambient composition; mole fraction": "he",
        "Droplet initial diameter; mm": "d0", "Visible flame extinction diameter; mm": "dext",
        "Burning rate; mm": "k", "Burn time; s": "tb", "Test end": "end"}


@lru_cache
def flex() -> pd.DataFrame:
    df = pd.read_csv(FLEX, encoding="cp1252").rename(columns=COLS)[list(COLS.values())]
    for c in ["p", "o2", "n2", "co2", "he", "d0", "dext", "k", "tb"]:
        df[c] = pd.to_numeric(df[c], errors="coerce")
    df.loc[df["p"] <= 0, "p"] = np.nan  # the table writes 0 for a missing pressure
    df["p_kpa"] = df["p"] * 0.133322
    df["ratio"] = df["dext"] / df["d0"]
    return df


def _fuel(df, fuel):
    if fuel and str(fuel).lower() in ("heptane", "methanol"):
        return df[df["fuel"].str.lower() == str(fuel).lower()]
    return df


def flex_scatter(x="oxygen", y="burning_rate", fuel=None):
    if x not in VARS or y not in VARS or x == y:
        raise ValueError("choose two different variables")
    (cx, lx, ux), (cy, ly, uy) = VARS[x], VARS[y]
    df = _fuel(flex(), fuel).dropna(subset=[cx, cy])
    rho = {}
    for f, g in df.groupby("fuel"):
        if len(g) >= 8:
            r = stats.spearmanr(g[cx], g[cy])
            rho[f] = {"rho": round(float(r.statistic), 3), "p": float(r.pvalue), "n": len(g)}
    pts = [[round(float(a), 4), round(float(b), 4), f, int(n)]
           for a, b, f, n in df[[cx, cy, "fuel", "n"]].itertuples(index=False)]
    title = f"{ly} vs {lx.lower()} (FLEX{', ' + fuel if fuel else ''}, {len(pts)} tests)"
    return ({"kind": "scatter", "title": title, "x": {"label": lx, "unit": ux},
             "y": {"label": ly, "unit": uy}, "points": pts, "rho": rho,
             "caption": "Each dot is one FLEX flight test; ρ is Spearman's rank correlation "
                        "within each fuel (association, not cause)."},
            {"title": f"Tool: {title}", "facts": {"n": len(pts), "spearman_by_fuel": rho,
             "x_range": [float(df[cx].min()), float(df[cx].max())],
             "y_range": [float(df[cy].min()), float(df[cy].max())]}, "page": "/explorer"})


def extinction_by_oxygen(fuel=None):
    df = _fuel(flex(), fuel).dropna(subset=["o2"])
    bins = [0.12, 0.16, 0.19, 0.22, 0.25, 0.28, 0.31, 0.35]
    df = df.assign(band=pd.cut(df["o2"], bins, right=False))
    rows = []
    for band, g in df.groupby("band", observed=True):
        rows.append({"label": f"{band.left * 100:.0f}–{band.right * 100:.0f}% O₂",
                     "value": round(float((g["end"] == "Extinction").mean()), 3), "n": len(g)})
    title = "Share of FLEX tests ending in flame extinction, by oxygen" + (
        f" ({fuel})" if fuel else "")
    return ({"kind": "bars", "title": title, "unit": "share of tests", "max": 1, "rows": rows,
             "caption": "Other tests ended by burning to completion or droplet disruption."},
            {"title": f"Tool: {title}", "facts": rows, "page": "/flight-evidence#transition"})


def smoke_by_material():
    mats = json.loads((KNOW / "pack.json").read_text())
    smoke = next(c for c in mats if c["id"] == "smoke")["facts"]["materials"]
    rows = [{"label": m["material"], "value": m["detector_median_v"],
             "note": f"particles {m['fresh_diameter_um']}→{m['aged_diameter_um']} µm",
             "n": m["tests"]} for m in smoke]
    title = "ISS smoke detector signal by burning material (SAME, SAME-R)"
    return ({"kind": "bars", "title": title, "unit": "V (median)", "max": 6.5, "rows": rows,
             "caption": "About 6.2 V is the detector's full-scale output."},
            {"title": f"Tool: {title}", "facts": rows, "page": "/flight-evidence#smoke"})


def saffire_timeline():
    s = json.loads((KNOW / "saffire_series.json").read_text())
    t0 = s["t0"]
    series = [{"name": name, "points": [[round(r[0] - t0), r[i]] for r in s["rows"]
                                        if r[i] is not None]}
              for i, name in ((1, "Flame radiation, radiometers 1+3"),
                              (2, "Flame radiation, radiometers 2+4"),
                              (3, "Smoke detector (scatter)"))]
    title = "Saffire-III on the Cygnus spacecraft: flame radiation and smoke over time"
    return ({"kind": "line", "title": title, "x": {"label": "Seconds after the first ignition"},
             "series": series, "normalise": True, "markers": s["ignitions"],
             "caption": "Each line is scaled to its own peak so they share one axis."},
            {"title": f"Tool: {title}", "facts": {"samples": s["summary"]},
             "page": "/flight-evidence#saffire"})


def find_tests(fuel=None, oxygen_min=None, oxygen_max=None, end=None, limit=12):
    df = _fuel(flex(), fuel)
    if oxygen_min is not None:
        df = df[df["o2"] >= float(oxygen_min)]
    if oxygen_max is not None:
        df = df[df["o2"] <= float(oxygen_max)]
    if end and str(end).capitalize() in ("Extinction", "Completion", "Disruption"):
        df = df[df["end"] == str(end).capitalize()]
    cols = ["n", "id", "fuel", "o2", "p_kpa", "d0", "k", "tb", "end"]
    head = ["Test", "ID", "Fuel", "O₂", "kPa", "d₀ mm", "K mm²/s", "Burn s", "Ended by"]
    rows = [[None if pd.isna(v) else (round(v, 3) if isinstance(v, float) else v)
             for v in r] for r in df[cols].head(int(limit)).itertuples(index=False)]
    title = f"FLEX tests matching your conditions ({len(df)} found)"
    return ({"kind": "table", "title": title, "columns": head, "rows": rows, "total": len(df),
             "caption": f"Showing {len(rows)} of {len(df)}."},
            {"title": f"Tool: {title}", "facts": {"matching": len(df), "first_rows": rows[:8]},
             "page": "/explorer"})


def flame_replay(tests=None, fuel=None, oxygen=None):
    df = flex().dropna(subset=["d0", "k", "tb"])
    df = df[(df["d0"] > 0) & (df["k"] > 0) & (df["tb"] > 0)]
    picked = []
    for n in (tests or [])[:2]:
        hit = df[df["n"] == int(n)]
        if len(hit):
            picked.append(hit.iloc[0])
    if not picked:
        pool = _fuel(df, fuel)
        if oxygen is not None:
            pool = pool.assign(gap=(pool["o2"] - float(oxygen)).abs()).sort_values("gap")
        picked = [pool.iloc[0]] if len(pool) else [df.iloc[0]]
    recs = [{"n": int(r["n"]), "id": r["id"], "date": r["date"], "fuel": r["fuel"],
             "p": None if pd.isna(r["p"]) else float(r["p"]), "o2": float(r["o2"]),
             "n2": float(r["n2"]), "co2": float(r["co2"]), "he": float(r["he"]),
             "d0": float(r["d0"]), "dext": None if pd.isna(r["dext"]) else float(r["dext"]),
             "k": float(r["k"]), "tb": float(r["tb"]), "end": r["end"]} for r in picked]
    title = "3D replay: " + " vs ".join(f"FLEX #{r['n']} ({r['fuel']}, {r['o2'] * 100:.0f}% O₂)"
                                        for r in recs)
    return ({"kind": "replay", "title": title, "tests": recs,
             "caption": "Droplet shrinks with the measured burning rate; the flame goes out at "
                        "the measured burn time. Flame size and colour are illustrative."},
            {"title": f"Tool: {title}", "facts": recs, "page": "/flame-lab"})


def vision_scores():
    v = next(c for c in json.loads((KNOW / "pack.json").read_text()) if c["id"] == "vision")
    rows = [{"label": f"{r['model']} vs reviewer {r['reference']}", "value": round(r["iou"], 3)}
            for r in v["facts"]["scores"] if r["reference"] in ("A", "B")]
    rows.append({"label": "Human A vs human B", "value": v["facts"]["human_A_vs_B_pixel_IoU"]})
    title = "Finding the flame in BASS-II video: pixel overlap (IoU)"
    return ({"kind": "bars", "title": title, "unit": "IoU", "max": 1, "rows": rows,
             "caption": "OpenCV uses no training; v6 is the earlier learned model."},
            {"title": f"Tool: {title}", "facts": rows, "page": "/bass-review"})


# ---- data-science tools: real statistics on the FLEX table, chosen by the model ----------

def _subset(fuel=None, oxygen_min=None, oxygen_max=None, pressure_min=None, pressure_max=None):
    df = _fuel(flex(), fuel)
    for col, lo, hi in (("o2", oxygen_min, oxygen_max), ("p_kpa", pressure_min, pressure_max)):
        if lo is not None:
            df = df[df[col] >= float(lo)]
        if hi is not None:
            df = df[df[col] <= float(hi)]
    return df


def _where(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max):
    parts = [fuel] if fuel else []
    if oxygen_min is not None or oxygen_max is not None:
        parts.append(f"O₂ {oxygen_min or 'min'}–{oxygen_max or 'max'}")
    if pressure_min is not None or pressure_max is not None:
        parts.append(f"{pressure_min or 'min'}–{pressure_max or 'max'} kPa")
    return ", ".join(parts) or "all tests"


def _ranks_resid(a, z):
    ra, rz = pd.Series(a).rank().to_numpy(), pd.Series(z).rank().to_numpy()
    return ra - np.polyval(np.polyfit(rz, ra, 1), rz)


def correlate(x="oxygen", y="burning_rate", control=None, fuel=None, oxygen_min=None,
              oxygen_max=None, pressure_min=None, pressure_max=None):
    """Spearman rho with a bootstrap 95% interval; with `control`, the partial rho holding
    that variable fixed (rank residuals) - the confounding check."""
    if x not in VARS or y not in VARS or x == y or (control and control not in VARS):
        raise ValueError("unknown variable")
    cx, cy = VARS[x][0], VARS[y][0]
    cz = VARS[control][0] if control else None
    df = _subset(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max)
    df = df.dropna(subset=[c for c in (cx, cy, cz) if c])
    if len(df) < 10:
        raise ValueError("too few tests")
    a, b = df[cx].to_numpy(), df[cy].to_numpy()
    r = stats.spearmanr(a, b)
    rng = np.random.default_rng(7)
    boots = [stats.spearmanr(a[i], b[i]).statistic
             for i in (rng.integers(0, len(a), len(a)) for _ in range(500))]
    lo, hi = np.nanpercentile(boots, [2.5, 97.5])
    out = {"n": len(df), "rho": round(float(r.statistic), 3), "p": float(r.pvalue),
           "ci95": [round(float(lo), 3), round(float(hi), 3)],
           "subset": _where(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max)}
    if cz:
        z = df[cz].to_numpy()
        pr = float(np.corrcoef(_ranks_resid(a, z), _ranks_resid(b, z))[0, 1])
        out.update(control=VARS[control][1], partial_rho=round(pr, 3),
                   retained_share=round(pr / out["rho"], 2) if out["rho"] else None)
    pts = [[round(float(u), 4), round(float(v), 4), f, int(n)]
           for u, v, f, n in df[[cx, cy, "fuel", "n"]].itertuples(index=False)]
    title = f"Correlation: {VARS[y][1].lower()} vs {VARS[x][1].lower()} ({out['subset']})"
    note = (f"Spearman ρ = {out['rho']} (95% bootstrap interval {out['ci95'][0]} to "
            f"{out['ci95'][1]}, n = {out['n']}, p = {out['p']:.2g})")
    if cz:
        note += (f"; holding {out['control'].lower()} fixed: partial ρ = {out['partial_rho']}"
                 f" ({out['retained_share']} of the association kept)")
    return ({"kind": "scatter", "title": title, "x": {"label": VARS[x][1], "unit": VARS[x][2]},
             "y": {"label": VARS[y][1], "unit": VARS[y][2]}, "points": pts, "rho": {},
             "stats": note, "caption": "Computed on the FLEX flight table by the server. "
                                       "Association, not cause."},
            {"title": f"Tool: {title}", "facts": out, "page": "/explorer"})


def compare_groups(variable="burning_rate", by="fuel", fuel=None, oxygen_min=None,
                   oxygen_max=None, pressure_min=None, pressure_max=None):
    """Median and quartiles of one variable per group, with Kruskal-Wallis (or Mann-Whitney)."""
    if variable not in VARS:
        raise ValueError("unknown variable")
    col = VARS[variable][0]
    df = _subset(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max).dropna(subset=[col])
    if by == "diluent":
        df = df.assign(group=np.where(df["he"] > 0.005, "with helium",
                                      np.where(df["co2"] > 0.005, "with CO₂", "N₂ only")))
    elif by in ("fuel", "end"):
        df = df.assign(group=df[by])
    else:
        raise ValueError("group by fuel, end or diluent")
    groups = {g: d[col].to_numpy() for g, d in df.groupby("group") if len(d) >= 5}
    if len(groups) < 2:
        raise ValueError("fewer than two groups with data")
    test = (stats.mannwhitneyu(*groups.values()) if len(groups) == 2
            else stats.kruskal(*groups.values()))
    rows = [{"label": g, "value": round(float(np.median(v)), 3),
             "note": f"quartiles {np.percentile(v, 25):.3g}–{np.percentile(v, 75):.3g}",
             "n": len(v)} for g, v in groups.items()]
    name = "Mann-Whitney" if len(groups) == 2 else "Kruskal-Wallis"
    where = _where(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max)
    title = f"{VARS[variable][1]} by {by} ({where})"
    facts = {"medians": rows, "test": name, "p": float(test.pvalue), "subset": where}
    return ({"kind": "bars", "title": title, "unit": f"median {VARS[variable][2]}".strip(),
             "rows": rows, "stats": f"{name} p = {float(test.pvalue):.2g}",
             "caption": "Bars are medians; hover a label for quartiles."},
            {"title": f"Tool: {title}", "facts": facts, "page": "/explorer"})


def describe(variable="burning_rate", fuel=None, oxygen_min=None, oxygen_max=None,
             pressure_min=None, pressure_max=None):
    """Distribution of one variable: summary statistics and a histogram."""
    if variable not in VARS:
        raise ValueError("unknown variable")
    col = VARS[variable][0]
    v = _subset(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max)[col].dropna()
    if len(v) < 5:
        raise ValueError("too few tests")
    counts, edges = np.histogram(v, bins=min(10, max(4, len(v) // 12)))
    rows = [{"label": f"{edges[i]:.3g}–{edges[i + 1]:.3g}", "value": int(c)}
            for i, c in enumerate(counts)]
    where = _where(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max)
    facts = {"n": int(len(v)), "mean": round(float(v.mean()), 4),
             "median": round(float(v.median()), 4), "sd": round(float(v.std()), 4),
             "min": float(v.min()), "max": float(v.max()),
             "quartiles": [round(float(v.quantile(.25)), 4), round(float(v.quantile(.75)), 4)],
             "subset": where}
    title = f"Distribution of {VARS[variable][1].lower()} ({where})"
    return ({"kind": "bars", "title": title, "unit": "number of tests per range", "rows": rows,
             "stats": f"n = {facts['n']} · median {facts['median']} · mean {facts['mean']} · "
                      f"SD {facts['sd']} · range {facts['min']:.3g}–{facts['max']:.3g}"},
            {"title": f"Tool: {title}", "facts": facts, "page": "/explorer"})


def fit_model(outcome="burning_rate", predictors=("oxygen", "pressure", "initial_diameter"),
              fuel=None, oxygen_min=None, oxygen_max=None, pressure_min=None, pressure_max=None):
    """Ordinary least squares on standardised variables: which conditions go with the outcome
    when the others are held fixed. Coefficients with 95% intervals, R² and n."""
    preds = [p for p in (predictors or []) if p in VARS and p != outcome][:5]
    if outcome not in VARS or not preds:
        raise ValueError("choose an outcome and predictors")
    cols = [VARS[p][0] for p in preds]
    cy = VARS[outcome][0]
    df = _subset(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max)
    df = df.dropna(subset=cols + [cy])
    df = df[[c for c in cols if df[c].std() > 0] + [cy]]
    keep = [p for p in preds if VARS[p][0] in df.columns]
    if len(df) < 15 or not keep:
        raise ValueError("too few tests")
    Xs = (df[[VARS[p][0] for p in keep]] - df[[VARS[p][0] for p in keep]].mean()) / \
        df[[VARS[p][0] for p in keep]].std()
    ys = (df[cy] - df[cy].mean()) / df[cy].std()
    X = np.column_stack([np.ones(len(df)), Xs.to_numpy()])
    beta, *_ = np.linalg.lstsq(X, ys.to_numpy(), rcond=None)
    resid = ys.to_numpy() - X @ beta
    dof = len(df) - X.shape[1]
    sigma2 = float(resid @ resid) / dof
    se = np.sqrt(np.diag(sigma2 * np.linalg.pinv(X.T @ X)))
    tq = stats.t.ppf(0.975, dof)
    r2 = 1 - float(resid @ resid) / float(((ys - ys.mean()) ** 2).sum())
    rows = [[VARS[p][1], round(float(b), 3), f"{b - tq * e:.3f} to {b + tq * e:.3f}",
             f"{2 * stats.t.sf(abs(b / e), dof):.2g}"]
            for p, b, e in zip(keep, beta[1:], se[1:], strict=False)]
    where = _where(fuel, oxygen_min, oxygen_max, pressure_min, pressure_max)
    title = f"Model: {VARS[outcome][1].lower()} from {', '.join(VARS[p][1].lower() for p in keep)}"
    facts = {"n": len(df), "r2": round(r2, 3), "subset": where,
             "standardised_coefficients": rows}
    return ({"kind": "table", "title": f"{title} ({where})",
             "columns": ["Condition", "Effect (SD per SD)", "95% interval", "p"], "rows": rows,
             "stats": f"R² = {r2:.3f}, n = {len(df)}",
             "caption": "Linear model on standardised variables: each effect is the change in "
                        "the outcome per standard deviation of that condition, the others held "
                        "fixed. Observational flight data: association, not cause."},
            {"title": f"Tool: {title}", "facts": facts, "page": "/explorer"})


TOOLS = {
    "flex_scatter": (flex_scatter, "Scatter chart of two FLEX variables. args: x, y from "
                     + ", ".join(VARS) + "; optional fuel (Heptane|Methanol)"),
    "extinction_by_oxygen": (extinction_by_oxygen, "Bar chart: share of FLEX tests ending in "
                             "extinction per oxygen band. args: optional fuel"),
    "smoke_by_material": (smoke_by_material, "Bar chart: ISS smoke detector signal per "
                          "material (SAME). no args"),
    "saffire_timeline": (saffire_timeline, "Line chart of the Saffire-III spacecraft fire: "
                         "flame radiation and smoke over time. no args"),
    "find_tests": (find_tests, "Table of FLEX tests. args: optional fuel, oxygen_min, "
                   "oxygen_max (mole fractions), end (Extinction|Completion|Disruption)"),
    "flame_replay": (flame_replay, "Interactive 3D replay of real FLEX droplet burns. args: "
                     "tests (list of up to 2 FLEX test numbers) or fuel and oxygen"),
    "correlate": (correlate, "Data science: Spearman correlation of two FLEX variables with a "
                  "bootstrap 95% interval; optional control (a third variable held fixed = "
                  "confounding check); optional filters fuel, oxygen_min, oxygen_max, "
                  "pressure_min, pressure_max. Variables: " + ", ".join(VARS)),
    "compare_groups": (compare_groups, "Data science: compare one FLEX variable across groups "
                       "(by = fuel | end | diluent) with medians, quartiles and a "
                       "Kruskal-Wallis/Mann-Whitney test; same optional filters"),
    "describe": (describe, "Data science: distribution of one FLEX variable (mean, median, "
                 "SD, quartiles, histogram); same optional filters"),
    "fit_model": (fit_model, "Data science: multiple linear regression of an outcome on up to "
                  "5 predictors (standardised coefficients, 95% intervals, R²); args outcome, "
                  "predictors (list); same optional filters"),
    "vision_scores": (vision_scores, "Bar chart: how well OpenCV and the learned model find "
                      "the flame in BASS-II video vs human reviewers. no args"),
}


def run(name: str, args: dict):
    fn = TOOLS[name][0]
    allowed = fn.__code__.co_varnames[: fn.__code__.co_argcount]
    return fn(**{k: v for k, v in (args or {}).items() if k in allowed})


KEYWORD_PLAN = [  # used without Gemini (tests) and if planning fails
    (("correlat", "relationship", "affect", "depend"), "correlate",
     {"x": "oxygen", "y": "burning_rate", "control": "pressure"}),
    (("distribution", "spread", "how much does"), "describe", {"variable": "burning_rate"}),
    (("compare", "difference between", "versus", " vs "), "compare_groups",
     {"variable": "burning_rate", "by": "fuel"}),
    (("model", "regression", "predict"), "fit_model",
     {"outcome": "burning_rate", "predictors": ["oxygen", "pressure", "initial_diameter"]}),
    (("smoke", "detector", "kapton", "teflon"), "smoke_by_material", {}),
    (("saffire", "cygnus", "cabin fire", "spacecraft fire"), "saffire_timeline", {}),
    (("replay", "visuali", "show me a burn", "3d", "animation"), "flame_replay", {}),
    (("go out", "extinction", "extinguish"), "extinction_by_oxygen", {}),
    (("opencv", "vision", "image", "video", "camera"), "vision_scores", {}),
    (("oxygen", "burning rate", "burn faster"), "flex_scatter",
     {"x": "oxygen", "y": "burning_rate"}),
    (("which tests", "list", "find tests"), "find_tests", {}),
]


def keyword_plan(question: str) -> list[dict]:
    q = question.lower()
    return [{"name": n, "args": a} for keys, n, a in KEYWORD_PLAN
            if any(k in q for k in keys)][:3]
