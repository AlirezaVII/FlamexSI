"use client";

import { useCallback, useMemo, useState } from "react";
import { fmt, label } from "@/lib/api";
import type { Row } from "@/lib/types";

const H = 320;
const M = { top: 16, right: 20, bottom: 44, left: 56 };
const PH = H - M.top - M.bottom;

/** Draw at the container's real pixel width so labels stay 11px on every screen. */
function useChartWidth() {
  const [width, setWidth] = useState(640);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([entry]) =>
      setWidth(Math.max(280, Math.round(entry.contentRect.width))),
    );
    ro.observe(el);
    return () => ro.disconnect();
  }, []);
  return [ref, width] as const;
}

function ticks(min: number, max: number, count = 5): number[] {
  if (min === max) return [min];
  const step = 10 ** Math.floor(Math.log10((max - min) / count));
  const nice =
    [1, 2, 5, 10].map((m) => m * step).find((s) => (max - min) / s <= count) ??
    step;
  const out = [];
  for (let v = Math.ceil(min / nice) * nice; v <= max + 1e-9; v += nice)
    out.push(+v.toFixed(10));
  return out;
}

const toNum = (v: Row[string]) =>
  typeof v === "boolean" ? (v ? 1 : 0) : typeof v === "number" ? v : null;

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

function Tooltip({ tip }: { tip: Tip | null }) {
  if (!tip) return null;
  const left = `${tip.x}px`;
  const top = `${tip.y}px`;
  return (
    <div
      className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] whitespace-nowrap rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink shadow-md"
      style={{ left, top }}
    >
      {tip.lines.map((l, i) => (
        <div key={i} className={i === 0 ? "font-semibold" : "text-ink-2"}>
          {l}
        </div>
      ))}
    </div>
  );
}

function Axes({
  W,
  xTicks,
  yTicks,
  sx,
  sy,
  xLabel,
  yLabel,
  yFormat = (v: number) => fmt(v),
}: {
  W: number;
  xTicks: number[];
  yTicks: number[];
  sx: (v: number) => number;
  sy: (v: number) => number;
  xLabel: string;
  yLabel: string;
  yFormat?: (v: number) => string;
}) {
  return (
    <g fontSize={11} fill="var(--muted)">
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line
            x1={M.left}
            x2={W - M.right}
            y1={sy(t)}
            y2={sy(t)}
            stroke="var(--grid)"
          />
          <text
            x={M.left - 8}
            y={sy(t)}
            textAnchor="end"
            dominantBaseline="middle"
          >
            {yFormat(t)}
          </text>
        </g>
      ))}
      {xTicks.map((t) => (
        <text key={`x${t}`} x={sx(t)} y={H - M.bottom + 18} textAnchor="middle">
          {fmt(t)}
        </text>
      ))}
      <line
        x1={M.left}
        x2={W - M.right}
        y1={H - M.bottom}
        y2={H - M.bottom}
        stroke="var(--line)"
      />
      <text
        x={M.left + (W - M.left - M.right) / 2}
        y={H - 6}
        textAnchor="middle"
        fill="var(--ink-2)"
      >
        {xLabel}
      </text>
      <text
        transform={`translate(14 ${M.top + PH / 2}) rotate(-90)`}
        textAnchor="middle"
        fill="var(--ink-2)"
      >
        {yLabel}
      </text>
    </g>
  );
}

/** Numeric condition vs numeric (or yes/no) outcome, one dot per row. */
export function ScatterChart({
  rows,
  x,
  y,
  idKey = "experiment_id",
}: {
  rows: Row[];
  x: string;
  y: string;
  idKey?: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useChartWidth();
  const PW = W - M.left - M.right;
  const points = useMemo(
    () =>
      rows
        .map((r) => ({
          id: String(r[idKey] ?? ""),
          x: toNum(r[x]),
          y: toNum(r[y]),
          raw: r[y],
        }))
        .filter(
          (p): p is { id: string; x: number; y: number; raw: Row[string] } =>
            p.x !== null && p.y !== null,
        ),
    [rows, x, y, idKey],
  );
  if (points.length === 0)
    return <p className="text-sm text-muted">No data to plot.</p>;

  const isBool = points.every((p) => typeof p.raw === "boolean");
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = isBool ? [-0.25, 1.25] : [Math.min(...ys), Math.max(...ys)];
  const pad = (a: number, b: number) => (b - a || 1) * 0.05;
  const sx = (v: number) =>
    M.left + ((v - (x0 - pad(x0, x1))) / (x1 - x0 + 2 * pad(x0, x1))) * PW;
  const sy = (v: number) =>
    M.top + PH - ((v - (y0 - pad(y0, y1))) / (y1 - y0 + 2 * pad(y0, y1))) * PH;
  // deterministic vertical jitter so yes/no points don't sit on one line
  const jitter = (i: number) =>
    isBool ? (((i * 7919) % 100) / 100 - 0.5) * 0.3 : 0;

  return (
    <figure
      ref={ref}
      className="relative w-full min-w-0"
      onMouseLeave={() => setTip(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block h-auto max-w-full"
        role="img"
        aria-label={`Scatter plot of ${label(y)} against ${label(x)}, ${points.length} points`}
      >
        <Axes
          W={W}
          xTicks={ticks(x0, x1)}
          yTicks={isBool ? [0, 1] : ticks(y0, y1)}
          sx={sx}
          sy={sy}
          xLabel={label(x)}
          yLabel={label(y)}
          yFormat={isBool ? (v) => (v ? "yes" : "no") : undefined}
        />
        {points.map((p, i) => {
          const cx = sx(p.x);
          const cy = sy(p.y + jitter(i));
          return (
            <g key={i}>
              <circle
                cx={cx}
                cy={cy}
                r={4}
                fill="var(--series-1)"
                fillOpacity={0.7}
                stroke="var(--surface)"
                strokeWidth={1}
              />
              <circle
                cx={cx}
                cy={cy}
                r={9}
                fill="transparent"
                onMouseEnter={() =>
                  setTip({
                    x: cx,
                    y: cy,
                    lines: [
                      p.id,
                      `${label(x)}: ${fmt(p.x)}`,
                      `${label(y)}: ${fmt(p.raw)}`,
                    ],
                  })
                }
              />
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}

/** One bar per category (group median or yes-rate). */
export function GroupBars({
  values,
  xLabel,
  yLabel,
}: {
  values: Record<string, number>;
  xLabel: string;
  yLabel: string;
}) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useChartWidth();
  const PW = W - M.left - M.right;
  const entries = Object.entries(values);
  if (entries.length === 0)
    return <p className="text-sm text-muted">No data to plot.</p>;
  const max = Math.max(...entries.map(([, v]) => v), 0) || 1;
  const yTicks = ticks(0, max);
  const top = Math.max(max, yTicks[yTicks.length - 1]);
  const sy = (v: number) => M.top + PH - (v / top) * PH;
  const band = PW / entries.length;
  const bw = Math.min(56, band * 0.6);

  return (
    <figure
      ref={ref}
      className="relative w-full min-w-0"
      onMouseLeave={() => setTip(null)}
    >
      <svg
        viewBox={`0 0 ${W} ${H}`}
        width={W}
        height={H}
        className="block h-auto max-w-full"
        role="img"
        aria-label={`Bar chart of ${yLabel} by ${xLabel}`}
      >
        <Axes
          W={W}
          xTicks={[]}
          yTicks={yTicks}
          sx={() => 0}
          sy={sy}
          xLabel={xLabel}
          yLabel={yLabel}
        />
        {entries.map(([k, v], i) => {
          const cx = M.left + band * i + band / 2;
          const y = sy(v);
          const h = H - M.bottom - y;
          const r = Math.min(4, h);
          return (
            <g
              key={k}
              onMouseEnter={() =>
                setTip({ x: cx, y, lines: [k, `${yLabel}: ${fmt(v)}`] })
              }
            >
              <rect
                x={M.left + band * i}
                y={M.top}
                width={band}
                height={PH}
                fill="transparent"
              />
              <path
                d={`M${cx - bw / 2},${H - M.bottom} V${y + r} q0,-${r} ${r},-${r} H${cx + bw / 2 - r} q${r},0 ${r},${r} V${H - M.bottom} Z`}
                fill="var(--series-1)"
              />
              <text
                x={cx}
                y={H - M.bottom + 18}
                textAnchor="middle"
                fontSize={11}
                fill="var(--ink-2)"
              >
                {k}
              </text>
            </g>
          );
        })}
      </svg>
      <Tooltip tip={tip} />
    </figure>
  );
}
