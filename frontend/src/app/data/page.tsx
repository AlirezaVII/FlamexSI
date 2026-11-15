"use client";

import { useEffect, useState } from "react";
import { Button, Card, ErrorNote, PageHeader, SyntheticBanner } from "@/components/ui";
import { api, fmt } from "@/lib/api";
import type { DatasetDetail, Meta } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

export default function DataPage() {
  const { dataset, refresh, selectDataset } = useWorkspace();
  const [meta, setMeta] = useState<Meta | null>(null);
  const [detail, setDetail] = useState<DatasetDetail | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    api.meta().then(setMeta).catch((e) => setError(e.message));
  }, []);

  useEffect(() => {
    if (!dataset) return;
    api.dataset(dataset.dataset_id).then(setDetail).catch((e) => setError(e.message));
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
      const res = await api.upload(file);
      if (!res.dataset) {
        setNotice(`Stored ${res.source.filename} as media. Media analysis is not enabled yet.`);
        return null;
      }
      return res.dataset.dataset_id;
    });

  const synthetic = () =>
    run(async () => (await api.createSynthetic(300, Date.now() % 1000)).dataset.dataset_id);

  return (
    <>
      <PageHeader eyebrow="Data" title="Load experiment data">
        Files are stored unchanged, then cleaned and mapped onto the canonical variables (units
        converted). Every row keeps a link to the file it came from.
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
            Supported: {meta?.file_types.join(", ") ?? "…"}
          </p>
          <Button className="mt-4" onClick={upload} disabled={!file || busy}>
            {busy ? "Working…" : "Upload & standardize"}
          </Button>
        </Card>

        <Card title="Synthetic test data">
          <p className="text-sm text-ink-2">
            Generates fake experiments with a few planted relationships, to check that the
            engine finds real signal and rejects noise. Not for scientific conclusions.
          </p>
          <Button variant="ghost" className="mt-4" onClick={synthetic} disabled={busy}>
            Generate 300 synthetic experiments
          </Button>
        </Card>
      </div>

      <div className="mt-4 space-y-4">
        {error && <ErrorNote message={error} />}
        {notice && <p className="text-sm text-ink-2">{notice}</p>}
      </div>

      {dataset && detail && detail.dataset.dataset_id === dataset.dataset_id && (
        <div className="mt-8 space-y-4">
          {dataset.synthetic && <SyntheticBanner />}
          <Card title={`Variables in “${dataset.name}”`}>
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs text-muted">
                  <tr>
                    <th className="py-2 pr-4 font-medium">Variable</th>
                    <th className="py-2 pr-4 font-medium">Role</th>
                    <th className="py-2 pr-4 font-medium">Unit</th>
                    <th className="py-2 pr-4 text-right font-medium">Values</th>
                    <th className="py-2 pr-4 text-right font-medium">Missing</th>
                    <th className="py-2 font-medium">Range / top values</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-line">
                  {detail.columns.map((c) => (
                    <tr key={c.name}>
                      <td className="py-2 pr-4 font-medium">
                        {c.name}
                        {!c.known && <span className="ml-1 text-xs text-muted">(unmapped)</span>}
                      </td>
                      <td className="py-2 pr-4 text-ink-2">{c.role ?? "—"}</td>
                      <td className="py-2 pr-4 text-ink-2">{c.unit ?? "—"}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.count}</td>
                      <td className="py-2 pr-4 text-right tabular-nums">{c.missing}</td>
                      <td className="py-2 text-ink-2">
                        {c.min !== undefined
                          ? `${fmt(c.min)} – ${fmt(c.max)} (mean ${fmt(c.mean)})`
                          : Object.keys(c.top_values ?? {}).slice(0, 5).join(", ")}
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
                  <strong className="text-ink">{t.table}</strong>: {t.rows_in} rows in →{" "}
                  {t.rows_out} out ({t.empty_rows_dropped} empty, {t.duplicate_rows_dropped}{" "}
                  duplicate dropped)
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
                    ⚠ {w}
                  </p>
                ))}
              </div>
            ))}
            <ul className="mt-3 border-t border-line pt-3 text-xs text-muted">
              {detail.sources.map((s) => (
                <li key={s.source_id}>
                  Source: <span className="text-ink-2">{s.filename}</span> · sha256{" "}
                  <code>{s.sha256.slice(0, 16)}…</code>
                </li>
              ))}
            </ul>
          </Card>
        </div>
      )}
    </>
  );
}
