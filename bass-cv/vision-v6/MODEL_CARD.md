# Falmex Vision v6 — Model Card

## Status at a glance

- **Model:** LightGBM pixel classifier with 74 static, color, spatial, multiscale, low-light, and temporal features.
- **Selected candidate:** `frame_dim_balanced__small_core_bounded_hysteresis_r4__camera_information_guard_v2`.
- **Target:** visibly luminous flame regions in NASA BASS-II video frames.
- **Model SHA-256:** `00a0609dd119f7c14db31453587efe1b8d18353c70dd908c211494a90b88566f`.
- **Development:** modest Macro IoU gains and fewer detection failures than the frozen-v5 retrospective reference, but no candidate met all preregistered constraints. Fallback ranking was used.
- **Reserved confirmation:** **failed**. On identical B14/B17/B18 frames and source-only reference annotations, v6 has zero TP pixels and zero positive-frame Macro IoU and Micro IoU. V4 and v5 also score zero; v3 retains limited overlap.
- **Independent-expert annotation:** not completed.
- **Operational readiness:** not established and explicitly `false`.

## Intended use and non-uses

Intended use is research-only segmentation of visibly luminous regions in BASS-II-like video, with video-grouped evaluation and explicit error inspection. The mask is not a chemical flame boundary, temperature field, reaction zone, extinction-time label, suppression-effectiveness measure, or operational fire-safety decision output.

The model must not be used for spacecraft operations, suppression control, safety certification, Lunar/Mars-gravity prediction, or claims of expert-validated performance. The v6 confirmation result demonstrates that development improvement alone is insufficient for deployment or generalization claims.

## Data and provenance

- Investigation: Burning and Suppression of Solids - II (BASS-II).
- Accession: PSI-25.
- DOI: `10.60555/4qc4-de67`.
- Recorded source license: CC0-1.0.
- Development videos: B1–B13, B15, and B16. B13/B15/B16 were promoted from v5 confirmation because their results informed v6.
- Reserved v6 confirmation tests: B14, B17, and B18, selected from metadata before frame inspection.
- Development annotations: 132 frames, 96 positive and 36 negative; 60 positive frames satisfy the development small-or-dim rule.
- Confirmation annotations: 24 identical frames per model, five positive and 19 negative; coarse AI-assistant source-only polygons, not independent-expert gold masks.
- Confirmation fractions fixed from metadata: `[0, .12, .25, .38, .50, .62, .75, .88]`.

B17's source filename contains `TESTB15`, while its PSI-25 subcategory identifies B17. The exact filename is retained as the provenance key and B17 as the project test identifier.

### Source-integrity amendment before selection freeze

The original B14 and B18 files failed container validation and were not used. The original B14 had an incomplete `mdat` declaration and no `moov` atom. Two complete acquisitions of original B18 reproduced the same invalid byte stream without usable `ftyp`/`mdat` structure. These files were preserved under `metadata/rejected-downloads/`.

Before selection freeze and final training, second-view files from the same PSI-25 B14 and B18 subcategories were substituted through `metadata/vision-v6-source-integrity-amendment.json`. The original preregistered protocol and its hash were not changed. No confirmation pixels or model outputs were inspected when making these substitutions.

Valid confirmation sources:

| Test | Source view | Bytes | SHA-256 |
|---|---|---:|---|
| B14 | `TESTB14_2ND_VIEW.mp4` | 10,228,951 | `540c29ec254f4de4b9f87f72ff931d01ca33c1905eb4b64e360f36d1e4d3eb81` |
| B17 | original `TESTB15.mp4` filename | 21,089,860 | `fad4ad4e81f941193331ebc7c60963a9d90b35bba8145881efc8bad2c2bfc277` |
| B18 | `TESTB18_2ND_VIEW.mp4` | 22,103,478 | `53cc9ad8813fc613e70fc71f6393108222ee7d3c4970725a1e6e58ee6976f347` |

The second-view B14/B18 videos show the experiment on a monitor and differ substantially from the direct experiment views used for training. This is a real domain shift and a limitation of the present evaluation; it is not repaired by changing the model after seeing confirmation results.

## Training and development selection

The final classifier was trained on 1,379,050 sampled pixel rows from all 132 development frames. Model selection used leave-one-video-out predictions over 15 development videos, not confirmation frames.

Twenty-four candidates were compared: two model weightings, four inference variants, and three guard choices. The original 25-pixel camera guard activated on zero of 132 development frames. A 15-pixel `camera_information_guard_v2` was added before any fold as a disclosed development refinement. It activates only on `B16_003563.png` in development; it is not represented as preregistered or confirmation-derived.

Selection prioritized small-or-dim positive-frame Macro IoU, then overall positive Macro IoU and lower pooled FP. Eligibility required at most two positive detection failures and FP/negative-FP no greater than 1.25 times the frozen-v5 development reference. **No candidate was eligible.** The selected candidate therefore comes from the disclosed fallback ranking, not a passed protocol gate.

### Development metrics — model-selection estimates only

| Metric | Frozen-v5 retrospective reference | Selected v6 |
|---|---:|---:|
| Positive Macro IoU | 0.471908 | 0.483806 |
| Positive Macro Dice | 0.611142 | 0.625913 |
| Small-or-dim Macro IoU | 0.405633 | 0.413458 |
| Small-or-dim Micro IoU | 0.476920 | 0.475500 |
| Micro IoU | 0.503777 | 0.524465 |
| Micro precision | 0.571270 | 0.585300 |
| Micro recall | 0.810033 | 0.834599 |
| TP pixels | 549,998 | 566,678 |
| FP pixels | 412,766 | 401,506 |
| FN pixels | 128,984 | 112,304 |
| Positive detection failures | 4 | 2 |
| Negative-frame FP pixels | 12,533 | 21,317 |

Development Macro IoU increased by 0.011899 overall and 0.007825 on small-or-dim positives. Total FP decreased, but negative-frame FP exceeded the allowed ceiling of 15,666.25 pixels. Small-or-dim Micro IoU slightly declined. B4 and B10 account for most selected-v6 negative-frame FP; the known B16 camera-menu FP fell from 7,106 to zero. B4/B5/B7/B9/B10/B12 regressed in pooled per-video comparisons. These are development estimates, not external validation.

## Frozen same-video confirmation on B14/B17/B18

All 96 predictions—24 each for v3/v4/v5/v6—were generated and SHA-256 frozen before confirmation annotation or metric computation. The annotation used source images and gamma/CLAHE visibility aids only. Prediction masks, prediction areas, overlays, and scores were not viewed during annotation. No model, threshold, guard, polygon, or reference mask was changed after metrics were inspected.

Inference freeze SHA-256: `a58e99d7f5547aba45f1b1b75e3cab39cb925444469b814ab897dc33820e861c`.

| Model | Positive Macro IoU | Positive Macro Dice | Micro IoU | Micro precision | Micro recall | TP | FP | FN | Detection failures |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| v3 | 0.098404 | 0.167664 | 0.037212 | 0.038654 | 0.499241 | 4,602 | 114,453 | 4,616 | 2 |
| v4 | 0.000000 | 0.000000 | 0.000000 | 0.000000 | 0.000000 | 0 | 86,565 | 9,218 | 2 |
| v5 | 0.000000 | 0.000000 | 0.000000 | 0.000000 | 0.000000 | 0 | 82,653 | 9,218 | 2 |
| v6 | 0.000000 | 0.000000 | 0.000000 | 0.000000 | 0.000000 | 0 | 60,537 | 9,218 | 1 |

Per-video positive Macro IoU:

| Model | B14 | B17 | B18 |
|---|---:|---:|---:|
| v3 | 0.111541 | 0.000000 | 0.157396 |
| v4 | 0.000000 | 0.000000 | 0.000000 |
| v5 | 0.000000 | 0.000000 | 0.000000 |
| v6 | 0.000000 | 0.000000 | 0.000000 |

V6-minus-v3 differences are −0.098404 Macro IoU, −0.037212 Micro IoU, −0.499241 Micro recall, and −53,916 FP pixels. V6 has 26,028 fewer FP pixels than v4 and 22,116 fewer than v5, but all three have zero overlap with the positive references. Lower FP therefore does not make v6 a successful segmenter.

Only one v6 positive frame is empty: `B14_000000.png`. The other four positive frames have nonempty predictions in nonoverlapping locations. The single-detection-failure count must not be misrepresented as successful flame detection.

### Negative-frame behavior

| Model | Negative frames with FP / 19 | Negative-frame FP pixels |
|---|---:|---:|
| v3 | 12 | 89,931 |
| v4 | 11 | 79,166 |
| v5 | 15 | 73,566 |
| v6 | 18 | 55,832 |

V6 produces fewer negative-FP pixels in total but spreads FP across 18 of 19 negative frames. On the later B14 camera-information screens, v6 marks text and graphics as flame. The development-derived camera guard does not generalize to this new presentation.

All five positive confirmation frames satisfy the exploratory small-or-dim rule. This subset is too small and imbalanced for a reliable dim-flame ranking. Confidence intervals are not reported with three video clusters and five positive frames.

## Principal failure modes

1. **Confirmation localization failure:** v6 has zero TP on all five positive references. Some predictions are nonempty but spatially wrong.
2. **Out-of-domain monitor/camera graphics:** text, monitor overlays, and red equipment can be marked as luminous flame. The v2 guard does not reject the new B14 camera-information screens.
3. **Source-view domain shift:** B14/B18 second views are monitor-recorded presentations unlike the development direct views.
4. **Class imbalance:** 19 of 24 confirmation frames are negative; pooled Macro IoU averages only five positive frames.
5. **Coarse reference masks:** visible boundaries are AI-assistant annotations, not expert-adjudicated gold masks.
6. **Correlated frames:** frames within a video are not independent; video remains the independence unit.
7. **Development–confirmation divergence:** modest development gains did not generalize. This is the central scientific result of v6.

## Independent review

Two user-supplied reviewer archives have been processed in `independent-review-results-v6/`; identity, expertise, and independence are not technically verified. Reviewer A marks seven frames positive and reviewer B marks all 24 positive. There are 17 visibility disagreements, zero both-empty frames, positive-union Macro IoU 0.110778, Micro IoU 0.257337, and four frames with an uncertainty flag. Dual-reference reporting is complete. The separate A and B masks are retained; no third pixel reference was produced.

The original frozen metrics and coarse source-only reference are unchanged. No automatic consensus or adjudicated model evaluation has been created. The third-adjudicator bundle contains source images, blank templates, and A/B disagreement overlays but no model predictions, identities, or scores. Agreement measures neither correctness nor operational readiness; independent-expert validation remains unestablished.

## Reproducibility and integrity

Models, code, source frames, predictions, annotations, and metrics are SHA-256 manifest-backed. `scripts/verify_delivery_v6.py` checks split integrity, source amendments, all development and confirmation hashes, 15 folds and 24 candidates, 96 frozen predictions, annotation chronology, blank reviewer templates, and pixel-identical repeated v6 inference on all 24 confirmation frames.

Any future model that uses B14/B17/B18 results must promote them to development and reserve genuinely new videos for confirmation. Reusing these tests as untouched confirmation would be invalid. No v7 tuning was performed after the v6 confirmation result.

## Separate human-reference sensitivity analysis

On the same 24 frozen frames, v6 pooled IoU is 0.027095 with reviewer A and 0.033654 with reviewer B. Their masks yield 1,873 and 3,272 true-positive pixels respectively. The initial AI-assisted reference yields zero. A marked seven frames positive and B marked 24. These comparisons use separate references. Dual-reference reporting is complete. The separate A and B masks are retained; no third pixel reference was produced. Frame-level counts are in `independent-review-results-v6/reference-comparison.csv`. Run `python scripts/export_reference_comparison.py` from the integrated repository's bass-cv directory to rebuild this CSV and the dashboard assets.


## Dual-reference decision

The team adopted separate A and B scores for this release. B covers more pixels in all 24 frames. Six frames contain A-only pixels. In the reviewed example, the shared region covers the brighter emission and B extends into the halo and isolated luminous spots. Their physical origin is unresolved. No third pixel mask was drawn.
