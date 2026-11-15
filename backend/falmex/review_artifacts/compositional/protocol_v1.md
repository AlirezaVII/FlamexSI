# Internal protocol for the compositional gas analysis of FLEX — version 1.0

Lock date: 2026-11-08
Status: internal protocol written before any inferential model was fitted; not an external
preregistration.

## 1. Question and claim boundary

The aim is to describe how the three-part gas composition relates to the mean burning rate and
to the extinction diameter ratio, controlling for observed variables. The aim is not to prove an
independent causal effect of He or CO₂, to compare He with CO₂ directly, or to predict
lunar-g or Mars-g behaviour.

Tether/free-float, translation, deployment details and some protocol aspects are not in the
structured PSI-69 table. "Full protocol control" and causal adjustment for all confounders are
therefore not claimed.

## 2. Subsets and structural zeros

- **CO₂:** rows with He = 0 and CO₂ > 0.
- **He:** rows with CO₂ = 0 and He > 0.
- **N₂-only:** rows with He = CO₂ = 0; descriptive only, outside the main log-ratio analysis.
- No row in the current data has He and CO₂ both positive.
- No pseudocount, zero imputation or global four-part ILR is used in the main analysis.
- The CO₂ and He subsets are fitted separately; the difference between their coefficients is
  not a direct test of He versus CO₂.

## 3. Closure and balances

For each subset the three parts \(O_2, N_2, X\), with \(X\in\{CO_2,He\}\), are closed within the
same row:

\[
c_j=\frac{x_j}{x_{O_2}+x_{N_2}+x_X}.
\]

PSI-69 oxygen, standardised as a percentage, is converted to a fraction before closure. Closure
removes rounding error in the sum of the fractions; the observed raw sums are 0.98 to 1.01 and
are recorded and reported instead of dropping rows.

\[
b_O=\sqrt{\frac{2}{3}}\log\frac{c_{O_2}}{\sqrt{c_{N_2}c_X}},
\qquad
b_X=\frac{1}{\sqrt{2}}\log\frac{c_X}{c_{N_2}}.
\]

For any positive three-part composition these two balances form an orthonormal ILR basis. The
main target is \(\beta_X\): the change in the outcome per unit change of \(b_X\), holding \(b_O\)
and the observed covariates fixed. For readability, the predicted effect of doubling the
\(X/N_2\) ratio is also reported as \(\beta_X\log(2)/\sqrt{2}\); this is a descriptive
transformation of the coefficient, not a causal intervention.

## 4. Outcomes and complete data

There are two separate outcomes:

1. \(K\) in \(\mathrm{mm^2/s}\);
2. \(R_D=D_e/D_0\).

Each model uses only complete cases for the outcome and all required covariates. No missing
outcome or covariate is imputed. The number of rows and of unique dates is reported before
fitting.

## 5. Main model

Four main models: two diluents × two outcomes.

\[
y_i=\alpha+\beta_O b_{O,i}+\beta_X b_{X,i}
+\beta_D\log(D_{0,i})+\beta_P(P_i/100\ \mathrm{kPa})
+\gamma I(\mathrm{Heptane}_i)+\varepsilon_i.
\]

Methanol is the reference fuel. The fit is OLS; pressure is linear in units of 100 kPa, and the
logarithm of \(D_0\) is natural. There is no interaction in the main model. The diluent
coefficient is interpreted only with both balances in the model together and is not labelled an
"independent effect of the He/CO₂ fraction".

Condition for running a main model: at least 30 rows, 10 unique dates, a full-rank matrix and at
least three rows per design column. Otherwise the status `not_evaluable` is recorded.

## 6. Uncertainty and multiplicity

- Cluster-robust CR1 standard errors by `test_date`, with a t statistic on \(G-1\) degrees of
  freedom, are reported.
- The 95% interval and p-value for \(\beta_X\) are exploratory, especially when \(G<20\).
- Benjamini–Hochberg is applied only to the four main p-values for \(\beta_X\); other
  coefficients and sensitivity analyses are not part of a new confirmatory family.
- Leave-one-date-out is run for \(\beta_X\), and its range and the share keeping the sign are
  reported.
- Clustering by date does not control every protocol or campaign difference.

## 7. Pre-specified sensitivity analyses

1. The same model within Methanol and within Heptane separately, without the fuel column;
2. adding `test_end` as a categorical term to the main model, only as a sensitivity check of
   protocol / end-of-test selection;
3. removing each date in turn, for the stability of the sign and range of \(\beta_X\).

Within-fuel models require at least 15 rows, five dates and a full-rank matrix. Sensitivity
results are not new confirmatory tests and are not used to choose a model by the best p-value.
Because `test_end` is tied to the outcome definition and to how a test ends, it is not an
automatic main control.

## 8. Grouped prediction check

For each main model, five-fold GroupKFold by `test_date` is run; with fewer than five dates the
number of folds equals the number of dates. The full model is compared with a baseline model
containing only \(\log D_0\), pressure and fuel. Pooled out-of-fold RMSE and MAE, the RMSE
difference and the RMSE ratio are reported. A lower error is not validation on an independent
campaign and not proof of causality. Folds with rank-deficient training data are marked invalid
instead of substituting an artificial outcome.

## 9. Output and interpretation decision

The output contains the closure/balance rows, coefficients, clusters, sensitivity results,
out-of-fold predictions and review plots. The result is called only an "adjusted compositional
association with the observed covariates". No p-value or attractive plot on its own creates a
validated finding, a mechanistic effect, independent validation or an operational safety
recommendation.

## 10. Relation to time series and data assimilation

This analysis uses the PSI-69 summaries and does not use the three Figure 6 curves as independent
data. Xi-style data assimilation is postponed until complete, richer \(D(t)\) histories are
available, together with a dynamic model and defensible uncertainty.
