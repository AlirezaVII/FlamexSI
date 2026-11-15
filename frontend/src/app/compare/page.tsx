"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, NoDataset, PageHeader, SyntheticBanner } from "@/components/ui";
import { api, fmt, label } from "@/lib/api";
import type { Row } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

export default function ComparePage() {
  const { dataset, compareIds, toggleCompare, clearCompare } = useWorkspace();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [manual, setManual] = useState("");

  const datasetId = dataset?.dataset_id;
  const key = compareIds.join(",");

  useEffect(() => {
    if (!datasetId || !key) return;
    api
      .compare(datasetId, key.split(","))
      .then((r) => {
        setRows(r.experiments);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [datasetId, key]);

  if (!dataset) return <NoDataset />;
  const shown = compareIds.length ? rows : [];
  const fields = shown.length
    ? Object.keys(shown[0]).filter((k) => k !== "experiment_id")
    : [];

  return (
    <>
      <PageHeader eyebrow="Compare" title="Compare experiments">
        Side-by-side view of selected experiments. Rows with several measurements are averaged
        (n rows shows how many).
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
          className="mb-4 flex gap-2"
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
            placeholder="Add experiment IDs, e.g. SYN-0001, SYN-0002"
            className="w-full max-w-md rounded-md border border-line bg-surface px-3 py-1.5 text-sm"
          />
          <Button type="submit" variant="ghost">
            Add
          </Button>
        </form>

        {error && <ErrorNote message={error} />}
        {compareIds.length === 0 ? (
          <p className="text-sm text-ink-2">
            Select experiments in the{" "}
            <Link href="/explorer" className="font-medium text-accent">
              explorer
            </Link>{" "}
            or add IDs above.
          </p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead>
                <tr className="text-xs text-muted">
                  <th className="py-2 pr-4 font-medium">Variable</th>
                  {shown.map((r) => (
                    <th key={String(r.experiment_id)} className="py-2 pr-4 font-medium">
                      <span className="text-ink">{String(r.experiment_id)}</span>
                      <button
                        className="ml-1.5 text-muted hover:text-ink"
                        aria-label={`Remove ${r.experiment_id}`}
                        onClick={() => toggleCompare(String(r.experiment_id))}
                      >
                        ×
                      </button>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-line">
                {fields.map((f) => {
                  const values = shown.map((r) => r[f]);
                  const differs = new Set(values.map(String)).size > 1;
                  return (
                    <tr key={f}>
                      <td className="py-1.5 pr-4 text-ink-2">{label(f)}</td>
                      {values.map((v, i) => (
                        <td
                          key={i}
                          className={`py-1.5 pr-4 tabular-nums ${differs ? "font-medium text-ink" : "text-muted"}`}
                        >
                          {fmt(v)}
                        </td>
                      ))}
                    </tr>
                  );
                })}
              </tbody>
            </table>
            <p className="mt-3 text-xs text-muted">
              Values that differ between experiments are shown in bold.
            </p>
          </div>
        )}
      </Card>
    </>
  );
}
