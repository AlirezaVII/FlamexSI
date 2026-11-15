# Falmex BASS-II computer vision — lightweight GitHub bundle

Research code and evidence for segmentation of **visibly luminous flame regions** in real BASS-II video frames (PSI-25; DOI `10.60555/4qc4-de67`; recorded source license CC0-1.0). This is not an operational fire-detection or suppression system.

## Honest current result

- Selected model: v6 LightGBM pixel classifier, 74 features.
- Development: 15 videos, 132 frames; video-grouped leave-one-video-out selection.
- Reserved confirmation: B14/B17/B18, 24 frames total.
- The final model and all 96 v3/v4/v5/v6 prediction masks were frozen before source-only coarse annotation and metric inspection.
- Original coarse-reference v6 confirmation: Macro IoU 0, Micro IoU 0, TP 0, FP 60,537, FN 9,218.
- Two supplied reviewer sets have 17 visibility disagreements; positive-union Macro IoU 0.110778 and Micro IoU 0.257337.
- Dual-reference reporting is complete. The separate A and B masks are retained; no third pixel reference was produced. No reviewer set is automatically treated as gold truth.
- Reviewer/adjudicator identity, expertise, and independence cannot be inferred from files. Independent-expert validation and operational readiness remain unestablished.

The mask is not a chemical or thermal boundary, reaction zone, extinction label, suppression measure, or operational safety output.

## What is included

- Training, inference, evaluation, review-processing, packaging, and verification scripts.
- Compact v4/v5/v6 models and their freeze records; the large historical v3 model is external.
- v6 development comparison, selected per-frame results, model card, and protocol/source amendments.
- Confirmation selection/freeze records, coarse annotations and masks, 24 source frames, and all 96 frozen prediction masks.
- Original per-frame confirmation metrics and comparison plot.
- Two-reviewer agreement summaries, A/B masks, provenance, adjudication queue, and contact sheet.

## What is deliberately excluded

Raw videos, development frame/cache collections, training folds and fold predictions, large v2/v3 models, generated error-overlay collections, disagreement-overlay collections, rejected downloads, temporary range files, network logs, and original reviewer upload archives. These remain in the complete evidence package where applicable.

Consequently, this repository bundle supports code review, frozen-artifact verification, metric inspection, review processing with suitable inputs, and post-adjudication rescoring. **It does not by itself reproduce full training or raw-video inference.** The full evidence verifier likewise requires the complete evidence archive, not this lightweight tree.

## Setup and lightweight verification

Python 3.12 is recommended.

```bash
python3 -m pip install -r requirements.txt
python3 scripts/verify_lightweight_v6.py
```

The verifier checks every included frozen source/prediction hash, the available v4/v5/v6 model hashes, 24 pending adjudication frames, and the unchanged zero-TP v6 result. It does not turn failed confirmation into a passing scientific result.

## Optional future single-reference adjudication

Input: one folder containing exactly the 24 completed anonymous LabelMe JSON files from the third-adjudicator package. PNG files are optional; frozen source images are supplied from `confirmation-v6/source-frames/`.

```bash
python3 scripts/finalize_adjudication_v6.py \
  --adjudicator /path/to/completed-adjudicator \
  --output adjudicated-confirmation-v6
```

The output directory must be new or empty. The tool:

1. Validates filenames, image dimensions/hashes, polygon bounds, negative flags, and completion.
2. Rasterizes a separate adjudicated reference and records input/mask hashes.
3. Verifies all 96 frozen prediction hashes.
4. Rescores v3/v4/v5/v6 on identical frames and writes pooled, per-video, and per-frame metrics.
5. Leaves the original model files, predictions, annotations, and metrics unchanged.
6. Explicitly avoids claiming adjudicator expertise, independence, or operational readiness.

Afterward, manually update the Model Card and competition form with the new results and the actual review provenance. Do not call the reference `independent expert gold truth` unless those facts are genuinely established. Any future training or tuning using B14/B17/B18 results starts a new development cycle and requires genuinely new reserved confirmation videos.

## Full retraining boundary

To rerun historical training/inference, restore the excluded raw data and cache/fold assets from the complete evidence archive into the paths recorded in the manifests, then use the original frozen scripts and hashes. Do not download substitutes silently or treat a different split as the same confirmation. The source-integrity amendment documents the B14/B18 substitutions made before the v6 freeze.

## Key files

- `vision-v6/MODEL_CARD.md` — model scope, development selection, failure, and review addendum.
- `vision-v6/model-freeze.json` — final model and training freeze.
- `confirmation-v6/inference-freeze.json` — model and all prediction hashes.
- `confirmation-v6/metrics.json` — original untouched confirmation metrics.
- `independent-review-results-v6/review-processing.json` — real two-reviewer processing status.
- `independent-review-results-v6/adjudication-queue.csv` — all 24 pending frames.


## Dual-reference decision

The team adopted separate A and B scores for this release. B covers more pixels in all 24 frames. Six frames contain A-only pixels. In the reviewed example, the shared region covers the brighter emission and B extends into the halo and isolated luminous spots. Their physical origin is unresolved. No third pixel mask was drawn.

The v6 competition draft (`submission-v6/`) and its packaging script were removed on
2026-11-13: the text was out of date. Restore with `git checkout 493ad54 -- bass-cv/submission-v6`.
