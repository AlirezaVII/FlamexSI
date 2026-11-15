"""Build the PSI combustion-investigation catalog used by the app's /investigations page.

Inputs: NASA PSI metadata, one JSON per investigation, as returned by
`https://psi.nasa.gov/geode-py/ws/studies/<ID>/metadata` (saved in review_seed/psi_metadata).
Output: frontend/src/lib/psi/catalog.json.

Everything descriptive (objective, hypothesis, approach, hardware, dates, keywords, impacts,
publication count, DOI) is copied from NASA's metadata. Test conditions are only reported
where NASA's own text states them: each value carries the sentence it came from. The few
classifications Falmex adds (fuel type, fire-safety pillar) are listed in CLASSIFY with the
reason, so a reader can check them.
"""

import json
import re
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
SOURCE = ROOT / "backend/review_seed/psi_metadata"
OUT = ROOT / "frontend/src/lib/psi/catalog.json"

# Falmex classification. fuel: solid | droplet | gas | smoke | model. pillars follow NASA's
# spacecraft fire-safety framing (prevention / detection / suppression), quoted in the
# challenge. "basis" says where the classification comes from.
CLASSIFY = {
    "PSI-10": ("gas", ["prevention"], "Gaseous spherical flames: soot-inception and "
               "extinction limits with inert dilution (PSI objective)."),
    "PSI-20": ("gas", ["prevention"], "Burning Rate Emulator: gas burner emulating solid "
               "material flammability in still air, as a function of material properties "
               "(challenge text, PSI objective)."),
    "PSI-21": ("gas", ["prevention"], "Coflow laminar diffusion flames near the dilution "
               "limit (PSI objective)."),
    "PSI-22": ("gas", ["prevention"], "Electric field effects; mimics partial gravity "
               "through ion-driven flow (challenge text)."),
    "PSI-23": ("gas", ["prevention"], "Spherical diffusion flames, structure and "
               "extinction (PSI objective)."),
    "PSI-25": ("solid", ["prevention", "suppression"], "Solid fuels: ignition, spread and "
               "extinction limits with forced flow; tagged Fire Suppression (PSI)."),
    "PSI-26": ("solid", ["prevention", "suppression"], "Solid fuels; bridges NASA-STD-6001 "
               "ground test and microgravity flammability (PSI objective)."),
    "PSI-39": ("droplet", ["prevention"], "Droplet cool flames and extinction, helium "
               "dilution (PSI objective)."),
    "PSI-62": ("model", ["prevention"], "Model of concurrent flame spread over solids, "
               "validated against BASS (PSI objective)."),
    "PSI-68": ("droplet", ["suppression", "prevention"], "Droplet extinction across fuels "
               "and diluents; extends FLEX (PSI objective)."),
    "PSI-69": ("droplet", ["suppression", "prevention"], "Flammability limits of liquid "
               "fuels and effectiveness of gaseous suppressants CO2, He (PSI objective, "
               "challenge text)."),
    "PSI-98": ("solid", ["prevention", "detection"], "Large-scale fire growth and low-g "
               "flammability limits vs the 1-g screening test; smoke distribution (PSI)."),
    "PSI-99": ("solid", ["prevention", "detection"], "As Saffire-I; smoldering and smoke "
               "distribution (PSI tags)."),
    "PSI-100": ("solid", ["prevention", "detection"], "As Saffire-I; smoldering and "
                "flammability (PSI tags)."),
    "PSI-101": ("smoke", ["detection"], "Smoke particle size in low gravity from cabin "
                "materials (challenge text, PSI objective)."),
    "PSI-102": ("smoke", ["detection"], "Smoke particle size in low gravity (challenge "
                "text, PSI objective)."),
    "PSI-106": ("gas", ["prevention"], "Structure and liftoff of laminar diffusion flames "
                "(PSI objective)."),
    "PSI-107": ("gas", ["prevention", "detection"], "Smoke point and soot emission of "
                "jet flames (PSI objective)."),
    "PSI-115": ("model", ["detection"], "Simulation of smoke growth in micro- vs Earth "
                "gravity using SAME data (PSI objective)."),
    "PSI-117": ("model", ["suppression"], "Analysis of FLEX flight data: perturbations and "
                "the fate of cool flames (PSI objective)."),
    "PSI-142": ("model", ["suppression", "prevention"], "Ground experiments and models of "
                "cool-flame transitions using FLEX data (PSI objective)."),
    "PSI-159": ("gas", ["prevention"], "Cool diffusion flames; highest oxygen tested in "
                "microgravity, up to 85% from the burner (challenge text)."),
}

# What Falmex itself has processed from the investigation's data.
IN_FALMEX = {
    "PSI-69": "Experimental table analysed: discovery, validation and the Flight evidence page.",
    "PSI-25": "24 camera frames annotated by two reviewers; image models evaluated.",
    "PSI-68": "Raw instrument files read in the data-day dry run (not yet summarised).",
}

# Oxygen levels stated outside the PSI metadata text, each with its source.
EXTRA_OXYGEN = {
    "PSI-69": ([12.0, 34.0], "PSI-69 experimental table (initial ambient O2 mole fraction "
               "0.12-0.34), as analysed in Falmex"),
    "PSI-159": ([None, 85.0], "Challenge text: oxygen-nitrogen mixture of up to 85% oxygen "
                "flowed from the spherical burner (inside-out flame)"),
    "PSI-20": ([21.0, 34.0], "PSI objective: 14.7 psia 21%, 10.2 psia 26.5%, 8.2 psia 34% "
               "oxygen (atmospheres considered for human missions)"),
    "PSI-25": ([None, 21.0], "PSI approach: oxygen varied below 21% by adding nitrogen"),
}
APPARATUS_OXYGEN = {  # what the hardware can do, not what was tested
    "PSI-68": "MDCA accepts up to 40% oxygen at 0-3 atm (NASA Researcher's Guide, 2015)",
    "PSI-69": "MDCA accepts up to 40% oxygen at 0-3 atm (NASA Researcher's Guide, 2015)",
    "PSI-39": "MDCA accepts up to 40% oxygen at 0-3 atm (NASA Researcher's Guide, 2015)",
}

MEASUREMENTS = {
    "camera / video": r"\b(camera|video|imag(?:e|ing)|photograph)",
    "radiometer": r"radiomet",
    "thermocouple / temperature": r"thermocouple|temperature",
    "pressure": r"\bpressure",
    "gas composition": r"gas (?:analy|sampl|composition|concentration)|\bCO2?\b|oxygen sensor",
    "laser diagnostics (PLIF)": r"\bPLIF\b|laser",
    "pyrometry": r"pyrometr",
    "particle / smoke size": r"particle|particulate|aerosol|smoke",
    "soot": r"\bsoot",
    "electric current": r"chemi-?ion|current|voltage",
}

NUM = r"(\d+(?:\.\d+)?)"
PATTERNS = {
    "oxygen": [
        rf"{NUM}\s*(?:%|percent)\s*(?:oxygen|O2|O₂)",
        rf"(?:oxygen|O2)[^.;]{{0,40}}?{NUM}\s*(?:%|percent)",
        r"(?:oxygen|O2)[^.;]{0,30}?mole fraction[^.;]{0,15}?(0\.\d+)",
    ],
    "pressure": [rf"{NUM}\s*(?:-|–|−|to)?\s*(?:{NUM}\s*)?(atm|psia?|kPa)\b"],
    "flow": [rf"{NUM}\s*(?:-|–|−|to)?\s*(?:{NUM}\s*)?(cm/s|mm/s|m/s)\b"],
}


def sentences(text: str) -> list[str]:
    return [s.strip() for s in re.split(r"(?<=[.;])\s+|\n+", text) if s.strip()]


def conditions(text: str) -> dict:
    """Values of oxygen, pressure and flow that NASA's text states, with the sentence."""
    found: dict[str, list[dict]] = {}
    for kind, pats in PATTERNS.items():
        for sentence in sentences(text):
            for pat in pats:
                for m in re.finditer(pat, sentence, flags=re.IGNORECASE):
                    nums = [float(g) for g in m.groups() if g and re.fullmatch(NUM, g)]
                    if not nums:
                        continue
                    unit = m.groups()[-1] if kind != "oxygen" else "%"
                    if kind == "oxygen":
                        nums = [n * 100 if n < 1 else n for n in nums]
                        if not all(0 < n <= 100 for n in nums):
                            continue
                    found.setdefault(kind, []).append(
                        {"values": nums, "unit": unit, "quote": sentence[:320]}
                    )
    # keep each quote once per kind
    for kind, rows in found.items():
        seen, unique = set(), []
        for r in rows:
            if r["quote"] not in seen:
                seen.add(r["quote"])
                unique.append(r)
        found[kind] = unique[:4]
    return found


def oxygen_range(conds: dict) -> list[float] | None:
    vals = [v for r in conds.get("oxygen", []) for v in r["values"]]
    return [min(vals), max(vals)] if vals else None


def build() -> list[dict]:
    out = []
    for path in sorted(SOURCE.glob("PSI-*.json"), key=lambda p: int(p.stem[4:])):
        st = json.loads(path.read_text())["studies"][0]
        c = {x["name"]: (x["value"] or "").strip() for x in st.get("comments", [])}
        text = "\n".join(c.get(k, "") for k in ("Objective", "Approach", "Hypothesis"))
        conds = conditions(text)
        fuel, pillars, basis = CLASSIFY[st["identifier"]]
        meas = [name for name, pat in MEASUREMENTS.items()
                if re.search(pat, text, flags=re.IGNORECASE)]
        out.append({
            "id": st["identifier"],
            "acronym": c.get("Investigation Acronym") or st["identifier"],
            "title": st["title"],
            "area": c.get("SubResearch Area", ""),
            "platform": c.get("Flight Platform", ""),
            "hardware": c.get("Experiment Hardware", ""),
            "start": c.get("Investigation Start Date", ""),
            "end": c.get("Investigation End Date", ""),
            "doi": c.get("DOI", ""),
            "tags": [x["annotationValue"] for x in st.get("studyDesignDescriptors", [])],
            "objective": c.get("Objective", ""),
            "hypothesis": c.get("Hypothesis", ""),
            "approach": c.get("Approach", ""),
            "impacts": c.get("Research Impacts", ""),
            "publications": len(st.get("publications", [])),
            "people": len(st.get("people", [])),
            "fuel": fuel,
            "pillars": pillars,
            "classification_basis": basis,
            "conditions": conds,
            "oxygen_range": (EXTRA_OXYGEN.get(st["identifier"], (None,))[0]
                             or oxygen_range(conds)),
            "oxygen_source": (EXTRA_OXYGEN[st["identifier"]][1]
                              if st["identifier"] in EXTRA_OXYGEN
                              else ("PSI metadata text" if oxygen_range(conds) else None)),
            "apparatus_oxygen": APPARATUS_OXYGEN.get(st["identifier"]),
            "measurements": meas,
            "spacecraft_fire_safety": "fire safety" in (
                c.get("SubResearch Area", "") + " " + " ".join(
                    x["annotationValue"] for x in st.get("studyDesignDescriptors", []))
            ).lower(),
            "in_falmex": IN_FALMEX.get(st["identifier"]),
            "psi_url": f"https://psi.nasa.gov/physci/repo/data/investigations/{st['identifier']}",
        })
    return out


if __name__ == "__main__":
    rows = build()
    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(json.dumps(rows, ensure_ascii=False, indent=1))
    for r in rows:
        print(r["id"], r["acronym"], r["fuel"], r["pillars"], "O2:", r["oxygen_range"],
              "| P:", len(r["conditions"].get("pressure", [])),
              "| flow:", len(r["conditions"].get("flow", [])), "| meas:", len(r["measurements"]))
