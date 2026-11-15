"""NASA SAME / SAME-R smoke tests -> one clean table, one row per flight test.

Source: PSI-101 (SAME-R), file "Combined SAMER Results 06 02 14.xlsx", sheet "Reduced Data with
ISS Det", the investigators' reduced results for the SAME (2007) and SAME-R (2010) flights
on the ISS. Only renaming and unit labelling is done here: a value of 0 in the particle
columns means "not measured" in that sheet (DBP calibration runs) and becomes empty.
Output: backend/falmex/datasets/PSI-101_SAME_smoke_tests.csv
Usage: python backend/scripts/build_same_table.py <path to the xlsx>
"""

import sys
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parents[2]
OUT = ROOT / "backend/falmex/datasets/PSI-101_SAME_smoke_tests.csv"
SHEET = "Reduced Data with ISS Det"
COLUMNS = {  # sheet column index -> clean name
    0: "flight", 1: "material", 2: "test_id", 3: "description",
    4: "inlet_velocity_cm_s", 5: "heater_resistance_ratio", 6: "aging_time_s",
    7: "iss_detector_scatter_v", 10: "number_moment_m0", 11: "mass_moment_m1",
    16: "count_mean_diameter_um", 17: "average_mass_diameter_um",
    19: "geometric_std_sigma_g", 20: "geometric_mean_diameter_um",
    22: "sample_temperature_c", 23: "mass_loss_mg",
}
PARTICLE = ["number_moment_m0", "mass_moment_m1", "count_mean_diameter_um",
            "average_mass_diameter_um", "geometric_std_sigma_g", "geometric_mean_diameter_um"]


def build(xlsx: Path) -> pd.DataFrame:
    raw = pd.read_excel(xlsx, sheet_name=SHEET, header=None).iloc[2:]
    df = raw[list(COLUMNS)].rename(columns=COLUMNS)
    df = df[df["material"].notna() & df["flight"].isin([1, 2])].copy()
    df["flight"] = df["flight"].map({1: "SAME (2007)", 2: "SAME-R (2010)"})
    df["test_id"] = df["test_id"].astype(str).str.strip()
    df["material"] = df["material"].astype(str).str.strip()
    df["description"] = df["description"].astype(str).str.strip()
    for c in df.columns[4:]:
        df[c] = pd.to_numeric(df[c], errors="coerce")  # '??' in the sheet -> empty
    df[PARTICLE] = df[PARTICLE].replace(0, np.nan)
    df.insert(0, "experiment_id", df["flight"].str.split(" ").str[0] + "-" + df["test_id"])
    df["calibration_aerosol"] = df["material"].eq("DBP")  # dibutyl phthalate, not a fire fuel
    return df.reset_index(drop=True)


if __name__ == "__main__":
    out = build(Path(sys.argv[1]))
    out.to_csv(OUT, index=False)
    print(len(out), "tests", out["flight"].value_counts().to_dict())
    print(out.groupby("material")["count_mean_diameter_um"].describe()[["count", "50%"]])
