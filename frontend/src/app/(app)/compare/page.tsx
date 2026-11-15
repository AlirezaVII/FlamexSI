"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { LoadingLabel, TableSkeleton } from "@/components/loading";
import {
  Button,
  Card,
  ErrorNote,
  NoDataset,
  PageHeader,
  SyntheticBanner,
} from "@/components/ui";
import { api, fmt, label } from "@/lib/api";
import type { CompareResult, CompareVariable, VarGroup } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

const GROUPS: { key: VarGroup; title: string; note: string }[] = [
  { key: "condition", title: "Conditions", note: "experiment set-up" },
  { key: "outcome", title: "Outcomes", note: "measured flame behaviour" },
  { key: "other", title: "Other columns", note: "not in the standard schema" },
];

export default function ComparePage() {
  const { dataset, compareIds, toggleCompare, clearCompare } = useWorkspace();
  const [result, setResult] = useState<CompareResult | null>(null);
  const [resultFor, setResultFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");
  const [onlyDiff, setOnlyDiff] = useState(false);

  const datasetId = dataset?.dataset_id;
  const key = `${datasetId}|${compareIds.join(",")}`;

  useEffect(() => {
    if (!datasetId || compareIds.length === 0) return;
    api
      .compare(datasetId, compareIds)
      .then((r) => {
        setResult(r);
        setResultFor(key);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [datasetId, compareIds, key]);

  if (!dataset) return <NoDataset />;
  const fetching = compareIds.length > 0 && resultFor !== key && !error;
  const shown = compareIds.length && result ? result : null;

  return (
    <>
      <PageHeader eyebrow="Compare" title="Compare experiments">
        Conditions and outcomes side by side, built from whatever variables the
        dataset has. Variables that differ between the selected experiments are
        marked; repeated measurements show their mean, spread and count instead
        of hiding behind an average.
      </PageHeader>
      {dataset.synthetic && <SyntheticBanner />}

      <Card
        title={`${compareIds.length} selected`}
        action={
          compareIds.length > 0 && (
            <Button variant="ghost" onClick={clearCompare}>
              Clear
            </Button>
          )
        }
      >
        <form
          className="mb-4 flex flex-wrap gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            manual
              .split(/[\s,]+/)
              .filter((id) => id && !compareIds.includes(id))
              .forEach(toggleCompare);
            setManual("");
          }}
        >
          <input
            value={manual}
            onChange={(e) => setManual(e.target.value)}
            placeholder="Add experiment IDs, comma separated"
            className="w-full max-w-md rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
          />
          <Button type="submit" variant="ghost">
            Add
          </Button>
          {shown && (
            <label className="ml-auto flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={onlyDiff}
                onChange={(e) => setOnlyDiff(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Only variables that differ
            </label>
          )}
        </form>

        {error && <ErrorNote message={error} />}
        {compareIds.length === 0 ? (
          <p className="text-sm text-ink-2">
            Select experiments in the{" "}
            <Link href="/explorer" className="font-medium text-accent">
              explorer
            </Link>
            , open them from a finding&apos;s evidence, or add IDs above.
          </p>
        ) : fetching && !result ? (
          <div className="space-y-4" aria-busy="true">
            <TableSkeleton
              rows={10}
              cols={Math.min(compareIds.length + 1, 6)}
            />
            <LoadingLabel>
              Loading {compareIds.length} experiments…
            </LoadingLabel>
          </div>
        ) : (
          shown && (
            <div
              className={`transition-opacity ${fetching ? "opacity-50" : "fade-in"}`}
              aria-busy={fetching}
            >
              {shown.missing.length > 0 && (
                <p className="mb-3 text-xs text-muted">
                  Not found in this dataset: {shown.missing.join(", ")}
                </p>
              )}
              <Twins result={shown} />
              {GROUPS.map((g) => {
                const vars = shown.variables.filter(
                  (v) => v.group === g.key && (!onlyDiff || v.differs),
                );
                if (!vars.length) return null;
                return (
                  <section key={g.key} className="mt-5">
                    <h3 className="mb-2 text-sm font-semibold text-ink">
                      {g.title}{" "}
                      <span className="font-normal text-muted">· {g.note}</span>
                    </h3>
                    <div className="overflow-x-auto">
                      <table className="w-full text-left text-sm">
                        <thead>
                          <tr className="text-xs text-muted">
                            <th className="py-2 pr-4 font-medium">Variable</th>
                            {shown.experiments.map((id) => (
                              <th
                                key={id}
                                className="whitespace-nowrap py-2 pr-4 font-medium"
                              >
                                <span className="text-ink">{id}</span>
                                <button
                                  className="ml-1.5 text-muted hover:text-ink"
                                  aria-label={`Remove ${id}`}
                                  onClick={() => toggleCompare(id)}
                                >
                                  ×
                                </button>
                              </th>
                            ))}
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-line">
                          {vars.map((v) => (
                            <VarRow
                              key={v.name}
                              v={v}
                              ids={shown.experiments}
                            />
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </section>
                );
              })}
            </div>
          )
        )}
      </Card>
    </>
  );
}

function VarRow({ v, ids }: { v: CompareVariable; ids: string[] }) {
  return (
    <tr className={v.differs ? "" : "text-muted"}>
      <td className="py-1.5 pr-4 text-ink-2">
        {label(v.name)}
        {v.unit && <span className="text-xs text-muted"> ({v.unit})</span>}
        {v.differs && (
          <span className="ml-1.5 rounded bg-surface-2 px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-accent">
            differs
          </span>
        )}
      </td>
      {ids.map((id) => {
        const c = v.values[id];
        if (!c || c.n === 0)
          return (
            <td key={id} className="py-1.5 pr-4">
              —
            </td>
          );
        if (v.kind === "numeric") {
          return (
            <td
              key={id}
              className={`whitespace-nowrap py-1.5 pr-4 tabular-nums ${v.differs ? "font-medium text-ink" : ""}`}
              title={
                c.n > 1 ? `min ${fmt(c.min)} · max ${fmt(c.max)}` : undefined
              }
            >
              {fmt(c.mean)}
              {c.n > 1 && (
                <span className="ml-1 text-xs font-normal text-muted">
                  ± {fmt(c.std ?? 0, 2)} (n={c.n})
                </span>
              )}
            </td>
          );
        }
        return (
          <td
            key={id}
            className={`py-1.5 pr-4 ${v.differs ? "font-medium text-ink" : ""}`}
          >
            {(c.values ?? []).join(", ") || "—"}
            {c.n > 1 && (
              <span className="ml-1 text-xs font-normal text-muted">
                (n={c.n})
              </span>
            )}
          </td>
        );
      })}
    </tr>
  );
}

function Twins({ result }: { result: CompareResult }) {
  const twins = result.similar_conditions_different_outcomes;
  if (!twins.length) return null;
  return (
    <div className="mb-2 rounded-lg border border-line bg-surface-2 p-3 text-sm">
      <p className="font-medium text-ink">
        Similar conditions, different outcome ({twins.length})
      </p>
      <p className="mb-2 text-xs text-muted">
        Every compared condition is within 10% of its range, yet an outcome
        differs by more than 25% of its range. Pairs like these can be worth a
        closer look in Discovery.
      </p>
      <ul className="space-y-1 text-ink-2">
        {twins.map((t) => (
          <li key={`${t.a}-${t.b}`}>
            <strong className="text-ink">{t.a}</strong> vs{" "}
            <strong className="text-ink">{t.b}</strong> ({t.conditions_compared}{" "}
            conditions similar):{" "}
            {t.outcome_differences
              .map((d) => `${label(d.name)} ${fmt(d.a)} vs ${fmt(d.b)}`)
              .join("; ")}
          </li>
        ))}
      </ul>
    </div>
  );
}
