"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useState } from "react";
import { GroupBars, ScatterChart } from "@/components/charts";
import {
  Button,
  Card,
  ErrorNote,
  PageHeader,
  Stat,
  StatusBadge,
  SyntheticBanner,
  statusHint,
} from "@/components/ui";
import { api, fmt, label } from "@/lib/api";
import type { Finding, Row } from "@/lib/types";

export default function FindingPage() {
  const { id } = useParams<{ id: string }>();
  const [finding, setFinding] = useState<Finding | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState<string | null>(null);

  useEffect(() => {
    api
      .finding(id)
      .then(async (f) => {
        setFinding(f);
        if (f.analyzer === "rank_correlation") {
          const r = await api.query(f.dataset_id, { limit: 5000 });
          setRows(r.rows);
        }
      })
      .catch((e) => setError(e.message));
  }, [id]);

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

  if (error) return <ErrorNote message={error} />;
  if (!finding) return <p className="text-sm text-muted">Loading…</p>;

  const f = finding;
  const groups = (f.details.median_by_group ?? f.details.rate_by_group) as
    | Record<string, number>
    | undefined;
  const ai = f.interpretation;

  return (
    <>
      <Link href="/relationships" className="mb-4 inline-block text-sm text-ink-2 hover:text-ink">
        ← All relationships
      </Link>
      <PageHeader eyebrow={`${label(f.condition)} → ${label(f.outcome)}`} title={f.headline}>
        <span className="inline-flex items-center gap-2">
          <StatusBadge status={f.status} /> {statusHint(f.status)}
        </span>
      </PageHeader>
      {f.synthetic && <SyntheticBanner />}

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Data" className="lg:col-span-2">
          {groups ? (
            <GroupBars
              values={groups}
              xLabel={label(f.condition)}
              yLabel={f.details.rate_by_group ? `${label(f.outcome)} rate` : `median ${label(f.outcome)}`}
            />
          ) : (
            <ScatterChart rows={rows} x={f.condition} y={f.outcome} />
          )}
        </Card>

        <Card title="Statistics">
          <div className="grid grid-cols-2 gap-4">
            <Stat label={label(f.effect_metric)} value={fmt(f.effect_size, 3)}
              hint="Effect size on the discovery split" />
            <Stat label="q-value (FDR)" value={fmt(f.q_value)}
              hint="p-value corrected for testing many relationships at once" />
            <Stat label="Discovery rows" value={f.n_train} />
            <Stat label="Rank score" value={fmt(f.score, 3)} />
          </div>
          <dl className="mt-4 space-y-1 border-t border-line pt-3 text-xs">
            {Object.entries(f.score_components).map(([k, v]) => (
              <div key={k} className="flex justify-between">
                <dt className="text-muted">{label(k)}</dt>
                <dd className="tabular-nums text-ink-2">{fmt(v, 2)}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-3 text-xs text-muted">{f.method}</p>
        </Card>
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-2">
        <Card title="Validation">
          {f.validations.length === 0 ? (
            <p className="text-sm text-ink-2">
              Not validated: the relationship was not significant in the discovery data.
            </p>
          ) : (
            <ul className="space-y-3">
              {f.validations.map((v) => (
                <li key={v.method} className="text-sm">
                  <p className="font-medium text-ink">
                    <span aria-hidden className="mr-1.5">
                      {v.passed === true ? "✓" : v.passed === false ? "✕" : "?"}
                    </span>
                    {label(v.method)}{" "}
                    <span className="font-normal text-muted">
                      ({v.passed === true ? "passed" : v.passed === false ? "failed" : "inconclusive"})
                    </span>
                  </p>
                  <p className="text-ink-2">{v.message}</p>
                  <p className="mt-0.5 text-xs text-muted">
                    {Object.entries(v.metrics)
                      .map(([k, m]) => `${label(k)} ${fmt(m)}`)
                      .join(" · ")}
                  </p>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card title="Evidence">
          <p className="text-sm text-ink-2">
            Based on <strong className="text-ink">{f.evidence.n_experiments}</strong> experiments
            ({f.evidence.n_rows} rows).
          </p>
          <ul className="mt-2 text-xs text-muted">
            {f.evidence.sources.map((s) => (
              <li key={s.source_id}>
                Source file: <span className="text-ink-2">{s.filename}</span> · sha256{" "}
                <code>{s.sha256.slice(0, 12)}…</code>
              </li>
            ))}
          </ul>
          <div className="mt-3 flex max-h-40 flex-wrap gap-1 overflow-y-auto">
            {f.evidence.experiment_ids.map((e) => (
              <span key={e} className="rounded border border-line px-1.5 py-0.5 text-xs text-ink-2">
                {e}
              </span>
            ))}
            {f.evidence.truncated && <span className="text-xs text-muted">…and more</span>}
          </div>
        </Card>
      </div>

      <Card
        className="mt-4"
        title="AI interpretation"
        action={
          <Button onClick={() => interpret(!!ai)} disabled={aiBusy} variant={ai ? "ghost" : "primary"}>
            {aiBusy ? "Thinking…" : ai ? "Regenerate" : "Explain this finding"}
          </Button>
        }
      >
        {aiError && <ErrorNote message={aiError} />}
        {ai ? (
          <div className="space-y-3 text-sm">
            <p className="font-medium text-ink">{ai.summary}</p>
            <p className="text-ink-2">{ai.interpretation}</p>
            <div className="rounded-lg border border-line bg-surface-2 p-3">
              <p className="text-xs font-medium uppercase tracking-wider text-accent">
                Fire safety hypothesis
              </p>
              <p className="mt-1 text-ink">{ai.safety_insight}</p>
            </div>
            {ai.caveats.length > 0 && (
              <ul className="list-disc space-y-0.5 pl-5 text-xs text-ink-2">
                {ai.caveats.map((c) => (
                  <li key={c}>{c}</li>
                ))}
              </ul>
            )}
            <p className="text-xs text-muted">
              Generated by {ai.provider} ({ai.model}) from the statistics above only. Check every
              statement against the evidence.
            </p>
          </div>
        ) : (
          <p className="text-sm text-ink-2">
            The AI explains the computed statistics and evidence in plain language. It does not
            create findings and cannot see anything beyond this page.
          </p>
        )}
      </Card>
    </>
  );
}
