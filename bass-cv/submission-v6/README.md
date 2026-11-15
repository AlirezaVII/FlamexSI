# Falmex — Flame in Freefall

**Historical handoff.** The subsequent [dual-reference decision](../../docs/DUAL_REFERENCE_FA.md) completes reporting against A and B.

## SI-Powered Fire Safety Insights from Microgravity Combustion Data

**Near-final competition handoff — two reviewer sets are processed; third adjudication is pending for all 24 frames.**

Falmex combines two reproducible NASA-data work packages:

1. **FLEX / PSI-69:** standardized ingestion of 274 real experiments, targeted statistical discovery, date-separated sensitivity analysis, uncertainty analysis, compositional analysis, and scientific-review artifacts.
2. **BASS-II / PSI-25:** supervised pixel segmentation of visibly luminous flame regions with video-grouped development, frozen inference on reserved videos, identical-frame v3/v4/v5/v6 comparisons, and explicit failure analysis.

This is a research project, not an operational fire-safety or suppression-control system.

## Headline results

### FLEX statistical route

- 274 source rows were ingested without altering the original source file.
- The primary analysis produced 44 targeted outcomes: 12 engine-labelled `validated`, 3 `candidate`, 2 `rejected`, and 27 `not_significant`.
- Seven rank correlations and one fuel-group difference replicated across the primary and test-date split procedures.
- The strongest reported association was oxygen fraction versus droplet burning-rate constant \(K\): Spearman \(\rho=0.577\) in primary discovery, \(0.571\) in its holdout, and \(0.521\) / \(0.703\) in the date-split discovery / holdout.
- `Validated` is an internal statistical-engine status. These are observational associations, not causal findings, external replication, operational instructions, or independent-expert endorsement.

### BASS-II computer-vision route

The selected v6 LightGBM model uses 74 pixel features. Development Positive Macro IoU increased modestly from the frozen-v5 retrospective reference of 0.471908 to 0.483806. No candidate met all development constraints, so the documented fallback ranking was used.

The reserved B14/B17/B18 confirmation failed:

| Model | Positive Macro IoU | Micro IoU | TP pixels | FP pixels | FN pixels |
|---|---:|---:|---:|---:|---:|
| v3 | 0.098404 | 0.037212 | 4,602 | 114,453 | 4,616 |
| v4 | 0 | 0 | 0 | 86,565 | 9,218 |
| v5 | 0 | 0 | 0 | 82,653 | 9,218 |
| v6 | 0 | 0 | 0 | 60,537 | 9,218 |

V6 therefore must not be described as a successful or operationally ready segmenter. Lower FP than v4/v5 does not compensate for zero TP. Source-view domain shift, camera-information graphics, low-light noise, and the small five-positive/19-negative reference set are central limitations.

## What is complete

- Real FLEX and BASS-II source provenance and source hashes.
- Frozen v6 split, model, selection chronology, and all 96 four-model predictions.
- Source-only coarse confirmation annotation completed before metrics were inspected.
- Identical-frame metrics, paired comparisons, and error overlays.
- A 55-check delivery verifier, including pixel-identical repeated v6 inference on all 24 confirmation frames.
- A blinded two-reviewer bundle with 48 blank LabelMe templates and no predictions or scores.
- Two real user-supplied reviewer sets processed with source-hash validation: seven positive frames in A, 24 in B, 17 visibility disagreements, positive-union Macro IoU 0.110778, and Micro IoU 0.257337.
- A model-blinded third-adjudicator package for all 24 frames.

## What remains open

- Actual third-party adjudication of all 24 frames before any human-reviewed reference freeze.
- Reviewer identity, expertise, and independence are not inferred by software.
- Independent-expert validation and operational readiness remain unestablished.
- Team/portal metadata, public demo links, and any competition-specific fields must be supplied by the team.

The pending review can validate or challenge the coarse reference annotation. It cannot retroactively make v6's zero-TP confirmation result successful.

## Evidence packages

- `Falmex-Vision-v6-کامل.zip` — complete self-contained v6 evidence and reproduction archive.
  - SHA-256: `cd957358eee42f5c0023c9b10114c65737ac2bb26a36b9127e48cdfbcb56bce3`
- `Falmex-بازبینی-مستقل-v6.zip` — source-only blinded reviewer bundle.
  - SHA-256: `df2757c9ce8b4cf715fa468a35a588f5eed54d35633a74e0e4457c4762ad7a72`
- `Falmex-داور-سوم-v6.zip` — model-blinded third-adjudicator bundle for all 24 frames.
  - SHA-256: `12eaad39ea6b8984cadf70aa62bff46057c5ddc045530b49e48e590fe68c6aab`
- `Falmex-FLEX-گزارش.md` — full FLEX scientific and technical report.
- `vision-v6/MODEL_CARD.md` and `vision-v6/گزارش-فارسی.md` — complete v6 model documentation.

## Reproduce the v6 integrity checks

Extract the complete v6 archive, then run from its root:

```bash
python3 -m pip install -r requirements.txt
python3 scripts/verify_delivery_v6.py
```

Expected result: 55 checks passed and zero failed. This verifies integrity and reproducibility; it does not turn the model's confirmation failure into a passing scientific result.

## Process reviewer submissions when they arrive

Keep the two completed reviewer folders separate. From the full project root:

```bash
python3 scripts/process_independent_review_v6.py \
  --reviewer-a /path/to/completed-reviewer-A \
  --reviewer-b /path/to/completed-reviewer-B \
  --output independent-review-results-v6
```

The command requires all 24 JSON files per reviewer. Reviewers may return JSON files only; frozen source images are then used automatically. Any supplied PNG is checked against the source hash. The workflow validates image dimensions, rejects incomplete blank templates, rasterizes polygons, and writes:

- `agreement/agreement-summary.json` and per-frame IoU, Dice, and boundary F1;
- `agreement/disagreement-overlays/` with A/B-only disagreement colors;
- `adjudication-queue.csv`;
- blank source-only `adjudication-templates/` for every disagreement or uncertain frame;
- `review-processing.json` with input hashes and explicit limitations.

Agreement is not correctness. Neither reviewer is automatically treated as gold truth.

## Permitted interpretation

Falmex demonstrates reproducible scientific data processing, statistical discovery, supervised AI experimentation, leakage-resistant evaluation design, and transparent reporting of both positive and negative results. It does not establish a chemical flame boundary, temperature or reaction zone, extinction time, suppression effectiveness, Lunar/Mars-gravity prediction, spacecraft certification, or operational fire-response guidance.
