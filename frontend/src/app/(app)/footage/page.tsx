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
import type { FootageAnalysis, FootageComparison, FootageDetector, MediaItem } from "@/lib/types";
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
        of it looks blue versus soot-like yellow-orange. Choose how the flame is found
        (OpenCV by default) or compare the methods on the same footage. The colour measure
        is a chromatic proxy from an uncalibrated camera, not radiometry.
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
  const [detectors, setDetectors] = useState<FootageDetector[]>([]);
  const [detector, setDetector] = useState("opencv");
  const [comparison, setComparison] = useState<FootageComparison | null>(null);
  const [comparing, setComparing] = useState(false);

  useEffect(() => {
    api.meta().then((m) => setDetectors(m.footage_detectors ?? [])).catch(() => {});
  }, []);

  useEffect(() => {
    if (!item.analyzed) return;
    api
      .mediaAnalysis(id)
      .then((a) => {
        setAnalysis(a);
        if (a.detector) setDetector(a.detector);
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
          detector,
        }),
      );
      onDone();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function compare() {
    setComparing(true);
    setError(null);
    try {
      // one request per method, so none runs past a proxy's time limit; v6 waits on its own
      // service, so it runs alongside the local methods, which run one after the other
      const body = { fps: fps ? Number(fps) : null, mm_per_px: mmPerPx ? Number(mmPerPx) : null };
      const one = (d: string) => api.compareMedia(id, { ...body, detectors: [d] });
      const ids = usable.length ? usable.map((d) => d.id) : ["opencv", "classic"];
      const local = (async () => {
        const out: FootageComparison[] = [];
        for (const d of ids.filter((d) => d !== "v6")) out.push(await one(d));
        return out;
      })();
      const remote = ids.includes("v6")
        ? one("v6").catch((e: Error): FootageComparison => ({
            source_id: id, x: "frame", detectors: {}, skipped: { v6: e.message } }))
        : null;
      const parts = [...(await local), ...(remote ? [await remote] : [])];
      setComparison({
        source_id: id,
        x: parts.some((p) => p.x === "time_s") ? "time_s" : "frame",
        detectors: Object.assign({}, ...parts.map((p) => p.detectors)),
        skipped: Object.assign({}, ...parts.map((p) => p.skipped ?? {})),
      });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setComparing(false);
    }
  }

  const s = analysis?.summary;
  const usable = detectors.filter((d) => !(d.video_only && item.kind === "image"));
  const chosen = detectors.find((d) => d.id === detector);
  return (
    <div className="space-y-4">
      {item.source.synthetic && <SyntheticBanner />}
      <Card
        title={item.source.filename}
        action={
          <span className="flex flex-wrap gap-2">
            <Button variant="ghost" onClick={compare} disabled={busy || comparing}>
              {comparing ? "Comparing…" : "Compare methods"}
            </Button>
            <Button onClick={run} disabled={busy || comparing}>
              {busy ? "Analyzing…" : analysis ? "Re-analyze" : "Analyze"}
            </Button>
          </span>
        }
      >
        {usable.length > 0 && (
          <fieldset className="mb-4">
            <legend className="mb-1.5 text-xs text-muted">How to find the flame</legend>
            <div className="flex flex-wrap gap-2">
              {usable.map((d) => (
                <label key={d.id}
                  className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs transition ${
                    detector === d.id ? "border-accent bg-accent/10 text-ink" : "border-line text-ink-2 hover:text-ink"}`}>
                  <input type="radio" name={`det-${id}`} value={d.id} checked={detector === d.id}
                    onChange={() => setDetector(d.id)} className="sr-only" />
                  {d.label}
                </label>
              ))}
            </div>
            {chosen && <p className="mt-2 text-xs text-muted">{chosen.note}</p>}
            {item.kind === "image" && (
              <p className="mt-1 text-xs text-ink-2">
                This is a single image. A video of the burn gives more reliable results: the
                scene without the flame can then be learned from the other frames.
              </p>
            )}
          </fieldset>
        )}
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
        {(busy || comparing) && (
          <div className="mt-3">
            <LoadingLabel>
              {comparing
                ? `Running every method on the same footage…${usable.some((d) => d.id === "v6") ? " Pouya's v6 takes about a minute." : ""}`
                : detector === "v6"
                  ? "Sending 24 frames to Pouya's v6 model… about a minute"
                  : "Measuring every frame…"}
            </LoadingLabel>
          </div>
        )}
        {error && (
          <div className="mt-3">
            <ErrorNote message={error} />
          </div>
        )}
      </Card>

      {comparison && <CompareCard c={comparison} detectors={detectors} />}

      {loading ? (
        <Card>
          <ListSkeleton rows={3} />
        </Card>
      ) : (
        analysis &&
        s && (
          <>
            <Card title={`Flame overlay · ${detectors.find((d) => d.id === (analysis.detector ?? "classic"))?.label ?? "Classic brightness threshold"}`}>
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

const COLORS: Record<string, string> = { opencv: "#4f7cff", classic: "#ff8a3d", v6: "#22a06b" };

/** Every detector on the same footage: their numbers side by side and their radius curves. */
function CompareCard({ c, detectors }: { c: FootageComparison; detectors: FootageDetector[] }) {
  const entries = Object.entries(c.detectors);
  const name = (id: string) => detectors.find((d) => d.id === id)?.label ?? id;
  const all = entries.flatMap(([, d]) => d.radius.filter((p) => p[1] != null)) as [number, number][];
  const x0 = Math.min(...all.map((p) => p[0]), 0);
  const x1 = Math.max(...all.map((p) => p[0]), 1);
  const y1 = Math.max(...all.map((p) => p[1]), 1);
  const X = (v: number) => 44 + ((v - x0) / (x1 - x0 || 1)) * 530;
  const Y = (v: number) => 170 - (v / y1) * 150;
  const rows: [string, (s: FootageComparison["detectors"][string]["summary"]) => string][] = [
    ["Flame frames", (s) => `${s.flame_frames} / ${s.frames}`],
    ["Max radius", (s) => (s.max_radius != null ? `${fmt(s.max_radius, 3)} ${s.length_unit}` : "—")],
    ["Growth rate", (s) => (s.growth_rate != null ? `${fmt(s.growth_rate, 3)} ${s.growth_rate_unit}` : "—")],
    ["Growth fit R²", (s) => fmt(s.growth_fit_r2 ?? null, 3)],
    ["Went out", (s) => (s.extinguished_in_clip
      ? `yes${s.extinction_time_s != null ? ` at ${fmt(s.extinction_time_s, 3)} s` : ""}, last radius ${fmt(s.extinction_radius ?? null, 3)} ${s.length_unit}`
      : "no")],
    ["Circularity Ψ", (s) => fmt(s.circularity_median ?? null, 3)],
  ];
  return (
    <Card title="Methods compared on this footage">
      <div className="overflow-x-auto" data-lenis-prevent>
        <table className="w-full min-w-[30rem] text-left text-sm tabular-nums">
          <thead>
            <tr className="border-b border-line text-xs text-muted">
              <th className="py-1.5 pr-3 font-medium">Measure</th>
              {entries.map(([id]) => (
                <th key={id} className="py-1.5 pr-3 font-medium">
                  <span style={{ color: COLORS[id] }}>●</span> {name(id)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map(([label, f]) => (
              <tr key={label} className="border-b border-line/60">
                <td className="py-1.5 pr-3 text-ink-2">{label}</td>
                {entries.map(([id, d]) => <td key={id} className="py-1.5 pr-3 text-ink">{f(d.summary)}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <svg viewBox="0 0 600 196" className="mt-4 w-full" role="img" aria-label="Flame radius over time for each method">
        {[0, 0.5, 1].map((k) => (
          <g key={k}>
            <line x1={44} x2={574} y1={Y(y1 * k)} y2={Y(y1 * k)} stroke="var(--line)" />
            <text x={38} y={Y(y1 * k) + 3} fontSize={10} textAnchor="end" fill="var(--muted)">{fmt(y1 * k, 3)}</text>
          </g>
        ))}
        {entries.map(([id, d]) => {
          const pts = d.radius.filter((p) => p[1] != null) as [number, number][];
          return (
            <g key={id}>
              <polyline fill="none" stroke={COLORS[id] ?? "var(--accent)"} strokeWidth={2}
                points={pts.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")} />
              {d.radius.length <= 40 && pts.map((p, i) => ( // a sampled method: show its frames
                <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={2.5} fill={COLORS[id] ?? "var(--accent)"} />
              ))}
            </g>
          );
        })}
        <text x={309} y={192} fontSize={11} textAnchor="middle" fill="var(--ink-2)">
          {c.x === "time_s" ? "time (s)" : "frame"} · equivalent radius (px)
        </text>
      </svg>
      <p className="mt-2 text-xs text-muted">
        Same footage, same measurements; only the way the flame is found differs. Where the
        curves disagree, open the overlay with each method to see why.
      </p>
      {Object.entries(c.skipped ?? {}).map(([id, why]) => (
        <p key={id} className="mt-1 text-xs text-ink-2">{name(id)} was not run: {why.replace(/\.$/, "")}.</p>
      ))}
    </Card>
  );
}
