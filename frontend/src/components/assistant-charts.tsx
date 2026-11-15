"use client";

/* What Ask FlamexSI's tools return, drawn: scatter, bars, line, table and a live 3D replay.
 * The data comes from the server (computed from NASA files), never from the language model. */

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { createFlameEngine, STANDOFF, type FlameEngine } from "@/components/flame3d/engine";
import { endOf, momentAt, PRE, type FlexTest } from "@/components/flame3d/timeline";

type Axis = { label: string; unit?: string };
export type ToolResult = (
  | { kind: "scatter"; title: string; caption?: string; x: Axis; y: Axis;
      points: [number, number, string, number][]; rho: Record<string, { rho: number; n: number }> }
  | { kind: "bars"; title: string; caption?: string; unit: string; max?: number;
      rows: { label: string; value: number; n?: number; note?: string }[] }
  | { kind: "line"; title: string; caption?: string; x: Axis; normalise?: boolean;
      series: { name: string; points: [number, number][] }[]; markers?: { label: string; t: number }[] }
  | { kind: "table"; title: string; caption?: string; columns: string[]; rows: (string | number | null)[][] }
  | { kind: "replay"; title: string; caption?: string; tests: FlexTest[] }
) & { stats?: string };

const FUEL: Record<string, string> = { Heptane: "#ff7a3d", Methanol: "#4f7cff" };
const SERIES = ["#ff7a3d", "#ffc53d", "#4f7cff"];
const fmt = (v: number) => (Math.abs(v) >= 100 ? v.toFixed(0) : Math.abs(v) >= 1 ? v.toFixed(2) : v.toFixed(3));

export function ToolCard({ r }: { r: ToolResult }) {
  return (
    <figure className="my-3 overflow-hidden rounded-2xl border border-line bg-surface">
      <figcaption className="flex items-center justify-between gap-2 border-b border-line px-3 py-2">
        <span className="text-xs font-medium text-ink">{r.title}</span>
        <span className="shrink-0 rounded-full bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent">
          {r.kind === "replay" ? "3D" : r.kind === "table" ? "TABLE" : "CHART"}
        </span>
      </figcaption>
      <div className="p-3">
        {r.kind === "scatter" && <Scatter r={r} />}
        {r.kind === "bars" && <Bars r={r} />}
        {r.kind === "line" && <Line r={r} />}
        {r.kind === "table" && <Table r={r} />}
        {r.kind === "replay" && <Replay tests={r.tests} />}
        {"stats" in r && r.stats && (
          <p className="mt-2 rounded-lg bg-accent/10 px-2.5 py-1.5 text-xs font-medium tabular-nums text-ink">{r.stats}</p>
        )}
        {r.caption && <p className="mt-2 text-[11px] text-muted">{r.caption}</p>}
      </div>
    </figure>
  );
}

function ticks(lo: number, hi: number, n = 4) {
  return Array.from({ length: n + 1 }, (_, i) => lo + ((hi - lo) * i) / n);
}

function Scatter({ r }: { r: Extract<ToolResult, { kind: "scatter" }> }) {
  const xs = r.points.map((p) => p[0]);
  const ys = r.points.map((p) => p[1]);
  const [x0, x1, y0, y1] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  const X = (v: number) => 48 + ((v - x0) / (x1 - x0 || 1)) * 520;
  const Y = (v: number) => 210 - ((v - y0) / (y1 - y0 || 1)) * 190;
  const [hover, setHover] = useState<number | null>(null);
  const h = hover !== null ? r.points[hover] : null;
  return (
    <div>
      <svg viewBox="0 0 600 250" className="w-full" role="img" aria-label={r.title}>
        {ticks(y0, y1).map((v) => (
          <g key={`y${v}`}>
            <line x1={48} x2={570} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
            <text x={42} y={Y(v) + 3} fontSize={10} textAnchor="end" fill="var(--muted)">{fmt(v)}</text>
          </g>
        ))}
        {ticks(x0, x1).map((v) => (
          <text key={`x${v}`} x={X(v)} y={228} fontSize={10} textAnchor="middle" fill="var(--muted)">{fmt(v)}</text>
        ))}
        <text x={309} y={246} fontSize={11} textAnchor="middle" fill="var(--ink-2)">{r.x.label}{r.x.unit ? ` (${r.x.unit})` : ""}</text>
        <text x={12} y={115} fontSize={11} textAnchor="middle" fill="var(--ink-2)" transform="rotate(-90 12 115)">{r.y.label}</text>
        {r.points.map((p, i) => (
          <circle key={i} cx={X(p[0])} cy={Y(p[1])} r={hover === i ? 6 : 3.6}
            fill={FUEL[p[2]] ?? "var(--accent)"} fillOpacity={0.75}
            stroke={hover === i ? "var(--ink)" : "none"}
            onMouseEnter={() => setHover(i)} onMouseLeave={() => setHover(null)} />
        ))}
      </svg>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[11px] text-ink-2">
        {Object.entries(FUEL).map(([f, c]) => (
          <span key={f}><span style={{ color: c }}>●</span> {f}{r.rho[f] ? `  ρ = ${r.rho[f].rho} (n = ${r.rho[f].n})` : ""}</span>
        ))}
        {h && <span className="tabular-nums text-ink">FLEX #{h[3]} · {fmt(h[0])}, {fmt(h[1])}</span>}
      </div>
    </div>
  );
}

function Bars({ r }: { r: Extract<ToolResult, { kind: "bars" }> }) {
  const max = r.max ?? Math.max(...r.rows.map((x) => x.value), 1e-9);
  return (
    <div className="space-y-1.5">
      {r.rows.map((row, i) => (
        <div key={row.label} className="grid grid-cols-[minmax(6rem,11rem)_1fr_auto] items-center gap-2 text-xs">
          <span className="truncate text-ink-2" title={row.note}>{row.label}</span>
          <div className="h-3 overflow-hidden rounded-full bg-surface-2">
            <div className="bar-grow h-full rounded-full"
              style={{ width: `${Math.max(1.5, (row.value / max) * 100)}%`, animationDelay: `${i * 70}ms`,
                background: "linear-gradient(90deg, #4f7cff, #ff7a3d)" }} />
          </div>
          <span className="tabular-nums text-ink">{fmt(row.value)}{row.n ? <span className="text-muted"> · n {row.n}</span> : null}</span>
        </div>
      ))}
      <p className="pt-1 text-[11px] text-muted">{r.unit}</p>
    </div>
  );
}

function Line({ r }: { r: Extract<ToolResult, { kind: "line" }> }) {
  const all = r.series.flatMap((s) => s.points);
  const [t0, t1] = [Math.min(...all.map((p) => p[0])), Math.max(...all.map((p) => p[0]))];
  const X = (t: number) => 40 + ((t - t0) / (t1 - t0 || 1)) * 540;
  return (
    <div>
      <svg viewBox="0 0 600 220" className="w-full" role="img" aria-label={r.title}>
        {ticks(t0, t1, 5).map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={14} y2={186} stroke="var(--line)" />
            <text x={X(t)} y={200} fontSize={10} textAnchor="middle" fill="var(--muted)">{t.toFixed(0)}</text>
          </g>
        ))}
        {r.markers?.map((m) => (
          <g key={m.label}>
            <line x1={X(m.t)} x2={X(m.t)} y1={10} y2={186} stroke="var(--serious)" strokeDasharray="3 3" />
            <text x={X(m.t) + 3} y={20} fontSize={10} fill="var(--serious)">{m.label}</text>
          </g>
        ))}
        {r.series.map((s, i) => {
          const lo = Math.min(...s.points.map((p) => p[1]));
          const hi = Math.max(...s.points.map((p) => p[1]));
          const Y = (v: number) => 186 - ((v - lo) / (hi - lo || 1)) * 160;
          return <polyline key={s.name} className="line-draw" fill="none" stroke={SERIES[i % 3]} strokeWidth={2}
            points={s.points.map((p) => `${X(p[0]).toFixed(1)},${Y(p[1]).toFixed(1)}`).join(" ")} />;
        })}
        <text x={310} y={216} fontSize={11} textAnchor="middle" fill="var(--ink-2)">{r.x.label}</text>
      </svg>
      <div className="flex flex-wrap gap-x-4 text-[11px] text-ink-2">
        {r.series.map((s, i) => <span key={s.name}><span style={{ color: SERIES[i % 3] }}>━</span> {s.name}</span>)}
      </div>
    </div>
  );
}

function Table({ r }: { r: Extract<ToolResult, { kind: "table" }> }) {
  return (
    <div className="overflow-x-auto" data-lenis-prevent>
      <table className="w-full min-w-[32rem] text-left text-xs tabular-nums">
        <thead><tr className="border-b border-line text-muted">{r.columns.map((c) => <th key={c} className="py-1 pr-3 font-medium">{c}</th>)}</tr></thead>
        <tbody>{r.rows.map((row, i) => (
          <tr key={i} className="border-b border-line/50">{row.map((v, j) => <td key={j} className="py-1 pr-3 text-ink-2">{v ?? "–"}</td>)}</tr>
        ))}</tbody>
      </table>
    </div>
  );
}

/** A compact live replay of real FLEX tests with the Flame lab engine. */
function Replay({ tests }: { tests: FlexTest[] }) {
  const refs = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const [failed, setFailed] = useState(false);
  const [restart, setRestart] = useState(0);
  useEffect(() => {
    const engines: (FlameEngine | null)[] = tests.map((_, i) =>
      refs[i].current ? createFlameEngine(refs[i].current!, "low") : null);
    if (engines.some((e) => !e)) {
      engines.forEach((e) => e?.dispose());
      const id = requestAnimationFrame(() => setFailed(true));
      return () => cancelAnimationFrame(id);
    }
    const scale = Math.max(...tests.map((x) => STANDOFF[x.fuel] * x.d0));
    engines.forEach((e) => e!.setScale(scale));
    const end = Math.max(...tests.map((x) => endOf(x, true)));
    let t = -PRE;
    let last = performance.now();
    let raf = 0;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      t = t >= end ? end : t + dt;
      tests.forEach((x, i) => engines[i]!.frame({ ...momentAt(x, t, true).state, gravity: 0, soot: true }, dt));
    };
    raf = requestAnimationFrame(tick);
    return () => { cancelAnimationFrame(raf); engines.forEach((e) => e?.dispose()); };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refs are stable
  }, [tests, restart]);
  const q = tests.map((x, i) => `${i ? "b" : "a"}=${x.n}`).join("&");
  if (failed) return <p className="text-xs text-muted">This browser cannot draw 3D. <Link className="text-accent" href={`/flame-lab?${q}`}>Open in Flame lab</Link></p>;
  return (
    <div>
      <div className={`grid gap-2 ${tests.length > 1 ? "grid-cols-2" : ""}`}>
        {tests.map((x, i) => (
          <div key={`${x.n}-${restart}`} className="relative h-48 overflow-hidden rounded-xl bg-[#04060c]" data-lenis-prevent>
            <canvas ref={refs[i]} className="block" style={{ width: "100%", height: "100%" }} aria-label={`3D replay of FLEX test ${x.n}`} />
            <span className="pointer-events-none absolute left-2 top-2 rounded bg-black/55 px-2 py-0.5 text-[10px] text-white/85">
              #{x.n} · {x.fuel} · {(x.o2 * 100).toFixed(0)}% O₂ · d₀ {x.d0} mm · {x.end}
            </span>
          </div>
        ))}
      </div>
      <div className="mt-2 flex gap-3 text-xs">
        <button type="button" onClick={() => setRestart((n) => n + 1)} className="text-accent">Replay</button>
        <Link href={`/flame-lab?${q}`} className="text-accent">Open in Flame lab →</Link>
      </div>
    </div>
  );
}
