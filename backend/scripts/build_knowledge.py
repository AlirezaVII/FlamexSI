"""The assistant's knowledge pack: every result FlamexSI computed, as short citable cards.

Reads the result files the site already shows (frontend/src/lib/...) and writes
backend/falmex/knowledge/pack.json. Each card: id, title, page (where the site shows it),
keywords (English and Persian, used to pick cards for a question) and facts (compact JSON
the model may quote). Live FLEX findings are added at request time from the database.
Usage: python backend/scripts/build_knowledge.py
"""

import json
from pathlib import Path

ROOT = Path(__file__).resolve().parents[2]
LIB = ROOT / "frontend/src/lib"
OUT = ROOT / "backend/falmex/knowledge/pack.json"


def load(rel):
    return json.loads((LIB / rel).read_text())


def short(text, n=260):
    text = " ".join(str(text or "").split())
    return text if len(text) <= n else text[: n - 1].rsplit(" ", 1)[0] + "…"


def build() -> list[dict]:
    cards = []
    cat = load("psi/catalog.json")
    cards.append({
        "id": "catalog", "title": "NASA PSI combustion investigations (22)",
        "page": "/investigations",
        "keywords": ["investigation", "experiment", "psi", "catalog", "acme", "bass", "flex",
                     "saffire", "same", "cfi", "slice", "spice", "which", "compare", "list",
                     "pillar", "prevention", "detection", "suppression", "آزمایش", "پروژه",
                     "مقایسه", "کدام", "پیشگیری", "تشخیص", "اطفا", "خاموش"],
        "facts": [{"id": c["id"], "name": c["acronym"], "title": c["title"],
                   "fuel": c.get("fuel"), "pillars": c.get("pillars"),
                   "oxygen": c.get("oxygen_range"), "platform": c.get("platform"),
                   "years": f"{c.get('start') or ''}-{c.get('end') or ''}",
                   "objective": short(c.get("objective"), 220),
                   "fire_safety": short(c.get("spacecraft_fire_safety"), 200)} for c in cat],
    })
    t = load("flight/transitions.json")
    cards.append({
        "id": "transition", "title": "FLEX: oxygen level where droplet flames start to go out",
        "page": "/flight-evidence#transition",
        "keywords": ["extinction", "boundary", "transition", "oxygen", "go out", "limit",
                     "flammability", "خاموش", "اکسیژن", "مرز", "حد"],
        "facts": {"method": short(t.get("method"), 700), "fuels": t.get("fuels")},
    })
    n = load("flight/next_experiments.json")
    cards.append({
        "id": "next", "title": "Which FLEX-type experiment should come next",
        "page": "/flight-evidence#next",
        "keywords": ["next", "experiment", "gap", "moon", "mars", "habitat", "rover", "plan",
                     "future", "test", "آزمایش بعدی", "ماه", "مریخ", "پایگاه", "آینده"],
        "facts": {"method": short(n.get("method"), 500),
                  "moon_base_tests_flown": n.get("moon_base_tests"),
                  "top_suggestions": n.get("suggestions", [])[:6]},
    })
    sm = load("flight/smoke.json")
    cards.append({
        "id": "smoke", "title": "SAME and SAME-R: smoke particles and the ISS smoke detector",
        "page": "/flight-evidence#smoke",
        "keywords": ["smoke", "detector", "detection", "particle", "aerosol", "kapton",
                     "teflon", "same", "alarm", "دود", "دتکتور", "ذرات", "تشخیص", "هشدار"],
        "facts": {k: sm[k] for k in ("source", "method", "tests", "fuel_tests",
                                     "full_scale_share", "flights", "materials")},
    })
    sf = load("flight/saffire.json")
    cards.append({
        "id": "saffire", "title": "Saffire-III: a real fire inside the Cygnus spacecraft",
        "page": "/flight-evidence#saffire",
        "keywords": ["saffire", "cygnus", "cabin", "spacecraft fire", "large fire", "spread",
                     "radiometer", "pressure", "temperature", "real fire", "کابین",
                     "فضاپیما", "آتش واقعی", "گسترش"],
        "facts": {k: sf[k] for k in ("source", "method", "samples", "ignited_in_file")},
    })
    f2 = load("flight/flex2.json")
    cards.append({
        "id": "flex2", "title": "FLEX-2: every raw test log summarised",
        "page": "/flight-evidence#flex2",
        "keywords": ["flex-2", "flex2", "raw", "log", "ignition", "igniter", "failed",
                     "flame time", "fiber", "لاگ", "احتراق", "جرقه"],
        "facts": {k: v for k, v in f2.items() if k != "per_month"},
    })
    br = load("bass-review.json")
    cards.append({
        "id": "vision", "title": "BASS-II video: where is the flame? (computer vision)",
        "page": "/bass-review",
        "keywords": ["image", "video", "camera", "frame", "vision", "opencv", "mask", "pixel",
                     "iou", "bass", "detect", "model", "segmentation", "تصویر", "ویدیو",
                     "دوربین", "فریم", "بینایی", "پیکسل", "مدل"],
        "facts": {"frames": len(br["frames"]),
                  "human_A_vs_B_pixel_IoU": 0.257,
                  "scores": [r for r in br["summary"] if r["model"] in ("OpenCV", "v6")],
                  "opencv_per_video": br.get("opencv"),
                  "note": "OpenCV has no training; each video's settings were chosen on the "
                          "other two videos. v6 is the earlier learned LightGBM model."},
    })
    show = load("flight/showcase.json")
    cards.append({
        "id": "trust", "title": "How a FLEX finding is tested (top finding, all checks)",
        "page": "/findings",
        "keywords": ["trust", "valid", "replicat", "shuffle", "third variable", "confound",
                     "reliable", "proof", "تأیید", "معتبر", "اعتماد", "شانسی"],
        "facts": {k: v for k, v in show.items() if k not in ("finding_id",)},
    })
    cards.append({
        "id": "limits", "title": "What FlamexSI cannot claim",
        "page": "/#status",
        "keywords": ["limit", "cannot", "partial gravity", "moon", "mars", "lunar", "expert",
                     "causal", "محدود", "نمی‌تواند", "گرانش", "ماه", "مریخ"],
        "facts": [
            "No partial-gravity (Moon, Mars) combustion data exists in PSI yet; microgravity "
            "and 1 g results only bound those cases.",
            "Findings are statistical associations, not causes, and are not yet signed off "
            "by a combustion expert (evidence readiness level 7 is never automatic).",
            "Droplet results (FLEX) are not cabin fires; the radiometers in Saffire sit next "
            "to the sample, unlike cabin sensors.",
            "FLEX-2 atmospheres (oxygen, diluent per test) are in larger chamber logs not "
            "read yet.",
        ],
    })
    return cards


if __name__ == "__main__":
    OUT.parent.mkdir(parents=True, exist_ok=True)
    cards = build()
    OUT.write_text(json.dumps(cards, ensure_ascii=False, separators=(",", ":")) + "\n")
    print(len(cards), "cards,", OUT.stat().st_size, "bytes")
    for c in cards:
        print(f"  {c['id']:10s} {len(json.dumps(c['facts'], ensure_ascii=False)):6d} chars")
