"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { ListSkeleton } from "@/components/loading";
import { Card, ErrorNote, PageHeader, StatusBadge } from "@/components/ui";
import { NOVELTY } from "@/components/prior-knowledge";
import { api, fmt, label } from "@/lib/api";
import { SAFETY_AREAS } from "@/lib/labels";
import type { Insight } from "@/lib/types";

const STEPS = [
  "Data",
  "Statistical analysis",
  "Finding",
  "Validation on unseen data",
  "Evidence",
  "Prior knowledge",
  "Scientific interpretation",
  "Fire-safety insight",
  "Innovation",
];

export default function InsightsPage() {
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api
      .insights()
      .then(setInsights)
      .catch((e) => setError(e.message));
  }, []);

  return (
    <>
      <PageHeader eyebrow="Insights" title="Reviewed insights">
        An insight is not produced by the engine or the AI. It is a validated
        finding from real (non-synthetic) data that a researcher has reviewed,
        checked for other explanations and interpreted scientifically — and
        judged meaningful for fire safety.
      </PageHeader>

      <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted">
        {STEPS.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={
                i >= 6
                  ? "rounded-full bg-accent px-2 py-0.5 text-accent-ink"
                  : "text-ink-2"
              }
            >
              {s}
            </span>
            {i < STEPS.length - 1 && <span aria-hidden>→</span>}
          </li>
        ))}
      </ol>

      {error && <ErrorNote message={error} />}

      {insights === null ? (
        <Card>
          <ListSkeleton rows={2} />
        </Card>
      ) : insights.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-2">
            No insights yet. To create one, open a{" "}
            <Link href="/findings" className="font-medium text-accent">
              validated finding
            </Link>{" "}
            from real data, review its evidence and deep-analysis checks, and
            use <em>Promote to insight</em> to record the scientific
            interpretation and reviewer.
          </p>
          <p className="mt-2 text-xs text-muted">
            Findings from synthetic test data can never become insights.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          {insights.map((ins) => (
            <Card key={ins.insight_id} className="fade-in">
              <p className="font-display text-xl font-medium text-ink">
                {ins.statement}
              </p>
              <p className="mt-2 text-sm text-ink-2">
                {ins.scientific_interpretation}
              </p>
              {ins.limitations && (
                <p className="mt-2 text-sm text-ink-2">
                  <span className="text-muted">Limitations: </span>
                  {ins.limitations}
                </p>
              )}
              <div className="mt-3 rounded-lg border border-line bg-surface-2 p-3 text-sm">
                <p className="text-xs font-medium uppercase tracking-wider text-accent">
                  Fire safety relevance
                </p>
                <p className="mt-1 text-ink">{ins.fire_safety_relevance}</p>
                {(ins.safety_areas ?? []).length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {ins.safety_areas.map((a) => (
                      <span
                        key={a}
                        className="rounded-full border border-line px-2 py-0.5 text-xs text-ink-2"
                      >
                        {SAFETY_AREAS[a]}
                      </span>
                    ))}
                  </div>
                )}
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2 text-xs text-muted">
                <StatusBadge status={ins.finding_snapshot.status} />
                <span>
                  Based on:{" "}
                  <Link
                    href={`/findings/${ins.finding_id}`}
                    className="text-accent"
                  >
                    {ins.finding_snapshot.headline}
                  </Link>
                </span>
                <span>
                  · {label(ins.finding_snapshot.effect_metric)}{" "}
                  {fmt(ins.finding_snapshot.effect_size, 2)} ·{" "}
                  {ins.finding_snapshot.evidence.n_experiments} experiments
                </span>
                {ins.finding_snapshot.prior_knowledge && (
                  <span>
                    · prior work:{" "}
                    {
                      NOVELTY[ins.finding_snapshot.prior_knowledge.novelty]
                        .label
                    }
                  </span>
                )}
                {(ins.related_finding_ids ?? []).length > 0 && (
                  <span>
                    · +{ins.related_finding_ids.length} related finding
                    {ins.related_finding_ids.length > 1 ? "s" : ""}
                  </span>
                )}
                <span>
                  · reviewed by {ins.reviewer} on{" "}
                  {new Date(ins.created_at).toLocaleDateString()}
                </span>
              </div>
              {ins.references.length > 0 && (
                <ul className="mt-2 list-disc pl-5 text-xs text-ink-2">
                  {ins.references.map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
              <Link
                href={`/innovation?insight=${ins.insight_id}`}
                className="mt-3 inline-block text-sm font-medium text-accent"
              >
                What could this insight make possible? →
              </Link>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
