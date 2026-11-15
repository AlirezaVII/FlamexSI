"use client";

import { useCallback, useEffect, useState } from "react";
import { FlameOverlay } from "@/components/flame-overlay";
import { ListSkeleton, LoadingLabel } from "@/components/loading";
import {
  Button,
  Card,
  ErrorNote,
  PageHeader,
  Stat,
  SyntheticBanner,
} from "@/components/ui";
import { api, fmt } from "@/lib/api";
import type { FootageAnalysis, MediaItem } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

const input =
  "w-full rounded-md border border-line bg-surface px-2 py-1.5 text-sm text-ink";

export default function FootagePage() {
  const [items, setItems] = useState<MediaItem[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async (select?: string) => {
    try {
      const list = await api.media();
      setItems(list);
      setSelected((s) => select ?? s ?? list[0]?.source.source_id ?? null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    api
      .media()
      .then((list) => {
        setItems(list);
        setSelected(list[0]?.source.source_id ?? null);
      })
      .catch((e) => setError(e.message));
  }, []);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      const res = await api.uploadMedia(file);
      if (res.dataset) {
        setError(
          "That file is a table, not footage. Use the Data page for tables.",
        );
      }
      await load(res.source.source_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function synthetic() {
    setBusy(true);
    try {
      const res = await api.syntheticMedia();
      await load(res.source.source_id);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const item = items?.find((m) => m.source.source_id === selected);

  return (
    <>
      <PageHeader eyebrow="Flame footage" title="Footage analysis">
        Turns flame video or images into numbers, frame by frame: the flame
        outline&apos;s circularity Ψ (a proxy for sphericity), its equivalent
        radius and growth rate dR/dt, the radius when it went out, and how much
        of it looks blue versus soot-like yellow-orange. The colour measure is a
        chromatic proxy from an uncalibrated camera, not radiometry.
      </PageHeader>

      <div className="grid gap-4 lg:grid-cols-[18rem_1fr]">
        <div className="space-y-4">
          <Card title="Add footage">
            <label className="block text-sm">
              <span className="mb-1 block text-xs text-muted">
                Video (mp4, avi, mov) or image (png, jpg, tif)
              </span>
              <input
                type="file"
                accept=".mp4,.avi,.mov,.png,.jpg,.jpeg,.tif,.tiff"
                disabled={busy}
                onChange={(e) =>
                  e.target.files?.[0] && upload(e.target.files[0])
                }
                className="w-full text-xs"
              />
            </label>
            <p className="mt-3 text-xs text-muted">
              No NASA footage yet? A synthetic test clip has a known growth
              rate, shape and colour mix, to check the pipeline.
            </p>
            <Button
              variant="ghost"
              className="mt-2"
              onClick={synthetic}
              disabled={busy}
            >
              Generate synthetic test clip
            </Button>
          </Card>
          <Card title="Footage">
            {items === null ? (
              <ListSkeleton rows={3} />
            ) : items.length === 0 ? (
              <p className="text-sm text-ink-2">Nothing uploaded yet.</p>
            ) : (
              <ul className="space-y-1">
                {items.map((m) => (
                  <li key={m.source.source_id}>
                    <button
                      type="button"
                      onClick={() => setSelected(m.source.source_id)}
                      className={`w-full rounded-md px-2 py-1.5 text-left text-sm ${m.source.source_id === selected ? "bg-surface-2 text-ink" : "text-ink-2 hover:bg-surface-2"}`}
                    >
                      <span className="block truncate">
                        {m.source.synthetic ? "[TEST] " : ""}
                        {m.source.filename}
                      </span>
                      <span className="text-xs text-muted">
                        {m.kind} · {m.analyzed ? "analyzed" : "not analyzed"}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="min-w-0">
          {error && (
            <div className="mb-4">
              <ErrorNote message={error} />
            </div>
          )}
          {item ? (
            <Analysis
              key={item.source.source_id}
              item={item}
              onDone={() => load()}
            />
          ) : (
            items !== null && (
              <Card>
                <p className="text-sm text-ink-2">Add footage to analyze it.</p>
              </Card>
            )
          )}
        </div>
      </div>
    </>
  );
}

function Analysis({ item, onDone }: { item: MediaItem; onDone: () => void }) {
  const id = item.source.source_id;
  const [analysis, setAnalysis] = useState<FootageAnalysis | null>(null);
  const [loading, setLoading] = useState(item.analyzed);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [fps, setFps] = useState("");
  const [mmPerPx, setMmPerPx] = useState("");

  useEffect(() => {
    if (!item.analyzed) return;
    api
      .mediaAnalysis(id)
      .then((a) => {
        setAnalysis(a);
        if (a.fps_source === "override" && a.fps) setFps(String(a.fps));
        if (a.mm_per_px) setMmPerPx(String(a.mm_per_px));
      })
      .catch((e) => setError(e.message))
      .finally(() => setLoading(false));
  }, [id, item.analyzed]);

  async function run() {
    setBusy(true);
    setError(null);
    try {
      setAnalysis(
        await api.analyzeMedia(id, {
          fps: fps ? Number(fps) : null,
          mm_per_px: mmPerPx ? Number(mmPerPx) : null,
        }),
      );
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const s = analysis?.summary;
  return (
    <div className="space-y-4">
      {item.source.synthetic && <SyntheticBanner />}
      <Card
        title={item.source.filename}
        action={
          <Button onClick={run} disabled={busy}>
            {busy ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze"}
          </Button>
        }
      >
        <div className="grid gap-3 sm:grid-cols-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Frame rate (fps) — leave empty to use the file&apos;s; set it for
              high-speed footage stored at a playback rate
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={fps}
              onChange={(e) => setFps(e.target.value)}
              className={input}
            />
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              Calibration (mm per pixel) — without it lengths stay in pixels
            </span>
            <input
              type="number"
              step="any"
              min="0"
              value={mmPerPx}
              onChange={(e) => setMmPerPx(e.target.value)}
              className={input}
            />
          </label>
        </div>
        {busy && (
          <div className="mt-3">
            <LoadingLabel>Measuring every frame…</LoadingLabel>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        )}
      </Card>

      {loading ? (
        <Card>
          <ListSkeleton rows={3} />
        </Card>
      ) : (
        analysis &&
        s && (
          <>
            <Card title="Flame overlay">
              <FlameOverlay sourceId={id} analysis={analysis} />
            </Card>
            <Card title="Measurements">
              {s.note && <p className="mb-3 text-sm text-ink-2">{s.note}</p>}
              <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
                <Stat
                  label="Circularity Ψ (median)"
                  value={fmt(s.circularity_median, 3)}
                  hint="4πA/P² of the projected outline; 1 = circle"
                />
                <Stat
                  label="Growth rate dR/dt"
                  value={
                    s.growth_rate != null
                      ? `${fmt(s.growth_rate, 3)} ${s.growth_rate_unit}`
                      : "—"
                  }
                  hint="Least-squares slope of the equivalent radius up to the largest flame"
                />
                <Stat
                  label="Extinction radius"
                  value={
                    s.extinguished_in_clip
                      ? `${fmt(s.extinction_radius, 3)} ${s.length_unit}`
                      : "did not go out"
                  }
                  hint="Equivalent radius at the last frame with a flame"
                />
                <Stat
                  label="Soot-to-blue ratio"
                  value={fmt(s.soot_to_blue_ratio, 3)}
                  hint="Yellow-orange-red over blue flame pixels (uncalibrated)"
                />
                <Stat
                  label="Blue fraction"
                  value={fmt(s.blue_fraction_median, 3)}
                />
                <Stat
                  label="Soot-like fraction"
                  value={fmt(s.soot_fraction_median, 3)}
                />
                <Stat
                  label="Max radius"
                  value={`${fmt(s.max_radius, 3)} ${s.length_unit}`}
                />
                <Stat
                  label="Flame frames"
                  value={`${s.flame_frames} / ${s.frames}`}
                />
              </div>
              <ul className="mt-4 list-disc space-y-1 pl-5 text-xs text-ink-2">
                {s.growth_fit_r2 != null && (
                  <li>
                    Growth fit over {s.growth_frames} frames, R² ={" "}
                    {fmt(s.growth_fit_r2, 3)}.
                  </li>
                )}
                <li>
                  Frame rate:{" "}
                  {analysis.fps
                    ? `${fmt(analysis.fps, 4)} fps (${analysis.fps_source})`
                    : "unknown"}
                  ; {analysis.frames_analyzed} of {analysis.frames_total} frames
                  analyzed.
                </li>
                {(s.saturated_fraction_median ?? 0) > 0.05 && (
                  <li>
                    {Math.round((s.saturated_fraction_median ?? 0) * 100)}% of
                    flame pixels are saturated white; their colour is unknown,
                    so the colour measures cover the rest only.
                  </li>
                )}
                <li>
                  Circularity is measured on a 2-D projection: a spherical flame
                  always looks circular, but a circle does not prove a sphere.
                </li>
              </ul>
              <RadiusChart analysis={analysis} />
            </Card>
            <AttachCard
              id={id}
              synthetic={!!item.source.synthetic}
              calibrated={!!analysis.mm_per_px}
            />
          </>
        )
      )}
    </div>
  );
}

/** Equivalent radius over time, one dot per analyzed frame. */
function RadiusChart({ analysis }: { analysis: FootageAnalysis }) {
  const k = analysis.mm_per_px ?? 1;
  const pts = analysis.frames
    .filter((f) => f.present && f.radius_px != null)
    .map((f) => ({ t: f.time_s ?? f.index, r: (f.radius_px as number) * k }));
  if (pts.length < 2) return null;
  const W = 640,
    H = 180,
    L = 48,
    B = 28,
    T = 10,
    R = 12;
  const t0 = Math.min(...pts.map((p) => p.t)),
    t1 = Math.max(...pts.map((p) => p.t));
  const r1 = Math.max(...pts.map((p) => p.r));
  const sx = (t: number) => L + ((t - t0) / (t1 - t0 || 1)) * (W - L - R);
  const sy = (r: number) => T + (1 - r / (r1 || 1)) * (H - T - B);
  return (
    <figure className="mt-5">
      <figcaption className="mb-1 text-xs text-muted">
        Equivalent radius ({analysis.summary.length_unit}) over{" "}
        {analysis.fps ? "time (s)" : "frame number"}
      </figcaption>
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-auto w-full"
        role="img"
        aria-label="Flame radius over time"
      >
        <line x1={L} x2={W - R} y1={H - B} y2={H - B} stroke="var(--line)" />
        <line x1={L} x2={L} y1={T} y2={H - B} stroke="var(--line)" />
        <text
          x={L - 6}
          y={sy(r1)}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={11}
          fill="var(--muted)"
        >
          {fmt(r1, 3)}
        </text>
        <text
          x={L - 6}
          y={H - B}
          textAnchor="end"
          dominantBaseline="middle"
          fontSize={11}
          fill="var(--muted)"
        >
          0
        </text>
        <text x={L} y={H - 8} fontSize={11} fill="var(--muted)">
          {fmt(t0, 3)}
        </text>
        <text
          x={W - R}
          y={H - 8}
          textAnchor="end"
          fontSize={11}
          fill="var(--muted)"
        >
          {fmt(t1, 3)}
        </text>
        <polyline
          points={pts.map((p) => `${sx(p.t)},${sy(p.r)}`).join(" ")}
          fill="none"
          stroke="var(--series-1)"
          strokeWidth={2}
          strokeLinejoin="round"
        />
      </svg>
    </figure>
  );
}

function AttachCard({
  id,
  synthetic,
  calibrated,
}: {
  id: string;
  synthetic: boolean;
  calibrated: boolean;
}) {
  const { datasets, refresh } = useWorkspace();
  const usable = datasets.filter((d) => d.synthetic === synthetic);
  const [datasetId, setDatasetId] = useState(usable[0]?.dataset_id ?? "");
  const [experiment, setExperiment] = useState("");
  const [msg, setMsg] = useState<string | null>(null);

  async function attach() {
    try {
      const res = await api.attachMedia(id, datasetId, experiment.trim());
      const cols = Object.keys(res.written);
      setMsg(
        `Written to ${experiment}: ${cols.join(", ") || "nothing"}.${res.note ? ` ${res.note}` : ""}`,
      );
      await refresh();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <Card title="Add to an experiment">
      <p className="text-sm text-ink-2">
        Writes these measurements into one experiment&apos;s rows, as columns
        (flame_circularity, flame_soot_blue_ratio, …) that discovery can then
        analyze like any other outcome.{" "}
        {!calibrated &&
          "Lengths need a calibration, so only shape and colour are written."}
      </p>
      {usable.length === 0 ? (
        <p className="mt-2 text-sm text-muted">
          No {synthetic ? "synthetic" : "real"} dataset to add it to. Synthetic
          footage and real data are never mixed.
        </p>
      ) : (
        <div className="mt-3 flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Dataset</span>
            <select
              value={datasetId}
              onChange={(e) => setDatasetId(e.target.value)}
              className={input}
            >
              {usable.map((d) => (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {d.name}
                </option>
              ))}
            </select>
          </label>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Experiment ID</span>
            <input
              value={experiment}
              onChange={(e) => setExperiment(e.target.value)}
              placeholder="e.g. SYN-0001"
              className={input}
            />
          </label>
          <Button onClick={attach} disabled={!experiment.trim() || !datasetId}>
            Add
          </Button>
        </div>
      )}
      {msg && <p className="mt-2 text-sm text-ink-2">{msg}</p>}
    </Card>
  );
}
