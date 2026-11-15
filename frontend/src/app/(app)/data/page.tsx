"use client";

import { useEffect, useState } from "react";
import { Skeleton, TableSkeleton } from "@/components/loading";
import {
  Button,
  Card,
  ErrorNote,
  PageHeader,
  SyntheticBanner,
} from "@/components/ui";
import { api, fmt } from "@/lib/api";
import { DataQuality } from "@/components/data-quality";
import type { DatasetDetail, Meta, Quality } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

export default function DataPage() {
  const { dataset, refresh, selectDataset } = useWorkspace();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState<number | null>(null); // upload progress, 0..1
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [quality, setQuality] = useState<Quality | null>(null);
  const [qualityFor, setQualityFor] = useState<string | null>(null);
  const [append, setAppend] = useState(false);

  useEffect(() => {
    api
      .meta()
      .then(setMeta)
      .catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!dataset) return;
    api
      .dataset(dataset.dataset_id)
      .then(setDetail)
      .catch((e) => setError(e.message));
    api
      .quality(dataset.dataset_id)
      .then((q) => {
        setQuality(q);
        setQualityFor(dataset.dataset_id);
      })
      .catch((e) => setError(e.message));
  }, [dataset]);

  async function run(action: () => Promise<string | null>) {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const id = await action();
      await refresh();
      if (id) selectDataset(id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const upload = () =>
    run(async () => {
      if (!file) return null;
      const into =
        append && dataset && !dataset.synthetic ? dataset.dataset_id : null;
      const onProgress = (done: number, total: number) => setSent(done / total);
      setSent(0);
      try {
        const res = into
          ? await api.addSource(into, file, onProgress)
          : await api.upload(file, undefined, onProgress);
        if (!res.dataset) {
          setNotice(
            `Stored ${res.source.filename} as footage. Analyse it on the Footage page.`,
          );
          return null;
        }
        return res.dataset.dataset_id;
      } finally {
        setSent(null);
      }
    });

  const flex = () => run(async () => (await api.loadFlex()).dataset.dataset_id);
  const synthetic = () =>
    run(
      async () =>
        (await api.createSynthetic(300, Date.now() % 1000)).dataset.dataset_id,
    );

  return (
    <>
      <PageHeader eyebrow="Data" title="Load experiment data">
        NASA file → stored unchanged → standardized (units, names, types) →
        quality checks → standard variables plus every original column → ready
        for analysis. Every row keeps a link to the file it came from, and every
        change is listed with its reason.
      </PageHeader>

      <div className="grid gap-4 md:grid-cols-2">
        <Card title="Upload NASA data">
          <input
            type="file"
            accept={meta?.file_types.map((t) => `.${t}`).join(",")}
            onChange={(e) => setFile(e.target.files?.[0] ?? null)}
            className="block w-full text-sm text-ink-2 file:mr-3 file:rounded-md file:border file:border-line file:bg-surface-2 file:px-3 file:py-1.5 file:text-ink"
          />
          <p className="mt-2 text-xs text-muted">
            Supported:{" "}
            {meta ? (
              meta.file_types.join(", ")
            ) : (
              <span
                aria-hidden
                className="skeleton inline-block h-3 w-48 align-middle"
              />
            )}
          </p>
          {dataset && !dataset.synthetic && (
            <label className="mt-3 flex items-center gap-2 text-sm text-ink-2">
              <input
                type="checkbox"
                checked={append}
                onChange={(e) => setAppend(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              Add to “{dataset.name}” (rows link to experiments by their
              experiment ID)
            </label>
          )}
          {sent !== null && (
            <div className="mt-3" role="status" aria-live="polite">
              <div className="h-1.5 overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${Math.round(sent * 100)}%` }} />
              </div>
              <p className="mt-1 text-xs text-muted">
                {sent < 1 ? `Uploading… ${Math.round(sent * 100)}%` : "Reading and standardizing on the server…"}
              </p>
            </div>
          )}
          <Button className="mt-4" onClick={upload} disabled={!file || busy}>
            {busy ? "Working…" : "Upload & standardize"}
          </Button>
        </Card>

        <Card title="NASA flight data: FLEX (PSI-69)">
          <p className="text-sm text-ink-2">
            The Flame Extinguishment Experiment&apos;s experimental table from NASA&apos;s
            Physical Sciences Informatics repository: 274 heptane and methanol droplet
            tests on the ISS with oxygen, pressure, diluent (CO₂, helium) and measured
            burning rate, burn time and extinction diameters. Loaded as published.
          </p>
          <Button className="mt-4" onClick={flex} disabled={busy}>
            Load the FLEX table
          </Button>
        </Card>

        <Card title="Synthetic test data">
          <p className="text-sm text-ink-2">
            Synthetic test data — not NASA laboratory data. Contains planted
            relationships plus pure noise and a spurious variable, to check that
            the engine finds real signal and does not report what is not there.
            Always kept separate from real data and never eligible to become an
            insight.
          </p>
          <Button
            variant="ghost"
            className="mt-4"
            onClick={synthetic}
            disabled={busy}
          >
            Generate 300 synthetic experiments
          </Button>
        </Card>
      </div>

      <div className="mt-4 space-y-4">
        {error && <ErrorNote message={error} />}
        {notice && <p className="text-sm text-ink-2">{notice}</p>}
      </div>

      {dataset &&
        (!detail || detail.dataset.dataset_id !== dataset.dataset_id) &&
        !error && (
          <div className="mt-8 space-y-4" aria-busy="true">
            <Card title={`Variables in “${dataset.name}”`}>
              <TableSkeleton rows={8} cols={6} />
            </Card>
            <Card title="Pipeline report & provenance">
              <div className="space-y-2.5">
                <Skeleton className="h-4 w-2/3" />
                <div className="flex flex-wrap gap-1.5">
                  {Array.from({ length: 9 }, (_, i) => (
                    <Skeleton key={i} className="h-5 w-24" />
                  ))}
                </div>
              </div>
            </Card>
          </div>
        )}

      {dataset &&
        detail &&
        detail.dataset.dataset_id === dataset.dataset_id && (
          <div className="fade-in mt-8 space-y-4">
            {dataset.synthetic && <SyntheticBanner />}
            {quality && qualityFor === dataset.dataset_id ? (
              <DataQuality q={quality} />
            ) : (
              <Card title="Data quality">
                <TableSkeleton rows={4} cols={4} />
              </Card>
            )}
            <Card title={`Variables in “${dataset.name}”`}>
              <div className="overflow-x-auto">
                <table className="w-full text-left text-sm">
                  <thead className="text-xs text-muted">
                    <tr>
                      <th className="py-2 pr-4 font-medium">Variable</th>
                      <th className="py-2 pr-4 font-medium">Role</th>
                      <th className="py-2 pr-4 font-medium">Unit</th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Values
                      </th>
                      <th className="py-2 pr-4 text-right font-medium">
                        Missing
                      </th>
                      <th className="py-2 font-medium">Range / top values</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {detail.columns.map((c) => (
                      <tr key={c.name}>
                        <td className="py-2 pr-4 font-medium">
                          {c.name}
                          {!c.known && (
                            <span className="ml-1 text-xs text-muted">
                              (unmapped)
                            </span>
                          )}
                        </td>
                        <td className="py-2 pr-4 text-ink-2">
                          {c.role ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-ink-2">
                          {c.unit ?? "—"}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {c.count}
                        </td>
                        <td className="py-2 pr-4 text-right tabular-nums">
                          {c.missing}
                        </td>
                        <td className="py-2 text-ink-2">
                          {c.min !== undefined
                            ? `${fmt(c.min)} – ${fmt(c.max)} (mean ${fmt(c.mean)})`
                            : Object.keys(c.top_values ?? {})
                                .slice(0, 5)
                                .join(", ")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>

            <Card title="Pipeline report & provenance">
              {dataset.report.tables.map((t) => (
                <div key={t.table} className="mb-4 text-sm last:mb-0">
                  <p className="text-ink-2">
                    <strong className="text-ink">{t.table}</strong>: {t.rows_in}{" "}
                    rows in → {t.rows_out} out ({t.empty_rows_dropped} empty,{" "}
                    {t.duplicate_rows_dropped} duplicate dropped)
                  </p>
                  <ul className="mt-2 flex flex-wrap gap-1.5">
                    {t.columns.map((c) => (
                      <li
                        key={c.raw}
                        className="rounded border border-line px-2 py-0.5 text-xs text-ink-2"
                      >
                        {c.raw} → {c.canonical}
                        {c.unit_from && ` (from ${c.unit_from})`}
                      </li>
                    ))}
                  </ul>
                  {t.warnings.map((w) => (
                    <p key={w} className="mt-2 text-xs text-ink-2">
                      Warning: {w}
                    </p>
                  ))}
                </div>
              ))}
              <ul className="mt-3 divide-y divide-line border-t border-line text-xs text-muted">
                {detail.sources.map((s) => {
                  const ingestion = detail.dataset.report.ingestion?.find(
                    (item) => item.source_id === s.source_id,
                  );
                  return (
                    <li key={s.source_id} className="py-3">
                      <div className="flex flex-wrap gap-x-3 gap-y-1">
                        <span className="font-medium text-ink-2">{s.filename}</span>
                        <span>{s.media_type}</span>
                        <span>{s.size_bytes.toLocaleString()} bytes</span>
                        <span>Ingested {new Date(s.ingested_at).toLocaleString()}</span>
                      </div>
                      {(ingestion?.encoding || ingestion?.adapter) && (
                        <p className="mt-1 text-ink-2">
                          {ingestion.encoding && `Encoding: ${ingestion.encoding}`}
                          {ingestion.encoding && ingestion.adapter && " · "}
                          {ingestion.adapter && `Adapter: ${ingestion.adapter}`}
                        </p>
                      )}
                      {ingestion?.missing_markers && (
                        <p className="mt-1">
                          Missing markers retained as missing: {ingestion.missing_markers.join(" ")}
                        </p>
                      )}
                      <code className="mt-1 block break-all leading-5">
                        SHA-256 {s.sha256}
                      </code>
                    </li>
                  );
                })}
              </ul>
            </Card>
          </div>
        )}
    </>
  );
}
