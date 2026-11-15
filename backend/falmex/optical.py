"""Experimental reviewer-specific optical inference in the BASS camera geometry."""

import numpy as np
from scipy.ndimage import gaussian_filter


def features(image):
    rgb = np.asarray(image, dtype=np.float32) / 255
    red, green, blue = rgb.transpose(2, 0, 1)
    peak = rgb.max(axis=2)
    channels = [red, green, blue, red - green, red - blue, peak - rgb.min(axis=2)]
    for radius in (2, 8, 24):
        for plane in (peak, red - blue):
            channels.append(plane - gaussian_filter(plane, radius))
    return np.stack(channels, axis=-1).reshape(-1, len(channels))


def predict_trees(pixels, trees, reference):
    votes = np.zeros(len(pixels))
    for tree in trees[reference + "_offsets"][:-1]:
        nodes = np.full(len(pixels), tree, dtype=np.int32)
        left, right, feature, threshold, probability = [
            trees[reference + "_" + field]
            for field in ("left", "right", "feature", "threshold", "prob")
        ]
        while True:
            rows = np.flatnonzero(left[nodes] >= 0)
            if len(rows) == 0:
                break
            idx = nodes[rows]
            nodes[rows] = np.where(
                pixels[rows, feature[idx]] <= threshold[idx], left[idx], right[idx]
            )
        votes += probability[nodes]
    return votes > (len(trees[reference + "_offsets"]) - 1) / 2
