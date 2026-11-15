"use client";

import { AiWait } from "@/components/ai-wait";
import { ReadinessChip, ReadinessLadder } from "@/components/readiness";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { GroupBars, ScatterChart } from "@/components/charts";
import { PipelineLink } from "@/components/pipeline-link";
import { PriorKnowledgeCard } from "@/components/prior-knowledge";
import {
  ChartSkeleton,
  ListSkeleton,
  LoadingLabel,
  Skeleton,
  StatSkeleton,
  TextSkeleton,
} from "@/components/loading";
import {
  Button,
  Card,
  ErrorNote,
  PageHeader,
  Stat,
  StatusBadge,
  SyntheticBanner,
} from "@/components/ui";
import { api, fmt, label } from "@/lib/api";
import { SAFETY_AREAS } from "@/lib/labels";
import type {
  DeepSuggestion,
  Finding,
  FindingChart,
  ProbeResult,
  Row,
  SafetyArea,
} from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

const PIPELINE = [
  "Data",
  "Statistical analysis",
  "Finding",
  "Validation",
  "Evidence",
  "AI explanation",
];

const VERDICT = {
  supports: { text: "Supports the finding", color: "var(--good)", icon: "✓" },
  weakens: { text: "Weakens the finding", color: "var(--critical)", icon: "!" },
  inconclusive: { text: "Inconclusive", color: "var(--warning)", icon: "?" },
  not_run: { text: "Not run yet", color: "var(--muted)", icon: "–" },
} as const;

export default function FindingPage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const { setCompare, selectDataset } = useWorkspace();
  const [finding, setFinding] = useState<Finding | null>(null);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [deep, setDeep] = useState<DeepSuggestion[] | null>(null);
  const [running, setRunning] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  const loadDeep = useCallback(() => {
    api
      .deep(id)
      .then((d) => setDeep(d.suggestions))
      .catch(() => setDeep([]));
  }, [id]);

  useEffect(() => {
    api
      .finding(id)
      .then(async (f) => {
        setFinding(f);
        const r = await api.query(f.dataset_id, { limit: 5000 });
        setRows(r.rows);
      })
      .catch((e) => setError(e.message));
    loadDeep();
  }, [id, loadDeep]);

  async function interpret(force = false) {
    setAiBusy(true);
    setAiError(null);
    try {
      setFinding(await api.interpret(id, force));
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setAiBusy(false);
    }
  }

  async function runProbe(s: DeepSuggestion) {
    const key = s.probe + JSON.stringify(s.params);
    setRunning(key);
    try {
      await api.runProbe(id, s.probe, s.params);
      loadDeep();
    } catch (e) {
      setAiError((e as Error).message);
    } finally {
      setRunning(null);
    }
  }

  /** Path: finding -> evidence -> experiments -> compare */
  function compareEvidence() {
    if (!finding) return;
    const ids = pickContrastingExperiments(finding, rows);
    selectDataset(finding.dataset_id);
    setCompare(ids);
    router.push("/compare");
  }

  if (error) return <ErrorNote message={error} />;
  if (!finding) return <FindingSkeleton />;

  const f = finding;
  const groups = (f.details.median_by_group ?? f.details.rate_by_group) as
    Record<string, number> | undefined;
  const ai = f.interpretation;
  const holdout = f.validations.find((v) => v.method === "holdout_replication");
  const perm = f.validations.find((v) => v.method === "permutation_test");
  const thirdVar = f.deep.filter((d) => d.probe === "third_variable");
  const otherDeep = deep?.filter((d) => d.probe !== "third_variable") ?? null;

  return (
    <>
      <PipelineLink
        href="/relationships"
        className="mb-4 inline-block text-sm text-ink-2 hover:text-ink"
      >
        ← Discovery
      </PipelineLink>
      <PageHeader
        eyebrow={`${label(f.condition)} ↔ ${label(f.outcome)}`}
        title={f.headline}
      >
        <span className="flex flex-wrap items-center gap-2">
          <StatusBadge status={f.status} />
          <ReadinessChip f={f} />
          <span>{f.status_explanation}</span>
        </span>
      </PageHeader>
      {f.synthetic && <SyntheticBanner />}

      <ol
        className="mb-5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs"
        aria-label="How this finding was produced"
      >
        {PIPELINE.map((s, i) => (
          <li key={s} className="flex items-center gap-2 text-ink-2">
            <span className="rounded-full border border-line bg-surface px-2 py-0.5">
              {s}
            </span>
            {i < PIPELINE.length - 1 && (
              <span aria-hidden className="text-muted">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      {/* 1. what was found */}
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="What was found" className="lg:col-span-2">
          <p className="mb-1 text-sm text-ink">
            In this data,{" "}
            {f.headline.charAt(0).toLowerCase() + f.headline.slice(1)}.
          </p>
          <p className="mb-4 text-xs text-muted">
            A statistical association, not a cause-and-effect claim. Discovery
            goal: {f.goal}
          </p>
          {groups ? (
            <GroupBars
              values={groups}
              xLabel={label(f.condition)}
              yLabel={
                f.details.rate_by_group
                  ? `${label(f.outcome)} rate`
                  : `median ${label(f.outcome)}`
              }
            />
          ) : (
            <FindingScatter finding={f} />
          )}
        </Card>

        <Card title="Statistics">
          <div className="grid grid-cols-2 gap-4">
            <Stat
              label={label(f.effect_metric)}
              value={fmt(f.effect_size, 3)}
              hint="Effect size on the discovery split"
            />
            <Stat
              label="q-value (FDR)"
              value={fmt(f.q_value)}
              hint="p-value corrected for testing many associations at once"
            />
            <Stat label="Discovery rows" value={f.n_train} />
            <Stat label="Rank score" value={fmt(f.score, 3)} />
          </div>
          {f.uncertainty && (
            <p className="mt-4 text-sm text-ink-2">
              95% interval:{" "}
              <strong className="text-ink">
                {fmt(f.uncertainty.low, 2)} to {fmt(f.uncertainty.high, 2)}
              </strong>{" "}
              <span className="text-xs text-muted">
                ({f.uncertainty.resamples} bootstrap resamples; finding kept in{" "}
                {Math.round(f.uncertainty.stable_share * 100)}%)
              </span>
            </p>
          )}
          <dl className="mt-4 space-y-1 border-t border-line pt-3 text-xs">
            <p className="mb-1 text-muted">Ranking factors (0–1, weighted):</p>
            {Object.entries(f.score_components).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-muted">
                  {label(k)}
                  {f.score_weights?.[k] !== undefined &&
                    f.score_weights[k] !== 1 &&
                    ` ×${f.score_weights[k]}`}
                </dt>
                <dd className="tabular-nums text-ink-2">{fmt(v, 2)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">{f.method}</p>
        </Card>
      </div>

      <Card title={`Evidence readiness: level ${f.readiness?.level ?? 0} of 7`} className="mt-4">
        <ReadinessLadder f={f} />
      </Card>

      {/* 2. validation, in detail */}
      <Card title="Validation — is it real, or chance?" className="mt-4">
        {f.validations.length === 0 ? (
          <p className="text-sm text-ink-2">
            Not validated: the association was not significant in the discovery
            data after correcting for multiple tests (q = {fmt(f.q_value, 3)}).{" "}
            {f.status_explanation}
          </p>
        ) : (
          <div className="grid gap-4 md:grid-cols-3">
            <div className="text-sm">
              <p className="mb-1 font-medium text-ink">
                1 · Split before discovery
              </p>
              {f.split ? (
                <p className="text-ink-2">
                  {f.split.discovery_experiments} experiments (
                  {f.split.discovery_rows} rows) used to find the association;{" "}
                  {f.split.holdout_experiments} experiments (
                  {f.split.holdout_rows} rows) held back and never seen by
                  discovery. Split by{" "}
                  {f.split.by === "_source_id"
                    ? "source file"
                    : label(f.split.by)}
                  {f.split.groups_holdout != null &&
                    f.split.by !== "experiment_id" &&
                    ` (${f.split.groups_discovery} / ${f.split.groups_holdout} groups)`}
                  , so no group is on both sides. Leakage check:{" "}
                  {Object.entries(f.split.shared_across_split ?? {})
                    .map(
                      ([k, v]) =>
                        `${v} ${k === "_source_id" ? "source files" : label(k)} shared`,
                    )
                    .join(", ") || "not recorded for this run"}
                  .
                </p>
              ) : (
                <p className="text-ink-2">
                  Split details not recorded for this run.
                </p>
              )}
            </div>
            <ValidationBlock
              title="2 · Re-tested on unseen data"
              v={holdout}
              extra={
                holdout?.metrics.discovery_effect !== undefined && (
                  <table className="mt-2 w-full text-xs">
                    <tbody>
                      <Tr
                        k="Effect in discovery data"
                        v={fmt(holdout.metrics.discovery_effect, 3)}
                      />
                      <Tr
                        k="Effect on unseen data"
                        v={fmt(holdout.metrics.test_effect, 3)}
                      />
                      <Tr
                        k="Change"
                        v={fmt(holdout.metrics.effect_change, 3)}
                      />
                      <Tr
                        k="Share of effect retained"
                        v={`${Math.round(holdout.metrics.retained_share * 100)}%`}
                      />
                      <Tr
                        k="p-value on unseen data"
                        v={fmt(holdout.metrics.test_p_value)}
                      />
                    </tbody>
                  </table>
                )
              }
            />
            <ValidationBlock
              title="3 · Compared with random shuffles"
              v={perm}
              extra={
                perm?.metrics.permutations !== undefined && (
                  <p className="mt-2 text-xs text-muted">
                    {f.analyzer === "interaction" || f.analyzer === "curvature"
                      ? `Residuals of the model without the tested term were shuffled ${perm.metrics.permutations} times (Freedman–Lane), keeping the other effects but destroying the tested one;`
                      : `The outcome was shuffled ${perm.metrics.permutations} times to destroy any real link;`}{" "}
                    {perm.metrics.shuffles_as_strong ?? "—"} shuffles produced
                    an effect at least as strong (p ={" "}
                    {fmt(perm.metrics.permutation_p_value)}).
                  </p>
                )
              }
            />
          </div>
        )}
      </Card>

      {/* 3. evidence + limitations */}
      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card
          title="Evidence"
          action={
            <Button
              variant="ghost"
              onClick={compareEvidence}
              disabled={rows === null}
            >
              Compare these experiments →
            </Button>
          }
        >
          <p className="text-sm text-ink-2">
            Variables examined:{" "}
            <strong className="text-ink">{label(f.condition)}</strong> and{" "}
            <strong className="text-ink">{label(f.outcome)}</strong>. Based on{" "}
            <strong className="text-ink">{f.evidence.n_experiments}</strong>{" "}
            experiments ({f.evidence.n_rows} rows with both values).
          </p>
          <ul className="mt-2 text-xs text-muted">
            {f.evidence.sources.map((s) => (
              <li key={s.source_id}>
                Source file: <span className="text-ink-2">{s.filename}</span> ·
                sha256 <code>{s.sha256.slice(0, 12)}…</code> (stored unchanged)
              </li>
            ))}
          </ul>
          <div className="mt-3 flex max-h-36 flex-wrap gap-1 overflow-y-auto">
            {f.evidence.experiment_ids.map((e) => (
              <span
                key={e}
                className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2"
              >
                {e}
              </span>
            ))}
            {f.evidence.truncated && (
              <span className="text-xs text-muted">…and more</span>
            )}
          </div>
        </Card>

        <Card title="Limitations">
          <ul className="list-disc space-y-1.5 pl-5 text-sm text-ink-2">
            {f.limitations.map((l) => (
              <li key={l}>{l}</li>
            ))}
          </ul>
        </Card>
      </div>

      {/* 4. third variables */}
      {thirdVar.length > 0 && (
        <Card title="Could another variable explain it?" className="mt-4">
          <p className="mb-3 text-xs text-muted">
            Partial rank correlation: the association re-measured while holding
            each other measured condition fixed. A large drop means that
            variable may carry the association.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            {thirdVar.map((p) => (
              <ProbeCard key={p.params.control} result={p} />
            ))}
          </div>
        </Card>
      )}

      {/* 5. deep analysis */}
      <Card
        title="Deep analysis — questions this finding raises"
        className="mt-4"
      >
        <p className="mb-3 text-xs text-muted">
          Generated from this finding and the columns that exist in the data,
          not from a fixed list. Choose which ones are worth running.
        </p>
        {otherDeep === null ? (
          <ListSkeleton rows={3} />
        ) : otherDeep.length === 0 ? (
          <p className="text-sm text-ink-2">
            No further questions apply to this finding with the variables in
            this dataset.
          </p>
        ) : (
          <ul className="space-y-3">
            {otherDeep.map((s) => {
              const key = s.probe + JSON.stringify(s.params);
              return (
                <li key={key} className="rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <p className="text-xs uppercase tracking-wider text-muted">
                        {s.category}
                      </p>
                      <p className="text-sm font-medium text-ink">
                        {s.question}
                      </p>
                    </div>
                    <Button
                      variant={s.result ? "ghost" : "primary"}
                      onClick={() => runProbe(s)}
                      disabled={running !== null}
                    >
                      {running === key
                        ? "Running…"
                        : s.result
                          ? "Re-run"
                          : "Run"}
                    </Button>
                  </div>
                  {running === key ? (
                    <div className="mt-3">
                      <LoadingLabel>
                        Running the analysis on the full dataset…
                      </LoadingLabel>
                    </div>
                  ) : (
                    s.result && <ProbeCard result={s.result} inline />
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </Card>

      {/* 6. AI explanation, last */}
      <Card
        className="mt-4"
        title="AI explanation"
        action={
          <Button
            onClick={() => interpret(!!ai)}
            disabled={aiBusy}
            variant={ai ? "ghost" : "primary"}
          >
            {aiBusy ? "Thinking…" : ai ? "Regenerate" : "Explain this finding"}
          </Button>
        }
      >
        {aiError && <ErrorNote message={aiError} />}
        {aiBusy ? (
          <div className="space-y-4" aria-busy="true">
            <TextSkeleton lines={2} />
            <TextSkeleton lines={2} />
            <AiWait what="Gemini is reading the statistics and evidence" />
          </div>
        ) : ai ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-ink">{ai.summary}</p>
            <p className="text-ink-2">{ai.interpretation}</p>
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-accent">
                Open question for expert review
              </p>
              <p className="mt-1 text-ink">{ai.safety_relevance}</p>
            </div>
            {ai.caveats.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">
                {ai.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              Written by {ai.provider} ({ai.model}) only from the statistics and
              evidence above. It explains; it did not find, validate or
              interpret this scientifically.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-2">
            The AI turns the computed statistics, validation and evidence above
            into plain language. It does not analyse the data, find
            relationships or explain mechanisms.
          </p>
        )}
      </Card>

      <PriorKnowledgeCard finding={f} onSaved={setFinding} />

      <PromoteCard finding={f} />
    </>
  );
}

/** The finding's scatter chart, with an optional third variable for colour. */
function FindingScatter({ finding }: { finding: Finding }) {
  // undefined = let the server choose (an interaction's modifier); "none" = split only
  const [colorBy, setColorBy] = useState<string | undefined>(undefined);
  const [chart, setChart] = useState<FindingChart | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api
      .findingChart(finding.finding_id, colorBy)
      .then((c) => {
        if (!live) return;
        setChart(c);
        if (colorBy === undefined) setColorBy(c.color_by ?? "none");
      })
      .catch((e) => live && setError(e.message));
    return () => {
      live = false;
    };
  }, [finding.finding_id, colorBy]);

  if (error) return <ErrorNote message={error} />;
  if (!chart)
    return (
      <ChartSkeleton
        variant="scatter"
        label="Loading experiment data for the chart…"
      />
    );
  return (
    <div className="fade-in">
      <label className="mb-3 flex items-center gap-2 text-xs text-muted">
        Colour by
        <select
          value={colorBy}
          onChange={(e) => {
            setChart(null);
            setColorBy(e.target.value);
          }}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs text-ink"
        >
          <option value="none">Discovery vs unseen data</option>
          {chart.color_options.map((c) => (
            <option key={c} value={c}>
              {label(c)}
            </option>
          ))}
        </select>
      </label>
      <ScatterChart chart={chart} />
      {finding.analyzer === "interaction" && (
        <InteractionSlopes finding={finding} />
      )}
      {chart.trend && (
        <p className="mt-2 text-xs text-muted">{chart.trend.method}</p>
      )}
    </div>
  );
}

/** An interaction in the data's own units: the slope at a low and a high modifier level. */
function InteractionSlopes({ finding }: { finding: Finding }) {
  const d = finding.details as {
    focus?: string;
    modifier?: string;
    modifier_low?: number;
    modifier_high?: number;
    slope_at_low?: number;
    slope_at_high?: number;
  };
  if (d.slope_at_low === undefined || d.slope_at_high === undefined)
    return null;
  const y = label(finding.outcome);
  return (
    <div className="mt-3 grid gap-2 sm:grid-cols-2">
      {(
        [
          ["low", d.modifier_low, d.slope_at_low],
          ["high", d.modifier_high, d.slope_at_high],
        ] as const
      ).map(([lvl, m, slope]) => (
        <div
          key={lvl}
          className="rounded-lg border border-line bg-surface-2 px-3 py-2"
        >
          <p className="text-xs text-muted">
            At {lvl} {label(d.modifier ?? "")} ({fmt(m, 3)},{" "}
            {lvl === "low" ? "10th" : "90th"} percentile)
          </p>
          <p className="text-sm text-ink">
            {y} changes by{" "}
            <strong className="tabular-nums">{fmt(slope, 3)}</strong> per unit
            of {label(d.focus ?? "")}
          </p>
        </div>
      ))}
      <p className="text-xs text-muted sm:col-span-2">
        Slopes from the fitted interaction model on the discovery data. The
        difference between them is the interaction.
      </p>
    </div>
  );
}

function Tr({ k, v }: { k: string; v: string }) {
  return (
    <tr className="border-b border-line last:border-0">
      <td className="py-1 text-muted">{k}</td>
      <td className="py-1 text-right tabular-nums text-ink">{v}</td>
    </tr>
  );
}

function ValidationBlock({
  title,
  v,
  extra,
}: {
  title: string;
  v?: Finding["validations"][number];
  extra?: React.ReactNode;
}) {
  if (!v) return null;
  return (
    <div className="text-sm">
      <p className="mb-1 font-medium text-ink">
        {title}{" "}
        <span className="font-normal text-muted">
          {v.passed === true
            ? "✓ passed"
            : v.passed === false
              ? "✕ failed"
              : "? inconclusive"}
        </span>
      </p>
      <p className="text-ink-2">{v.message}</p>
      {extra}
    </div>
  );
}

function ProbeCard({
  result,
  inline = false,
}: {
  result: ProbeResult;
  inline?: boolean;
}) {
  const v = VERDICT[result.verdict] ?? VERDICT.inconclusive;
  return (
    <div
      className={
        inline
          ? "mt-3 border-t border-line pt-3"
          : "rounded-lg border border-line p-3"
      }
    >
      {!inline && (
        <p className="mb-1 text-sm font-medium text-ink">{result.question}</p>
      )}
      <p
        className="flex items-center gap-1.5 text-xs font-medium"
        style={{ color: v.color }}
      >
        <span aria-hidden>{v.icon}</span> {v.text}
      </p>
      <p className="mt-1 text-sm text-ink-2">{result.summary}</p>
      {result.rows.length > 0 && (
        <div className="mt-2 overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="text-muted">
              <tr>
                {Object.keys(result.rows[0]).map((k) => (
                  <th key={k} className="py-1 pr-3 font-medium">
                    {label(k)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {result.rows.map((r, i) => (
                <tr key={i}>
                  {Object.values(r).map((val, j) => (
                    <td key={j} className="py-1 pr-3 tabular-nums text-ink-2">
                      {fmt(val, 3)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function PromoteCard({ finding }: { finding: Finding }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    statement: "",
    scientific_interpretation: "",
    fire_safety_relevance: "",
    limitations: "",
    reviewer: "",
    references: "",
  });
  const [areas, setAreas] = useState<SafetyArea[]>([]);
  const [others, setOthers] = useState<Finding[]>([]);
  const [related, setRelated] = useState<string[]>([]);
  const [msg, setMsg] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [tried, setTried] = useState(false);
  const [busy, setBusy] = useState(false);
  // the same minimums the server enforces, checked here so the reviewer sees them as they type
  const RULES: Record<string, number> = {
    statement: 10,
    scientific_interpretation: 10,
    fire_safety_relevance: 5,
    reviewer: 2,
  };
  const problem = (k: keyof typeof form) => {
    const min = RULES[k];
    if (!min) return null;
    const n = form[k].trim().length;
    if (n === 0) return "Required.";
    if (n < min) return `Please write at least ${min} characters (${n} so far).`;
    return null;
  };
  const invalid = (Object.keys(RULES) as (keyof typeof form)[]).filter((k) => problem(k));
  const blocked = finding.synthetic
    ? "Findings from synthetic test data can never become insights."
    : finding.status !== "validated"
      ? "Only validated findings can be promoted to an insight."
      : null;

  function start() {
    setOpen(true);
    api
      .findings({ dataset_id: finding.dataset_id, status: "validated" })
      .then((list) =>
        setOthers(list.filter((x) => x.finding_id !== finding.finding_id)),
      )
      .catch(() => setOthers([]));
  }

  const toggle = <T,>(list: T[], v: T) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  async function submit() {
    setTried(true);
    setMsg(null);
    if (invalid.length) {
      setMsg({ tone: "error", text: "Some fields need more detail; see the notes under them." });
      return;
    }
    setBusy(true);
    try {
      await api.promote(finding.finding_id, {
        ...form,
        references: form.references
          .split("\n")
          .map((r) => r.trim())
          .filter(Boolean),
        safety_areas: areas,
        related_finding_ids: related,
      });
      setMsg({ tone: "ok", text: "Saved as an insight. It is now listed on the Insights page." });
      setOpen(false);
    } catch (e) {
      setMsg({ tone: "error", text: `Could not save the insight: ${(e as Error).message}` });
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card title="From finding to insight" className="mt-4">
      <p className="text-sm text-ink-2">
        A finding is a statistical result. An insight is the deeper
        understanding a researcher builds from findings, the data and a
        scientific interpretation — and what it means for fire safety in space.
      </p>
      {!finding.prior_knowledge && !blocked && (
        <p className="mt-2 text-xs text-muted">
          Tip: check prior knowledge above first, so the insight says what is
          new.
        </p>
      )}
      {blocked ? (
        <p className="mt-2 text-sm text-muted">{blocked}</p>
      ) : !open ? (
        <Button className="mt-3" variant="ghost" onClick={start}>
          Promote to insight…
        </Button>
      ) : (
        <div className="mt-3 grid gap-3">
          {(
            [
              ["statement", "Insight statement"],
              [
                "scientific_interpretation",
                "Scientific interpretation: what it can mean for flame and combustion physics",
              ],
              [
                "limitations",
                "Limitations: what this interpretation does not show",
              ],
              [
                "fire_safety_relevance",
                "What it means for fire safety in space",
              ],
              ["reviewer", "Reviewer"],
              ["references", "References (one per line)"],
            ] as const
          ).map(([k, l]) => {
            const err = tried ? problem(k) : null;
            const min = RULES[k];
            return (
              <label key={k} className="text-sm">
                <span className="mb-1 flex justify-between gap-2 text-xs text-muted">
                  <span>
                    {l}
                    {min ? <span className="text-accent"> *</span> : <span> (optional)</span>}
                  </span>
                  {min ? (
                    <span className="tabular-nums">
                      {form[k].trim().length}/{min}+
                    </span>
                  ) : null}
                </span>
                <textarea
                  rows={k === "reviewer" ? 1 : 2}
                  value={form[k]}
                  onChange={(e) => setForm({ ...form, [k]: e.target.value })}
                  aria-invalid={!!err}
                  className="w-full rounded-md border bg-surface px-2 py-1.5"
                  style={{ borderColor: err ? "var(--critical)" : "var(--line)" }}
                />
                {err && (
                  <span className="mt-1 block text-xs" style={{ color: "var(--critical)" }}>
                    {err}
                  </span>
                )}
              </label>
            );
          })}
          <fieldset>
            <legend className="mb-1 text-xs text-muted">
              Where it could help
            </legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(SAFETY_AREAS) as SafetyArea[]).map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAreas(toggle(areas, a))}
                  className={`rounded-full border px-3 py-1 text-xs ${areas.includes(a) ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
                >
                  {SAFETY_AREAS[a]}
                </button>
              ))}
            </div>
          </fieldset>
          {others.length > 0 && (
            <fieldset>
              <legend className="mb-1 text-xs text-muted">
                Other findings this insight also rests on
              </legend>
              <ul className="max-h-40 space-y-1 overflow-y-auto text-sm">
                {others.map((o) => (
                  <li key={o.finding_id}>
                    <label className="flex items-start gap-2 text-ink-2">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={related.includes(o.finding_id)}
                        onChange={() =>
                          setRelated(toggle(related, o.finding_id))
                        }
                      />
                      {o.headline}
                    </label>
                  </li>
                ))}
              </ul>
            </fieldset>
          )}
          <div className="flex gap-2">
            <Button onClick={submit} disabled={busy}>
              {busy ? "Saving…" : "Save insight"}
            </Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
      {msg && (
        <p
          role={msg.tone === "error" ? "alert" : "status"}
          className="mt-2 text-sm"
          style={{ color: msg.tone === "error" ? "var(--critical)" : "var(--good)" }}
        >
          {msg.text}
        </p>
      )}
    </Card>
  );
}

/** A few supporting experiments that span the association, for the compare view. */
function pickContrastingExperiments(
  f: Finding,
  rows: Row[] | null,
  n = 6,
): string[] {
  const ids = new Set(f.evidence.experiment_ids);
  const usable = (rows ?? []).filter(
    (r) =>
      ids.has(String(r.experiment_id)) &&
      r[f.condition] != null &&
      r[f.outcome] != null,
  );
  if (!usable.length) return f.evidence.experiment_ids.slice(0, n);
  if (f.details.median_by_group || f.details.rate_by_group) {
    const byGroup = new Map<string, string[]>();
    for (const r of usable) {
      const g = String(r[f.condition]);
      byGroup.set(g, [...(byGroup.get(g) ?? []), String(r.experiment_id)]);
    }
    return [...byGroup.values()]
      .flatMap((list) => list.slice(0, 2))
      .slice(0, n);
  }
  const sorted = [...usable].sort(
    (a, b) => Number(a[f.condition]) - Number(b[f.condition]),
  );
  const half = Math.floor(n / 2);
  return [...sorted.slice(0, half), ...sorted.slice(-half)].map((r) =>
    String(r.experiment_id),
  );
}

function FindingSkeleton() {
  return (
    <div aria-busy="true">
      <Skeleton className="mb-5 h-4 w-32" />
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-3 w-40" />
        <Skeleton className="h-7 w-full max-w-lg" />
        <Skeleton className="h-5 w-72 max-w-full rounded-full" />
      </div>
      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="What was found" className="lg:col-span-2">
          <ChartSkeleton />
        </Card>
        <Card title="Statistics">
          <div className="grid grid-cols-2 gap-4">
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
            <StatSkeleton />
          </div>
          <div className="mt-5 border-t border-line pt-4">
            <TextSkeleton lines={4} />
          </div>
        </Card>
      </div>
      <Card title="Validation — is it real, or chance?" className="mt-4">
        <TextSkeleton lines={4} />
      </Card>
    </div>
  );
}
