"""Cross-fit two annotation models. Each video's pixels are scored only by models trained on other videos."""

import argparse
import gzip
import base64
import io
import json
from pathlib import Path

import numpy as np
from PIL import Image
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "backend"))
from falmex.optical import features
from sklearn.ensemble import ExtraTreesClassifier


def main(root, output, preview=None, export=None):
    review = root / "independent-review-results-v6"
    rng = np.random.default_rng(42)
    frames = []
    for path in sorted((review / "masks-A").glob("*.png")):
        name = path.name.split("_", 1)[1]
        image = root / "confirmation-v6/source-frames" / name
        labels = [
            np.asarray(Image.open(review / ("masks-" + ref) / path.name)).ravel() > 0
            for ref in "AB"
        ]
        pixels = features(Image.open(image).convert("RGB"))
        keep = np.unique(
            np.concatenate(
                [
                    np.flatnonzero(labels[0] | labels[1]),
                    rng.choice(len(pixels), 6000, replace=False),
                ]
            )
        )
        frames.append((name, image, labels, keep, pixels[keep]))
    if len(frames) != 24:
        raise ValueError("Expected 24 aligned reference pairs")
    results = []
    previews = {}
    for video in [
        *sorted({f[0].split("_")[0] for f in frames}),
        *([None] if export else []),
    ]:
        train = [f for f in frames if f[0].split("_")[0] != video]
        test = [f for f in frames if f[0].split("_")[0] == video]
        x = np.concatenate([f[4] for f in train])
        models = []
        for ref in range(2):
            y = np.concatenate([f[2][ref][f[3]] for f in train])
            # Inverse inclusion weights restore the natural pixel prevalence.
            weights = np.concatenate(
                [
                    np.where((f[2][0] | f[2][1])[f[3]], 1.0, len(f[2][0]) / 6000)
                    for f in train
                ]
            )
            model = ExtraTreesClassifier(
                n_estimators=24,
                min_samples_leaf=12,
                max_depth=16,
                random_state=42,
                n_jobs=2,
            )
            models.append(model.fit(x, y, sample_weight=weights))
        if video is None:
            from falmex.optical import predict_trees

            arrays = {}
            for ref, model in zip("AB", models):
                trees = [e.tree_ for e in model.estimators_]
                offsets = np.cumsum([0] + [t.node_count for t in trees]).astype(
                    np.int32
                )
                arrays[ref + "_offsets"] = offsets
                for key, attr in (
                    ("left", "children_left"),
                    ("right", "children_right"),
                ):
                    arrays[ref + "_" + key] = np.concatenate(
                        [
                            np.where(getattr(t, attr) < 0, -1, getattr(t, attr) + o)
                            for t, o in zip(trees, offsets)
                        ]
                    ).astype(np.int32)
                arrays[ref + "_feature"] = np.concatenate(
                    [t.feature for t in trees]
                ).astype(np.int16)
                arrays[ref + "_threshold"] = np.concatenate(
                    [t.threshold for t in trees]
                )
                arrays[ref + "_prob"] = np.concatenate(
                    [t.value[:, 0, 1] / t.value[:, 0, :].sum(axis=1) for t in trees]
                )
                sample = x[::7]
                assert np.array_equal(
                    predict_trees(sample, arrays, ref), model.predict(sample)
                )
            packed = json.dumps(
                {k: v.tolist() for k, v in arrays.items()}, separators=(",", ":")
            ).encode()
            export.write_bytes(gzip.compress(packed, mtime=0))
        for name, image, labels, _, _ in test:
            pixels = features(Image.open(image).convert("RGB"))
            predictions = []
            for ref, model in enumerate(models):
                predicted = model.predict(pixels)
                predictions.append(predicted)
                truth = labels[ref]
                results.append(
                    dict(
                        frame=name,
                        reference="AB"[ref],
                        tp=int((predicted & truth).sum()),
                        fp=int((predicted & ~truth).sum()),
                        fn=int((~predicted & truth).sum()),
                    )
                )
            if preview:
                rgb = np.array(Image.open(image).convert("RGB"))
                shape = rgb.shape[:2]
                a, b = (mask.reshape(shape) for mask in predictions)
                for mask, color in (
                    (a & ~b, [75, 185, 255]),
                    (b & ~a, [255, 107, 68]),
                    (a & b, [99, 236, 153]),
                ):
                    rgb[mask] = 0.4 * rgb[mask] + 0.6 * np.array(color)
                stream = io.BytesIO()
                Image.fromarray(rgb).resize((480, 320)).save(
                    stream, format="WEBP", quality=70
                )
                previews[name] = base64.b64encode(stream.getvalue()).decode("ascii")
    if preview:
        preview.write_text(json.dumps(previews))
    output.write_text(json.dumps(results, indent=2) + "\n")
    for ref in "AB":
        subset = [row for row in results if row["reference"] == ref]
        totals = [sum(row[k] for row in subset) for k in ("tp", "fp", "fn")]
        print(ref, totals, totals[0] / sum(totals))


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("root", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--preview", type=Path)
    parser.add_argument("--export", type=Path)
    args = parser.parse_args()
    main(args.root, args.output, args.preview, args.export)
