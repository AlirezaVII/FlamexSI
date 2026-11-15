# Pre-specified replication plan for the FlamexSI / NASA FLEX findings

Version: 1.0
Fixed on: 2026-11-08
Registration status: **internal, versioned and hashed plan; not registered in an external
registry.**

## 1. Origin and boundary of the plan

This plan was written after the PSI-69 review and before any inferential test on an independent
investigation. From PSI-68 only the metadata, column names and the design-matrix content were
examined to decide whether replication is possible; the file held no numerical outcome and no
association test was run on it.

Basis of the discovery findings:

- `primary_experiment_split/findings.json`
  SHA-256: `a3cc0b84c698d60f21c7adfc40052c3a52b9e6fc71499c1baa44f058579b6a21`
- `primary_test_date_split/findings.json`
  SHA-256: `9524ac2224d39c6f1907da48f4aad8df36caa62ffab7d7df48cec865fbb9dcdd`
- `standardized_flex.csv`
  SHA-256: `df837f49aaab5c52bddadaffe6b48f4c82d9bd6d400c54a950d3cd6227e82897`

## 2. Conditions for independent data

A dataset enters the replication only if it meets all of the following:

1. Its records do not duplicate the 274 PSI-69 tests; matching uses identifier, date, fuel and
   conditions, not only the test number.
2. Real numerical measurements of \(D_0\), \(D_e\), \(K\) and the ambient conditions exist. A
   design matrix, a target value or a planned outcome range does not count as an outcome.
3. \(K\) is defined as the burning-rate constant in \(\mathrm{mm^2/s}\) and \(D_e\) as the
   visible-flame extinction diameter.
4. Fuel, oxygen, pressure and space/ground origin are documented; ground and space data are
   never mixed silently.
5. The data collected for the main test are independent of the discovery data by investigation
   or operational campaign.

A missing variable for one hypothesis makes only that hypothesis `not_evaluable`; substituting a
proxy after seeing the data is not allowed.

## 3. Fixed hypotheses

### Main family; four tests

| ID | Directional hypothesis from PSI-69 | Main population |
| --- | --- | --- |
| H1 | Higher oxygen fraction goes with higher \(K\); \(\rho>0\) | All usable fuels |
| H2 | Larger \(D_0\) goes with larger \(D_e\); \(\rho>0\) | All usable fuels |
| H3A | Higher oxygen goes with smaller \(D_e\); \(\rho<0\) | Rows with \(D_e\) |
| H3B | Higher oxygen goes with smaller \(D_e/D_0\); \(\rho<0\) | Rows with \(D_0>0\) and \(D_e\) |

H3A and H3B are physically and mathematically related; even if both succeed they are not
reported as two independent discoveries.

### Secondary, fuel-limited family; two tests

| ID | Hypothesis | Population |
| --- | --- | --- |
| S1 | Larger \(D_0\) goes with larger \(D_e/D_0\); \(\rho>0\) | Heptane only |
| S2 | Larger \(D_0\) goes with longer burn time; \(\rho>0\) | Methanol only |

The overall oxygen–burn time and fuel–burn time relationships are not confirmatory in this
replication and are reported as exploratory only if data exist.

## 4. Procedure

1. The main statistic is Spearman \(\rho\) with a two-sided p-value. The direction is fixed in
   advance, but p is computed two-sided.
2. At least 20 complete rows per main test and 15 rows per fuel-limited test are required. A
   smaller sample is `not_evaluable` and no p is reported.
3. Missing values are removed pairwise; there is no imputation.
4. Benjamini–Hochberg correction is applied separately within the family of four main tests and
   the family of two secondary tests; \(\alpha=0.05\).
5. The whole independent dataset is used for testing; no new random holdout is needed, because
   the dataset itself is the replication.
6. Within-fuel analysis for H1 and H2 is a pre-specified sensitivity check. If a fuel has at
   least 15 rows, its descriptive \(\rho\) and p are reported.
7. Partial Spearman controlling fuel, pressure and \(D_0\) is a sensitivity check only and not
   the main success criterion; control variables are not changed after seeing the result.
8. No LLM takes part in selecting rows, computing statistics or deciding success.

## 5. Pre-specified decision rules

- `replicated`: the observed direction matches the planned direction and q<0.05 in its family.
- `not_replicated`: the direction is opposite or q≥0.05. This label is not proof of no effect.
- `not_evaluable`: the data or variable definitions are incompatible, or the sample is too small.
- For H1 and H2, if the overall test replicates but the direction within an evaluable fuel is
  opposite, the result is reported as `fuel_dependent` and the general insight is limited.
- If a fuel is not evaluable because of sample size, the overall result can still be replicated,
  but `partial_fuel_coverage` must be stated with it.
- Changing a hypothesis, direction, family, minimum sample or success criterion after seeing a
  p-value is a deviation, and the result is no longer confirmatory.

## 6. Uncertainty and reporting

Measurement uncertainty enters a sensitivity check if it is available per row. A typical value
from the literature does not replace real per-row uncertainty. Scenario uncertainty ranges are
not a replication decision criterion and are not reported as formal confidence intervals.

All results, including rejected, not evaluable and missingness, will be recorded in
`replication_results.csv` and in the written summary.

## 7. Status of FLEX-2 on the date the plan was fixed

The official file `PSI-68_Experimental table_Flex2.csv`, with the SHA-256 below, holds only eight
rows of a design matrix:

`cc57ad1bd9977aa13e7ac6c3aa618303012686e232b36c052c6a9f1a74e5f528`

Its columns are fuel type, initial-diameter range, gas composition, several planned oxygen and
pressure values, temperature and flow speed. There is no \(K\), \(D_e\), burn time, identifier of
a test actually run, or test date. All six hypotheses are therefore `not_evaluable` for this
file; this decision was made before any association analysis and only because outcomes are
absent.
