"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { LoadingLabel, Skeleton, TableSkeleton } from "@/components/loading";
import {
  Button,
  Card,
  ErrorNote,
  NoDataset,
  PageHeader,
  SyntheticBanner,
} from "@/components/ui";
import { api, fmt, label } from "@/lib/api";
import type { ColumnStats, Filter, Row } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

const PAGE = 50;
type Draft = Record<string, { min?: string; max?: string; value?: string }>;

function toFilters(draft: Draft, columns: ColumnStats[]): Filter[] {
  const out: Filter[] = [];
  for (const c of columns) {
    const d = draft[c.name];
    if (!d) continue;
    if (d.min) out.push({ field: c.name, op: "gte", value: Number(d.min) });
    if (d.max) out.push({ field: c.name, op: "lte", value: Number(d.max) });
    if (d.value) {
      const value = c.type === "boolean" ? d.value === "yes" : d.value;
      out.push({ field: c.name, op: "eq", value });
    }
  }
  return out;
}

export default function ExplorerPage() {
  const { dataset, compareIds, toggleCompare } = useWorkspace();
  const [columns, setColumns] = useState<ColumnStats[]>([]);
  const [draft, setDraft] = useState<Draft>({});
  const [filters, setFilters] = useState<Filter[]>([]);
  const [rows, setRows] = useState<Row[]>([]);
  const [total, setTotal] = useState<number | null>(null);
  const [offset, setOffset] = useState(0);
  const [sort, setSort] = useState<{ col: string; desc: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  // Which request the current data belongs to; a mismatch means a fetch is in flight.
  const [columnsFor, setColumnsFor] = useState<string | null>(null);
  const [rowsFor, setRowsFor] = useState<string | null>(null);

  const datasetId = dataset?.dataset_id;

  useEffect(() => {
    if (!datasetId) return;
    api
      .dataset(datasetId)
      .then((d) => {
        setColumns(d.columns);
        setColumnsFor(datasetId);
        setDraft({});
        setFilters([]);
        setOffset(0);
      })
      .catch((e) => setError(e.message));
  }, [datasetId]);

  const queryKey = JSON.stringify([datasetId, filters, offset, sort]);

  useEffect(() => {
    if (!datasetId) return;
    api
      .query(datasetId, {
        filters,
        limit: PAGE,
        offset,
        sort: sort?.col,
        descending: sort?.desc,
      })
      .then((r) => {
        setRows(r.rows);
        setTotal(r.total);
        setRowsFor(queryKey);
        setError(null);
      })
      .catch((e) => setError(e.message));
  }, [datasetId, filters, offset, sort, queryKey]);

  const columnsLoading = columnsFor !== datasetId;
  const firstLoad = rowsFor === null || columnsLoading;
  const refetching = !firstLoad && rowsFor !== queryKey;

  const filterable = useMemo(
    () => columns.filter((c) => c.role === "condition" || c.role === "outcome"),
    [columns],
  );
  const visible = useMemo(() => columns.map((c) => c.name), [columns]);

  if (!dataset) return <NoDataset />;

  const set = (name: string, key: "min" | "max" | "value", v: string) =>
    setDraft((d) => ({ ...d, [name]: { ...d[name], [key]: v } }));

  return (
    <>
      <PageHeader eyebrow="Explore" title="Experiment explorer">
        Filter experiments by their conditions and outcomes. Tick experiments to
        compare them.
      </PageHeader>
      {dataset.synthetic && <SyntheticBanner />}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[260px_1fr] [&>*]:min-w-0">
        <Card
          title={`Filters${filters.length ? ` (${filters.length})` : ""}`}
          className="h-fit"
          action={
            <Button
              variant="ghost"
              className="lg:hidden"
              aria-expanded={showFilters}
              onClick={() => setShowFilters((s) => !s)}
            >
              {showFilters ? "Hide" : "Show"}
            </Button>
          }
        >
          <form
            className={`space-y-3 ${showFilters ? "" : "hidden"} lg:block`}
            onSubmit={(e) => {
              e.preventDefault();
              setOffset(0);
              setFilters(toFilters(draft, columns));
            }}
          >
            {columnsLoading &&
              Array.from({ length: 6 }, (_, i) => (
                <div key={i} className="space-y-1.5" aria-hidden>
                  <Skeleton className="h-3 w-24" />
                  <Skeleton className="h-7 w-full" />
                </div>
              ))}
            {!columnsLoading &&
              filterable.map((c) => (
                <fieldset key={c.name}>
                  <legend className="mb-1 text-xs font-medium text-ink-2">
                    {label(c.name)}{" "}
                    {c.unit && <span className="text-muted">({c.unit})</span>}
                  </legend>
                  {c.type === "numeric" ? (
                    <div className="flex gap-2">
                      {(["min", "max"] as const).map((k) => (
                        <input
                          key={k}
                          type="number"
                          step="any"
                          placeholder={`${k} ${fmt(c[k])}`}
                          aria-label={`${c.name} ${k}`}
                          value={draft[c.name]?.[k] ?? ""}
                          onChange={(e) => set(c.name, k, e.target.value)}
                          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm"
                        />
                      ))}
                    </div>
                  ) : (
                    <select
                      aria-label={c.name}
                      value={draft[c.name]?.value ?? ""}
                      onChange={(e) => set(c.name, "value", e.target.value)}
                      className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm"
                    >
                      <option value="">any</option>
                      {c.type === "boolean"
                        ? ["yes", "no"].map((v) => <option key={v}>{v}</option>)
                        : Object.keys(c.top_values ?? {}).map((v) => (
                            <option key={v}>{v}</option>
                          ))}
                    </select>
                  )}
                </fieldset>
              ))}
            <div className="flex gap-2 pt-1">
              <Button type="submit">Apply</Button>
              <Button
                type="button"
                variant="ghost"
                onClick={() => {
                  setDraft({});
                  setFilters([]);
                  setOffset(0);
                }}
              >
                Reset
              </Button>
            </div>
          </form>
        </Card>

        <Card
          title={
            firstLoad ? (
              <Skeleton className="h-4 w-32" />
            ) : (
              `${total} matching rows`
            )
          }
          action={
            compareIds.length > 0 && (
              <Link href="/compare" className="text-sm font-medium text-accent">
                Compare {compareIds.length} →
              </Link>
            )
          }
        >
          {error && <ErrorNote message={error} />}
          {firstLoad && !error ? (
            <div className="space-y-4" aria-busy="true">
              <TableSkeleton rows={10} cols={7} />
              <LoadingLabel>Loading experiments…</LoadingLabel>
            </div>
          ) : (
            <div
              className={`overflow-x-auto transition-opacity ${refetching ? "pointer-events-none opacity-50" : "fade-in"}`}
              aria-busy={refetching}
            >
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-2 pr-2" />
                    {visible.map((col) => (
                      <th
                        key={col}
                        className="py-2 pr-4 font-medium whitespace-nowrap"
                      >
                        <button
                          className="hover:text-ink"
                          onClick={() =>
                            setSort((s) => ({
                              col,
                              desc: s?.col === col ? !s.desc : false,
                            }))
                          }
                        >
                          {label(col)}
                          {sort?.col === col && (sort.desc ? " ↓" : " ↑")}
                        </button>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {rows.map((r, i) => {
                    const id = String(r.experiment_id ?? "");
                    return (
                      <tr key={`${id}-${i}`} className="hover:bg-surface-2">
                        <td className="py-1.5 pr-2">
                          <input
                            type="checkbox"
                            aria-label={`Compare ${id}`}
                            checked={compareIds.includes(id)}
                            onChange={() => toggleCompare(id)}
                          />
                        </td>
                        {visible.map((col) => (
                          <td
                            key={col}
                            className="py-1.5 pr-4 whitespace-nowrap tabular-nums"
                          >
                            {fmt(r[col])}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between text-sm text-ink-2">
            <span>
              {!total ? 0 : offset + 1}–{Math.min(offset + PAGE, total ?? 0)} of{" "}
              {total ?? 0}
            </span>
            <div className="flex gap-2">
              <Button
                variant="ghost"
                disabled={offset === 0}
                onClick={() => setOffset(Math.max(0, offset - PAGE))}
              >
                Previous
              </Button>
              <Button
                variant="ghost"
                disabled={offset + PAGE >= (total ?? 0)}
                onClick={() => setOffset(offset + PAGE)}
              >
                Next
              </Button>
            </div>
          </div>
        </Card>
      </div>
    </>
  );
}
