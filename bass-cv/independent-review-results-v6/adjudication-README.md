# Third-adjudicator bundle — v6

Status: **24 frames require adjudication**. No model predictions, model names,
scores, or rankings are included here.

1. Review every JSON/PNG pair in `adjudication-templates/`.
2. Target only visibly luminous flame regions; do not infer chemical or thermal boundaries.
3. Use one or more polygons labelled `flame` for visible flame.
4. For a negative frame, leave `shapes` empty and set `flags.no_visible_flame` to `true`.
5. Set `flags.uncertain_boundary` when the visible boundary remains ambiguous.
6. The disagreement overlays compare reviewer A (blue) and reviewer B (red); green is
   their overlap. They contain no model output. The source image remains authoritative.
7. Do not change any original reviewer submission or the frozen v6 predictions.

The completed adjudicator folder should be returned unchanged in structure. Consensus
frames outside this queue must not be edited. Human review does not by itself establish
expert correctness or operational readiness.
