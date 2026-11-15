"use client";

/* eslint-disable @next/next/no-img-element -- analysis plots come from the local API. */
import Link from "next/link";
import { useEffect, useState } from "react";
import { ListSkeleton, TableSkeleton } from "@/components/loading";
import {
  Card,
  ErrorNote,
  NoDataset,
  PageHeader,
  StatusBadge,
  SyntheticBanner,
} from "@/components/ui";
import { api, fmt, label } from "@/lib/api";
import type {
  CompositionalModel,
  Dataset,
  Finding,
  ScientificReview,
  Status,
} from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

const STATUS_ORDER: Status[] = [
  "validated",
  "candidate",
  "rejected",
  "not_significant",
];

function Section({
  id,
  index,
  title,
  children,
}: {
  id: string;
  index: string;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <section id={id} className="scroll-mt-24 border-t border-line py-8">
      <div className="mb-5 grid gap-2 sm:grid-cols-[3rem_1fr]">
        <span className="font-mono text-xs text-muted">{index}</span>
        <h2 className="font-display text-2xl font-medium text-ink">{title}</h2>
      </div>
      <div className="sm:pl-12">{children}</div>
    </section>
  );
}

function ArtifactLink({
  review,
  datasetId,
  keyName,
  children,
  className = "text-accent hover:underline",
}: {
  review: ScientificReview;
  datasetId: string;
  keyName: string;
  children: React.ReactNode;
  className?: string;
}) {
  const artifact = review.artifacts.find((item) => item.key === keyName);
  if (!artifact) return null;
  return (
    <a
      href={api.scientificArtifactUrl(datasetId, keyName)}
      className={className}
      download={artifact.filename}
      title={`SHA-256 ${artifact.sha256}`}
    >
      {children}
    </a>
  );
}

function modelVerdict(model: CompositionalModel) {
  if (model.bh_q_value >= 0.05) return "No stable association";
  if (model.small_cluster_warning || model.delta_rmse_full_minus_baseline > 0)
    return "Exploratory";
  return "Candidate association";
}

function LimitList({ items }: { items: string[] }) {
  return (
    <ul className="list-disc space-y-1.5 pl-5 text-sm leading-6 text-ink-2">
      {items.map((item) => (
        <li key={item}>{item}</li>
      ))}
    </ul>
  );
}

function ScientificReviewForDataset({ dataset }: { dataset: Dataset }) {
  const datasetId = dataset.dataset_id;
  const [review, setReview] = useState<ScientificReview | null>(null);
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    Promise.all([
      api.scientificReview(datasetId),
      api.findings({ dataset_id: datasetId }),
    ])
      .then(([bundle, list]) => {
        if (!live) return;
        setReview(bundle);
        setFindings(list);
      })
      .catch((e) => live && setError(e.message))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
  }, [datasetId]);

  return (
    <>
      <PageHeader eyebrow="Scientific review" title="Evidence before interpretation">
        A source-grounded review of the real FLEX analysis: what was measured,
        what survived validation, which follow-up analyses support a candidate,
        and where the evidence stops. Numerical results are read from the locked
        analysis artifacts, not retyped for this page.
      </PageHeader>
      {dataset.synthetic && <SyntheticBanner />}
      {loading && (
        <div className="space-y-5" aria-busy="true">
          <Card><ListSkeleton rows={4} /></Card>
          <Card><TableSkeleton rows={8} cols={5} /></Card>
        </div>
      )}
      {error && (
        <div className="space-y-4">
          <ErrorNote message={error} />
          <p className="max-w-3xl text-sm leading-6 text-ink-2">
            The verified review bundle is attached only to the unchanged real
            PSI-69 source. Other uploads and synthetic datasets can still use
            Discovery and Finding review, but they do not inherit FLEX results.
          </p>
        </div>
      )}
      {review && datasetId && (
        <article className="fade-in">
          <header className="border-y border-line py-7">
            <div className="grid gap-7 lg:grid-cols-[1.35fr_1fr]">
              <div>
                <p className="font-mono text-xs uppercase tracking-[0.14em] text-muted">
                  {review.investigation.accession} · {review.investigation.investigationAcronym} · v{review.investigation.version}
                </p>
                <h2 className="mt-3 max-w-2xl font-display text-3xl font-medium leading-tight text-ink sm:text-4xl">
                  {review.investigation.title}
                </h2>
                <p className="mt-4 max-w-2xl text-sm leading-6 text-ink-2">
                  {review.scope.official_report.documented_setting}. The source
                  table covers {review.scope.psi_table_audit.rows} rows from {review.scope.psi_table_audit.minimum_test_date} to {review.scope.psi_table_audit.maximum_test_date}, across {review.scope.psi_table_audit.unique_test_dates} test dates.
                </p>
                <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-sm">
                  <a href={review.scope.official_report.url} target="_blank" rel="noreferrer" className="text-accent underline underline-offset-4">
                    {review.scope.official_report.document_id} ↗
                  </a>
                  <Link href="/data" className="text-accent underline underline-offset-4">
                    Ingestion and provenance
                  </Link>
                </div>
              </div>
              <dl className="grid grid-cols-2 content-start gap-x-5 gap-y-5 sm:grid-cols-4 lg:grid-cols-2">
                <div><dt className="font-mono text-[11px] text-muted">ROWS</dt><dd className="mt-1 text-2xl tabular-nums">{review.pipeline.rows_out}</dd></div>
                <div><dt className="font-mono text-[11px] text-muted">TEST DATES</dt><dd className="mt-1 text-2xl tabular-nums">{review.scope.psi_table_audit.unique_test_dates}</dd></div>
                <div><dt className="font-mono text-[11px] text-muted">FINDINGS</dt><dd className="mt-1 text-2xl tabular-nums">{review.finding_total}</dd></div>
                <div><dt className="font-mono text-[11px] text-muted">EXPERT APPROVAL</dt><dd className="mt-1 text-lg">{review.review.formal_expert_approval ? "Recorded" : "Not recorded"}</dd></div>
              </dl>
            </div>
          </header>

          <div className="my-7 bg-[#12141f] px-5 py-5 text-white sm:px-7">
            <p className="font-mono text-[11px] uppercase tracking-[0.16em] text-white/60">Evidence boundary</p>
            <div className="mt-4 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
              <div><strong className="block text-sm">ISS flight-series scope</strong><span className="mt-1 block text-xs leading-5 text-white/70">Series-level label; no complete per-row space/ground crosswalk.</span></div>
              <div><strong className="block text-sm">No external replication</strong><span className="mt-1 block text-xs leading-5 text-white/70">FLEX-2 contains a planned matrix, not measured outcomes.</span></div>
              <div><strong className="block text-sm">No raw D(t) recovered</strong><span className="mt-1 block text-xs leading-5 text-white/70">Three published vector curves support only a proof-of-method.</span></div>
              <div><strong className="block text-sm">No causal or Lunar/Mars claim</strong><span className="mt-1 block text-xs leading-5 text-white/70">Associations stay within observed FLEX conditions.</span></div>
            </div>
          </div>

          <nav aria-label="Scientific review sections" className="mb-2 flex flex-wrap gap-x-5 gap-y-2 font-mono text-xs text-ink-2">
            <a href="#provenance" className="hover:text-accent">01 Provenance</a>
            <a href="#findings" className="hover:text-accent">02 Finding review</a>
            <a href="#compositional" className="hover:text-accent">03 Composition</a>
            <a href="#time-series" className="hover:text-accent">04 Time series</a>
            <a href="#boundaries" className="hover:text-accent">05 Replication & uncertainty</a>
          </nav>

          <Section id="provenance" index="01" title="Source, ingestion and experimental scope">
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <h3 className="text-sm font-semibold">Immutable input</h3>
                <dl className="mt-3 space-y-3 text-sm">
                  <div><dt className="text-xs text-muted">Filename</dt><dd className="mt-0.5 text-ink-2">{review.source.filename}</dd></div>
                  <div><dt className="text-xs text-muted">SHA-256</dt><dd className="mt-0.5 break-all font-mono text-xs leading-5 text-ink-2">{review.source.sha256}</dd></div>
                  <div className="grid grid-cols-3 gap-3 border-t border-line pt-3">
                    <div><dt className="text-xs text-muted">Bytes</dt><dd className="tabular-nums">{review.source.bytes}</dd></div>
                    <div><dt className="text-xs text-muted">Encoding</dt><dd>{review.ingestion.encoding}</dd></div>
                    <div><dt className="text-xs text-muted">Adapter</dt><dd className="break-all">{review.ingestion.adapter}</dd></div>
                  </div>
                </dl>
                <h3 className="mt-6 text-sm font-semibold">Measured transformations</h3>
                <ul className="mt-2 space-y-2 text-sm text-ink-2">
                  {review.pipeline.unit_conversions.map((conversion) => (
                    <li key={conversion.column}>
                      <span className="font-medium text-ink">{label(conversion.column)}</span>: {conversion.from} → {conversion.to}; {conversion.values} values.
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-xs leading-5 text-muted">
                  {review.pipeline.rows_in} rows in → {review.pipeline.rows_out} out; {review.pipeline.empty_rows_dropped} empty and {review.pipeline.duplicate_rows_dropped} duplicate rows dropped. The burning-rate unit remains K in mm²/s; the ambiguous source header is retained as a warning rather than silently converted.
                </p>
              </div>
              <div>
                <h3 className="text-sm font-semibold">What the ISS label means</h3>
                <p className="mt-2 text-sm leading-6 text-ink-2">{review.scope.environment_conclusion.basis}.</p>
                <div className="mt-4 border-l-2 border-[#12141f] pl-4">
                  <p className="text-sm leading-6 text-ink-2">{review.scope.environment_conclusion.limitation}.</p>
                  <p className="mt-2 text-sm leading-6 text-ink-2">{review.scope.numbering_evidence.conclusion}.</p>
                  <p className="mt-2 text-sm leading-6 text-ink-2">{review.scope.campaign_conclusion.limitation}.</p>
                </div>
                <h3 className="mt-6 text-sm font-semibold">Derived fields are not new measurements</h3>
                <dl className="mt-2 space-y-2 text-xs leading-5 text-ink-2">
                  {Object.entries(review.ingestion.derived).map(([key, value]) => (
                    <div key={key}><dt className="font-mono text-muted">{key}</dt><dd>{value}</dd></div>
                  ))}
                </dl>
              </div>
            </div>
          </Section>

          <Section id="findings" index="02" title="Finding status and eight-finding scientific review">
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {STATUS_ORDER.map((status) => (
                <Link key={status} href="/findings" className="border border-line p-4 hover:bg-surface-2">
                  <StatusBadge status={status} />
                  <span className="mt-3 block text-3xl tabular-nums">{review.finding_status_counts[status]}</span>
                </Link>
              ))}
            </div>
            <p className="mt-4 max-w-3xl text-sm leading-6 text-ink-2">
              The date-grouped Discovery run contains {review.finding_total} results. The scientific review below covers {review.review.reviewed_findings} leading results; it is machine-assisted and does not record formal expert approval or independent external validation.
            </p>
            <div className="mt-6 overflow-x-auto">
              <table className="w-full min-w-[900px] border-collapse text-left text-sm">
                <thead className="border-y border-line font-mono text-[11px] text-muted">
                  <tr>
                    <th className="py-3 pr-4 font-medium">#</th>
                    <th className="py-3 pr-4 font-medium">CONDITION → OUTCOME</th>
                    <th className="py-3 pr-4 text-right font-medium">PRIMARY EFFECT</th>
                    <th className="py-3 pr-4 text-right font-medium">DATE HOLDOUT</th>
                    <th className="py-3 pr-4 font-medium">REVIEW DECISION</th>
                    <th className="py-3 font-medium">SCOPE / LIMITATION</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {review.review.findings.map((item) => {
                    const finding = findings.find(
                      (candidate) =>
                        candidate.condition === item.condition &&
                        candidate.outcome === item.outcome &&
                        candidate.analyzer === item.analyzer,
                    );
                    return (
                      <tr key={item.review_id} className="align-top">
                        <td className="py-4 pr-4 font-mono text-xs text-muted">{String(item.review_id).padStart(2, "0")}</td>
                        <td className="py-4 pr-4">
                          {finding ? <Link href={`/findings/${finding.finding_id}`} className="font-medium text-ink hover:text-accent">{label(item.condition)} → {label(item.outcome)}</Link> : <span>{label(item.condition)} → {label(item.outcome)}</span>}
                          <span className="mt-1 block text-xs text-muted">n={item.n} · {label(item.analyzer)}</span>
                        </td>
                        <td className="py-4 pr-4 text-right tabular-nums">{fmt(item.primary_effect, 4)}<span className="block text-xs text-muted">q={fmt(item.q_value_primary, 3)}</span></td>
                        <td className="py-4 pr-4 text-right tabular-nums">{fmt(item.date_holdout_effect, 4)}<span className="block text-xs text-muted">p={fmt(item.date_holdout_p, 3)}</span></td>
                        <td className="py-4 pr-4 text-xs leading-5">{label(item.review_decision)}</td>
                        <td className="max-w-sm py-4 text-xs leading-5 text-ink-2">{item.scope_and_limitation}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="mt-4 flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <ArtifactLink review={review} datasetId={datasetId} keyName="review_table">Download review CSV</ArtifactLink>
              <ArtifactLink review={review} datasetId={datasetId} keyName="review_overview">Open eight-finding figure</ArtifactLink>
            </div>
          </Section>

          <Section id="compositional" index="03" title="Zero-aware compositional diluent analysis">
            <div className="space-y-7">
              <div className="max-w-3xl">
                <p className="text-sm leading-6 text-ink-2">
                  Separate positive CO₂ and He subsets use three-part log-ratio balances. Structural zeros are not replaced with pseudocounts, and N₂-only rows remain descriptive. Fuel, oxygen balance, initial diameter and pressure are controlled; detailed protocol fields are not available.
                </p>
                <div className="mt-4 border-y border-line py-4 font-mono text-xs leading-6 text-ink-2">
                  <p>bO = √(2/3) · log[O₂ / √(N₂X)]</p>
                  <p>bX = 1/√2 · log[X / N₂]</p>
                </div>
                <p className="mt-4 text-sm leading-6 text-ink-2">
                  CO₂/N₂ → K is the stronger candidate association. He/N₂ → K remains exploratory because its date clusters are few and grouped prediction worsens. Neither diluent shows a stable adjusted association with De/D₀.
                </p>
                <p className="mt-3 text-xs leading-5 text-muted">Protocol v{review.compositional.protocol_version} · verified={String(review.compositional.protocol_verified)} · external registry preregistration={String(review.compositional.external_registry_preregistration)}</p>
                <code className="mt-2 block break-all text-[11px] leading-5 text-muted">{review.compositional.protocol_sha256}</code>
                <div className="mt-3 flex gap-4 text-sm">
                  <ArtifactLink review={review} datasetId={datasetId} keyName="compositional_protocol">Locked protocol</ArtifactLink>
                  <ArtifactLink review={review} datasetId={datasetId} keyName="compositional_protocol_lock">Protocol lock</ArtifactLink>
                </div>
              </div>
              <div className="overflow-x-auto">
                <table className="w-full min-w-[680px] text-left text-sm">
                  <thead className="border-y border-line font-mono text-[11px] text-muted">
                    <tr><th className="py-3 pr-3 font-medium">MODEL</th><th className="py-3 pr-3 text-right font-medium">βX [95% CI]</th><th className="py-3 pr-3 text-right font-medium">BH q</th><th className="py-3 pr-3 text-right font-medium">GROUPED RMSE</th><th className="py-3 font-medium">READING</th></tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {review.compositional.primary_models.map((model) => (
                      <tr key={model.model_id} className="align-top">
                        <td className="py-4 pr-3"><strong>{model.diluent} → {model.outcome === "droplet_burning_rate_constant" ? "K" : "De/D₀"}</strong><span className="mt-1 block text-xs text-muted">n={model.n} · {model.n_dates} dates</span></td>
                        <td className="py-4 pr-3 text-right tabular-nums">{fmt(model.beta_alternative, 5)}<span className="block text-xs text-muted">[{fmt(model.ci95_low, 4)}, {fmt(model.ci95_high, 4)}]</span></td>
                        <td className="py-4 pr-3 text-right tabular-nums">{fmt(model.bh_q_value, 4)}</td>
                        <td className="py-4 pr-3 text-right tabular-nums">{fmt(model.full_rmse, 4)}<span className="block text-xs text-muted">baseline {fmt(model.baseline_rmse, 4)}</span></td>
                        <td className="py-4 text-xs leading-5">{modelVerdict(model)}{model.small_cluster_warning && <span className="block text-muted">Fewer than 20 date clusters</span>}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
            <div className="mt-7 grid gap-5 lg:grid-cols-2">
              <figure>
                <img src={api.scientificArtifactUrl(datasetId, "compositional_coefficients_plot")} alt="Primary compositional coefficients with cluster-robust confidence intervals" className="w-full border border-line" />
                <figcaption className="mt-2 text-xs text-muted">Adjusted associations, not direct raw-fraction correlations.</figcaption>
              </figure>
              <figure>
                <img src={api.scientificArtifactUrl(datasetId, "compositional_predictions_plot")} alt="Date-grouped out-of-fold predictions for full and baseline compositional models" className="w-full border border-line" />
                <figcaption className="mt-2 text-xs text-muted">Date-grouped descriptive prediction, not independent campaign validation.</figcaption>
              </figure>
            </div>
            <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">Compositional limitations</summary><div className="mt-3"><LimitList items={review.compositional.limitations} /></div></details>
          </Section>

          <Section id="time-series" index="04" title="Published-curve time-series proof-of-method">
            <div className="border-l-2 border-[#12141f] pl-4">
              <p className="text-sm font-medium">Published, downsampled vector digitization—not raw experimental D(t).</p>
              <p className="mt-1 text-sm leading-6 text-ink-2">
                Source: {review.time_series.source.authors} ({review.time_series.source.year}), DOI {review.time_series.source.doi}, Figure {review.time_series.source.figure}. {review.time_series.source.published_downsampling}. Raw images recovered: {String(review.time_series.raw_images_recovered)}; raw per-test histories recovered: {String(review.time_series.raw_per_test_d_t_histories_recovered)}; data assimilation executed: {String(review.time_series.data_assimilation_executed)}.
              </p>
            </div>
            <div className="mt-6 space-y-7">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[520px] text-left text-sm">
                  <thead className="border-y border-line font-mono text-[11px] text-muted"><tr><th className="py-3 pr-3 font-medium">SERIES</th><th className="py-3 pr-3 text-right font-medium">CENTRAL-80% K</th><th className="py-3 pr-3 text-right font-medium">PUBLISHED K</th><th className="py-3 pr-3 text-right font-medium">LATE-20% K</th><th className="py-3 text-right font-medium">REDUCTION</th></tr></thead>
                  <tbody className="divide-y divide-line">
                    {(["CO2", "N2", "He"] as const).map((series) => {
                      const primary = review.time_series.fits.find((fit) => fit.series === series && fit.role === "primary");
                      const late = review.time_series.fits.find((fit) => fit.series === series && fit.role === "near_extinction");
                      if (!primary || !late) return null;
                      return <tr key={series}><td className="py-3 pr-3 font-medium">{series}</td><td className="py-3 pr-3 text-right tabular-nums">{fmt(primary.burning_rate_constant_mm2_s, 6)}</td><td className="py-3 pr-3 text-right tabular-nums">{fmt(primary.published_k_mm2_s, 2)}</td><td className="py-3 pr-3 text-right tabular-nums">{fmt(late.burning_rate_constant_mm2_s, 6)}</td><td className="py-3 text-right tabular-nums">{fmt((late.late_k_reduction_fraction ?? 0) * 100, 2)}%</td></tr>;
                    })}
                  </tbody>
                </table>
                <p className="mt-3 text-xs leading-5 text-muted">K in mm²/s. Primary fit: {review.time_series.primary_fit}. Window fits are descriptive; no naive independent-point OLS p-values are used.</p>
                <p className="mt-4 text-sm leading-6 text-ink-2">Candidate PSI-69 rows: {Object.entries(review.time_series.candidate_row_mapping.candidates).map(([key, value]) => `${key}=${value}`).join(", ")}. Mapping status: {label(review.time_series.candidate_row_mapping.status)}; the figure prints no per-curve test IDs.</p>
                <div className="mt-4"><ArtifactLink review={review} datasetId={datasetId} keyName="time_series_fits">Download all fit windows</ArtifactLink></div>
              </div>
              <figure className="mx-auto max-w-4xl">
                <img src={api.scientificArtifactUrl(datasetId, "time_series_plot")} alt="Published D-squared histories and independent central and late-window refits for carbon dioxide, nitrogen and helium series" className="w-full border border-line" />
                <figcaption className="mt-2 text-xs text-muted">Near-extinction slopes are lower in all three published histories; three curves cannot establish a general diluent effect.</figcaption>
              </figure>
            </div>
            <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">Time-series limitations</summary><div className="mt-3"><LimitList items={review.time_series.limitations} /></div></details>
          </Section>

          <Section id="boundaries" index="05" title="Replication and uncertainty remain explicit">
            <div className="grid gap-8 lg:grid-cols-2">
              <div>
                <p className="font-mono text-xs text-muted">FLEX-2 / {review.replication.investigation}</p>
                <h3 className="mt-2 text-xl font-medium">External replication: not evaluable</h3>
                <p className="mt-3 text-sm leading-6 text-ink-2">The {review.replication.raw_rows}-row file is a {review.replication.table_type}. {review.replication.reason}</p>
                <dl className="mt-4 grid grid-cols-2 gap-4 border-y border-line py-4 text-sm">
                  <div><dt className="text-xs text-muted">Inferential tests</dt><dd className="mt-1 text-2xl tabular-nums">{review.replication.inferential_tests_performed}</dd></div>
                  <div><dt className="text-xs text-muted">Replication executable</dt><dd className="mt-1 text-lg">{String(review.replication.replication_executable)}</dd></div>
                </dl>
                <div className="mt-4 flex flex-wrap gap-4 text-sm">
                  <ArtifactLink review={review} datasetId={datasetId} keyName="replication_protocol">Replication protocol</ArtifactLink>
                  <ArtifactLink review={review} datasetId={datasetId} keyName="replication_results">Feasibility results</ArtifactLink>
                  <a href={review.replication.official_metadata_url} target="_blank" rel="noreferrer" className="text-accent hover:underline">Official metadata ↗</a>
                </div>
              </div>
              <div>
                <p className="font-mono text-xs text-muted">SHAW–YU SENSITIVITY SCENARIO</p>
                <h3 className="mt-2 text-xl font-medium">Literature-based, not per-row uncertainty</h3>
                <p className="mt-3 text-sm leading-6 text-ink-2">{review.uncertainty.source.title}. The scenario uses {review.uncertainty.scenario.simulations} simulations with seed {review.uncertainty.scenario.seed}; oxygen, pressure, protocol and systematic errors included: {String(review.uncertainty.scenario.oxygen_pressure_protocol_and_systematic_errors_included)}.</p>
                <p className="mt-3 text-sm leading-6 text-ink-2">Expanded-scenario endpoint coverage: {fmt(review.uncertainty.residual_qc.covered_by_expanded_scenario_share * 100, 1)}% of {review.uncertainty.residual_qc.n} residuals. {review.uncertainty.residual_qc.interpretation}.</p>
                <div className="mt-4 flex gap-4 text-sm">
                  <ArtifactLink review={review} datasetId={datasetId} keyName="uncertainty_associations">Association scenarios</ArtifactLink>
                  <a href={review.uncertainty.source.url} target="_blank" rel="noreferrer" className="text-accent hover:underline">DOI source ↗</a>
                </div>
              </div>
            </div>
            <div className="mt-7 grid gap-5 lg:grid-cols-2">
              <img src={api.scientificArtifactUrl(datasetId, "uncertainty_plot")} alt="Association uncertainty sensitivity forest plot" className="w-full border border-line" />
              <img src={api.scientificArtifactUrl(datasetId, "residual_uncertainty_plot")} alt="Endpoint residual quality control under the uncertainty scenario" className="w-full border border-line" />
            </div>
            <details className="mt-5"><summary className="cursor-pointer text-sm font-medium">Uncertainty limitations</summary><div className="mt-3"><LimitList items={review.uncertainty.limitations} /></div></details>
          </Section>

          <footer className="border-t border-line py-7">
            <h2 className="text-sm font-semibold">Artifact integrity</h2>
            <p className="mt-2 max-w-3xl text-sm leading-6 text-ink-2">Every plot, table and protocol above is served from the same packaged analysis output. These hashes identify the files used by this review; no publisher PDF or signed temporary URL is included.</p>
            <details className="mt-4">
              <summary className="cursor-pointer text-sm text-accent">Show {review.artifacts.length} artifact hashes</summary>
              <ul className="mt-3 divide-y divide-line">
                {review.artifacts.map((artifact) => (
                  <li key={artifact.key} className="grid gap-1 py-3 text-xs sm:grid-cols-[1fr_auto] sm:gap-4">
                    <ArtifactLink review={review} datasetId={datasetId} keyName={artifact.key} className="font-medium text-ink-2 hover:text-accent">{artifact.filename}</ArtifactLink>
                    <code className="break-all text-muted sm:text-right">{artifact.sha256}</code>
                  </li>
                ))}
              </ul>
            </details>
          </footer>
        </article>
      )}
    </>
  );
}

export default function ScientificReviewPage() {
  const { dataset } = useWorkspace();
  if (!dataset) return <NoDataset />;
  return <ScientificReviewForDataset key={dataset.dataset_id} dataset={dataset} />;
}
