# Falmex v6 — Real reviewer agreement addendum

**Historical handoff.** The subsequent [dual-reference decision](../../docs/DUAL_REFERENCE_FA.md) completes reporting against A and B.

## Status

Two user-supplied reviewer archives were received and processed. Both contained 24 LabelMe JSON files and 24 matching source PNG files. All supplied source images matched the frozen source hashes. The original uploads and annotation content were not modified.

Reviewer identity, expertise, and independence cannot be established by the processing software. This addendum therefore reports agreement between two supplied annotation sets, not independent-expert validation or gold truth.

## Agreement results

| Measure | Result |
|---|---:|
| Frames per reviewer | 24 |
| Frames with positive area — reviewer A | 7 |
| Frames with positive area — reviewer B | 24 |
| Positive/negative visibility disagreements | 17 |
| Both-empty frames | 0 |
| Positive-union frames | 24 |
| Macro IoU over positive-union frames | 0.110778 |
| Macro Dice over positive-union frames | 0.155591 |
| Micro IoU | 0.257337 |
| Micro Dice | 0.409337 |
| Macro boundary F1, two-pixel tolerance | 0.114511 |
| Frames with an uncertainty flag from either reviewer | 4 |
| Frames requiring third adjudication | 24 |

Reviewer B marks small positive regions in 17 frames that reviewer A marks as negative. The seven frames positive in both sets also have unequal masks. Visual inspection of the generated A/B overlays found no evidence of coordinate displacement or rasterization misalignment; the disagreement is present in the annotations themselves.

## Adjudication

All 24 frames are queued because each has a mask difference, visibility disagreement, or uncertainty flag. The third-adjudicator package contains source images, blank LabelMe templates, A/B disagreement overlays, and the queue. It contains no model predictions, model identities, or model scores.

No automatic union, intersection, or reviewer preference has been used to manufacture a consensus. The frozen v6 metrics and the original coarse source-only reference remain unchanged. No adjudicated model evaluation is claimed yet.

## Interpretation limits

- Agreement does not establish correctness.
- A third adjudicator is required before a human-reviewed reference can be frozen.
- Expert status must come from actual reviewer qualifications, not file metadata or assistant inference.
- Operational readiness remains `false`.
- V6's original reserved-confirmation result remains zero TP; the review does not retroactively change it.
