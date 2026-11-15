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
type Draft = Record<
  string,
  { min?: string; max?: string; value?: string; values?: string[] }
>;

// Filters are generated from the dataset's own columns, so new variables in a real NASA file
// get filters automatically. Conditions and outcomes stay separate.
const FILTER_GROUPS = [
  { key: "condition", title: "Conditions", note: "experiment set-up" },
  { key: "outcome", title: "Outcomes", note: "measured results" },
  { key: "other", title: "Other columns", note: "not in the standard schema" },
] as const;

const groupOf = (c: ColumnStats) =>
  c.role === "condition"
    ? "condition"
    : c.role === "outcome"
      ? "outcome"
      : "other";

function toFilters(draft: Draft, columns: ColumnStats[]): Filter[] {
  const out: Filter[] = [];
  for (const c of columns) {
    const d = draft[c.name];
    if (!d) continue;
    if (d.min) out.push({ field: c.name, op: "gte", value: Number(d.min) });
    if (d.max) out.push({ field: c.name, op: "lte", value: Number(d.max) });
    if (d.value) {
      const value = c.type === "boolean" ? d.value === "yes" : d.value;
      out.push({
        field: c.name,
        op: c.type === "text" ? "contains" : "eq",
        value,
      });
    }
    if (d.values?.length)
      out.push({ field: c.name, op: "in", value: d.values });
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
    () => columns.filter((c) => c.count > 0),
    [columns],
  );
  const visible = useMemo(() => columns.map((c) => c.name), [columns]);

  if (!dataset) return <NoDataset />;

  return (
    <>
      <PageHeader eyebrow="Explore" title="Experiment explorer">
        Find and filter experiments by any variable in the dataset — filters are
        generated from its columns. Exploring draws no conclusions; tick
        experiments to compare them, and use Discover to look for associations.
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
              FILTER_GROUPS.map((g) => {
                const cols = filterable.filter((c) => groupOf(c) === g.key);
                if (!cols.length) return null;
                return (
                  <div
                    key={g.key}
                    className="space-y-3 border-t border-line pt-3 first:border-0 first:pt-0"
                  >
                    <p className="text-xs font-semibold uppercase tracking-wider text-muted">
                      {g.title}{" "}
                      <span className="font-normal normal-case tracking-normal">
                        · {g.note}
                      </span>
                    </p>
                    {cols.map((c) => (
                      <FilterField
                        key={c.name}
                        c={c}
                        d={draft[c.name] ?? {}}
                        set={(patch) =>
                          setDraft((d) => ({
                            ...d,
                            [c.name]: { ...d[c.name], ...patch },
                          }))
                        }
                      />
                    ))}
                  </div>
                );
              })}
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

function FilterField({
  c,
  d,
  set,
}: {
  c: ColumnStats;
  d: Draft[string];
  set: (patch: Draft[string]) => void;
}) {
  const legend = (
    <legend className="mb-1 text-xs font-medium text-ink-2">
      {label(c.name)} {c.unit && <span className="text-muted">({c.unit})</span>}
      {!c.known && <span className="ml-1 text-muted">· from file</span>}
    </legend>
  );
  if (c.type === "numeric") {
    return (
      <fieldset>
        {legend}
        <div className="flex items-center gap-2">
          {(["min", "max"] as const).map((k, i) => (
            <span key={k} className="contents">
              {i === 1 && <span className="text-xs text-muted">to</span>}
              <input
                type="number"
                step="any"
                placeholder={fmt(c[k])}
                aria-label={`${c.name} ${k}`}
                value={d[k] ?? ""}
                onChange={(e) => set({ [k]: e.target.value })}
                className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm"
              />
            </span>
          ))}
        </div>
      </fieldset>
    );
  }
  if (c.type === "boolean") {
    return (
      <fieldset>
        {legend}
        <select
          aria-label={c.name}
          value={d.value ?? ""}
          onChange={(e) => set({ value: e.target.value })}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm"
        >
          <option value="">any</option>
          <option value="yes">yes</option>
          <option value="no">no</option>
        </select>
      </fieldset>
    );
  }
  const options = Object.keys(c.top_values ?? {});
  if (c.type === "text" || options.length > 12) {
    return (
      <fieldset>
        {legend}
        <input
          type="search"
          placeholder="contains…"
          aria-label={`${c.name} contains`}
          value={d.value ?? ""}
          onChange={(e) => set({ value: e.target.value })}
          className="w-full rounded-md border border-line bg-surface px-2 py-1 text-sm"
        />
      </fieldset>
    );
  }
  const chosen = new Set(d.values ?? []);
  return (
    <fieldset>
      {legend}
      <div className="flex flex-wrap gap-1.5">
        {options.map((o) => (
          <label
            key={o}
            className={`cursor-pointer rounded-full border px-2.5 py-0.5 text-xs ${chosen.has(o) ? "border-accent bg-surface-2 text-ink" : "border-line text-ink-2"}`}
          >
            <input
              type="checkbox"
              className="sr-only"
              checked={chosen.has(o)}
              onChange={() => {
                const next = new Set(chosen);
                if (next.has(o)) next.delete(o);
                else next.add(o);
                set({ values: [...next] });
              }}
            />
            {o}
          </label>
        ))}
      </div>
    </fieldset>
  );
}
