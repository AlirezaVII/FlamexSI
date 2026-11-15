"""FAKE data for exercising the engine end-to-end.

!!! Nothing produced from this data is a scientific result. !!!

It contains a few *planted* relationships so tests can check that the engine
finds real signal and ignores noise:
  - oxygen  -> burning_rate (positive)          planted
  - oxygen, pressure -> extinction (negative)   planted
  - material -> flame_length                    planted
  - temperature -> anything                     pure noise (must NOT be validated)
"""

import numpy as np
import pandas as pd

PLANTED = {
    ("oxygen", "burning_rate"),
    ("oxygen", "extinction"),
    ("pressure", "extinction"),
    ("material", "flame_length"),
}
NOISE_CONDITIONS = {"temperature"}


def generate(n_experiments: int = 200, seed: int = 0) -> pd.DataFrame:
    rng = np.random.default_rng(seed)
    n = n_experiments
    oxygen = rng.uniform(15, 40, n)
    pressure = rng.uniform(30, 110, n)
    flow = rng.uniform(0, 20, n)
    temperature = rng.uniform(285, 310, n)
    gravity = rng.choice([0.0, 0.01, 0.16, 0.38, 1.0], n)
    material = rng.choice(["SYNTH_A", "SYNTH_B", "SYNTH_C"], n)

    burning_rate = 0.05 * oxygen + 0.01 * flow + rng.normal(0, 0.25, n)
    flame_length = (
        pd.Series(material).map({"SYNTH_A": 3.0, "SYNTH_B": 5.0, "SYNTH_C": 7.0}).to_numpy()
        + rng.normal(0, 1.0, n)
    )
    logit = -0.35 * (oxygen - 25) - 0.06 * (pressure - 70)
    extinction = rng.random(n) < 1 / (1 + np.exp(-logit))
    burn_time = np.clip(60 - 1.2 * oxygen + rng.normal(0, 5, n), 1, None)

    return pd.DataFrame({
        "experiment_id": [f"SYN-{i:04d}" for i in range(n)],
        "oxygen": oxygen.round(2),
        "pressure": pressure.round(1),
        "flow_rate": flow.round(2),
        "temperature": temperature.round(1),
        "gravity": gravity,
        "material": material,
        "flame_length": flame_length.round(2),
        "burning_rate": burning_rate.round(3),
        "burn_time": burn_time.round(1),
        "extinction": extinction,
    })
