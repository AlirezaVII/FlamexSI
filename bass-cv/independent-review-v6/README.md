# Independent human annotation — source-only bundle

## Status

This bundle is **awaiting actual independent human reviewers**. AI-generated masks and model outputs are deliberately absent. Completion of this package by the AI assistant must never be recorded as independent-expert validation.

## Reviewer protocol

1. Assign reviewer A and reviewer B independently. Neither reviewer should see the other person's masks, the AI masks, model predictions, model names, or scores.
2. Annotate every image in your assigned `reviewer-A/` or `reviewer-B/` folder with LabelMe or compatible polygon software.
3. Target: **visibly luminous flame regions** in the supplied image. Use one or more polygons per image.
4. Exclude telemetry, ignition hardware, isolated sparks, dark gaps, and background reflections where distinguishable.
5. If there is no visible luminous flame, leave `shapes` empty and set `flags.no_visible_flame` to `true`.
6. If the visible boundary is uncertain, annotate your best visible estimate and set `flags.uncertain_boundary` to `true`. Do not infer a chemical or thermal boundary.
7. Do not adjust display enhancement identically for every decision; inspect the original and, if needed, brightness-enhanced views. Record any frame that remains ambiguous.
8. Convert the completed LabelMe JSON files to binary masks with `python scripts/labelme_to_masks.py --reviewer <completed-reviewer-folder> --output <mask-directory>`. The converter requires an explicit `no_visible_flame` flag for empty frames and records uncertainty flags.
9. A third qualified adjudicator should resolve disagreements while remaining blinded to model identity and scores.

## راهنمای کوتاه فارسی

هدف فقط «ناحیهٔ شعلهٔ مرئی و دارای درخشش» است، نه مرز شیمیایی یا دمایی. دو داور مستقل و بدون دیدن mask دیگری یا خروجی مدل، چندضلعی‌ها را ثبت کنند. فریم بدون شعله باید mask کاملاً صفر داشته باشد. مرز مبهم را با flag مشخص کنید و حدس علمی دربارهٔ ناحیهٔ واکنش یا خاموشی ثبت نکنید. اختلاف‌ها توسط داور سوم و بدون دانستن نام و نتیجهٔ مدل‌ها حل شود.

## Agreement analysis

From the project root:

```bash
python scripts/compare_annotations.py   --selection <selection.json>   --a <reviewer-A-mask-directory>   --b <reviewer-B-mask-directory>   --output <agreement-output-directory>
```

The comparison reports IoU, Dice, two-pixel boundary F1, visibility disagreements, and disagreement overlays. These measure agreement, not correctness or operational readiness.
