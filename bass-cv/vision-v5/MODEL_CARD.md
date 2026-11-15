# Falmex Vision v5 — Model Card

## Status at a glance

- **Model:** LightGBM pixel classifier, 58 static/spatial/color/temporal/multiscale features.
- **Selected inference:** `unweighted__small_core_bounded_hysteresis_r4`.
- **Target:** visibly luminous flame regions in NASA BASS-II video frames.
- **Model SHA-256:** `f6540a9ac51e133b719956cc6d493271ca43b85572ad9873bf22a0549d1e3c49`.
- **Development result:** improved small-or-dim Macro IoU and eliminated the single development detection failure relative to the retrospective frozen-v4 reference, with higher FP and lower precision.
- **Reserved same-video confirmation:** v5 and v4 have essentially identical pooled Macro IoU; v5 has higher Micro IoU and recall but more FP. The dim-flame improvement did **not** generalize to B16.
- **Independent-expert annotation:** not completed.
- **Operational readiness:** not established.

## Intended use and non-uses

Intended use is research-only segmentation of visibly luminous regions in BASS-II-like video, with error inspection and video-grouped evaluation. The mask is not a chemical flame boundary, temperature field, reaction zone, extinction-time label, suppression-effectiveness measure, or operational fire-safety decision output.

The model must not be used for spacecraft operations, suppression control, safety certification, Lunar/Mars-gravity prediction, or claims of expert-validated performance.

## Data and provenance

- Investigation: Burning and Suppression of Solids - II (BASS-II).
- Accession: PSI-25.
- DOI: `10.60555/4qc4-de67`.
- Recorded source license: CC0-1.0.
- Development videos: B1–B12; B9/B10/B11 were promoted from earlier confirmation after their results informed v5.
- New reserved confirmation videos: B13/B15/B16.
- Development annotations: 108 frames, 78 positive and 30 negative; 49 positive frames satisfy the development small-or-dim rule.
- Confirmation annotations: 24 identical frames per model, 18 positive and 6 negative; coarse AI-assistant source-only polygons, not independent-expert gold masks.
- Confirmation fractions were fixed from metadata before frame inspection: `[0, .12, .25, .38, .50, .62, .75, .88]`.

## Training and selection

The final classifier was trained on 1,120,204 sampled pixel rows. Model selection used leave-one-video-out development predictions, not confirmation frames. Twenty-four candidates were compared: six initial candidates, eight post-initial-fold distance-bounded refinements, and ten post-full-ranking small-core refinements.

The selection rule was highest small-or-dim positive-frame Macro IoU, overall positive-frame Macro IoU as tie breaker, no more than one positive detection failure, and pooled FP no greater than 1.25 times the frozen-v4 retrospective reference. Five candidates were eligible; no fallback was used.

The selected small-core rule is development-derived and is **not** represented as preregistered:

1. Compute the standard and core-hysteresis masks from the same frozen classifier.
2. If the standard prediction has fewer than 3,000 pixels, add hysteresis pixels only within four pixels of the standard core; use hysteresis as fallback if the standard mask is empty.
3. Otherwise retain the standard mask unchanged.

This gate uses prediction area only, never ground truth.

## Development metrics — model-selection estimates

| Metric | Frozen v4 retrospective reference | Selected v5 |
|---|---:|---:|
| Positive Macro IoU | 0.471840 | 0.484817 |
| Positive Macro Dice | 0.609179 | 0.627924 |
| Small-or-dim Macro IoU | 0.409978 | 0.428762 |
| Micro IoU | 0.507301 | 0.501143 |
| Micro precision | 0.594520 | 0.558452 |
| Micro recall | 0.775683 | 0.830031 |
| FP pixels | 290,435 | 360,286 |
| Positive detection failures | 1 | 0 |
| Negative-frame FP pixels | 265 | 5,427 |

B11 development Macro IoU increased from 0.364526 to 0.466592 and recall from 0.542803 to 0.702415, while FP increased from 2,678 to 10,548. The late B11 improvement was not uniform: frame 2831 regressed, and frame 3100 remained weak despite becoming nonempty. B3 also regressed. These are not external-validation results.

## Frozen same-video confirmation on B13/B15/B16

All predictions were generated before confirmation annotation and then hash-frozen. No model, threshold, radius, or gate changed after confirmation inspection.

| Model | Positive Macro IoU | Positive Macro Dice | Micro IoU | Micro precision | Micro recall | FP pixels | Detection failures |
|---|---:|---:|---:|---:|---:|---:|---:|
| v3 | 0.370799 | 0.493084 | 0.441462 | 0.513011 | 0.759922 | 93,775 | 4 |
| v4 | 0.415881 | 0.531493 | 0.497614 | 0.672266 | 0.656994 | 41,636 | 4 |
| v5 | 0.415968 | 0.538421 | 0.516904 | 0.642512 | 0.725582 | 52,480 | 4 |

Per-video positive Macro IoU:

| Model | B13 | B15 | B16 |
|---|---:|---:|---:|
| v3 | 0.481837 | 0.438926 | 0.142176 |
| v4 | 0.451707 | 0.568527 | 0.159184 |
| v5 | 0.527219 | 0.531992 | 0.120033 |

The paired v5-minus-v4 pooled Macro IoU difference is only +0.000087. Recall increased by 0.068587 and FP by 10,844 pixels. B13 improved, B15 declined, and B16 declined. With three video clusters, confidence intervals are not reported.

On the exploratory 11-frame small-or-dim confirmation subset, v3/v4/v5 Macro IoU values are 0.312261/0.302418/0.302604 and Micro IoU values are 0.380621/0.308667/0.388292. This subset does not establish a dim-flame winner.

## Known failure modes

1. **Severe B16 undersegmentation:** each model has four positive detection failures. V5 detects the early bright B16 flame but returns empty masks on the four later annotated positive frames.
2. **Out-of-domain camera screen:** B16 frame 3563 shows a camera information screen. V5 produces 7,106 FP pixels there. The pipeline lacks experiment-versus-camera-menu domain rejection.
3. **Trade-off:** recall recovery can add background/reflection FP and reduce precision.
4. **Coarse reference masks:** dim boundaries are uncertain and not expert-adjudicated.
5. **Correlated frames:** frames within a video are not independent; video-level grouping is required.
6. **Small confirmation sample:** three videos and six negative frames cannot estimate broad operational performance or a general false-positive rate.

## Independent review

`independent-review-confirmation/` and `independent-review-pilot/` contain source images and blank LabelMe templates only. They are awaiting two actual independent reviewers and a third adjudicator. Agreement metrics, when real reviewer masks are supplied, will measure agreement rather than correctness or operational readiness.

## Reproducibility and integrity

Models, source frames, predictions, annotations, and inference code are SHA-256 manifest-backed. `scripts/verify_delivery_v5.py --reproduce` checks hashes, excluded confirmation groups, metric recomputation, blinded-template status, secret patterns, and pixel-identical repeated inference for all three model generations.

Any future tuning after viewing B13/B15/B16 must promote them to development and reserve genuinely new videos for confirmation. Reusing them as untouched confirmation would be invalid.
