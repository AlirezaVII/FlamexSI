"use client";

import { useCallback, useMemo, useState } from "react";
import { fmt, label } from "@/lib/api";
import type { FindingChart, Row } from "@/lib/types";

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

/** Sequential ramp (one hue, light -> dark) for a numeric third variable. */
const RAMP = [
  "#cde2fb",
  "#9ec5f4",
  "#6da7ec",
  "#3987e5",
  "#256abf",
  "#184f95",
  "#0d366b",
];
const CATS = [
  "var(--series-1)",
  "var(--series-2)",
  "var(--series-3)",
  "var(--series-4)",
  "var(--series-5)",
];

function rampColor(t: number) {
  const v = Math.min(1, Math.max(0, t)) * (RAMP.length - 1);
  const i = Math.min(RAMP.length - 2, Math.floor(v));
  const f = v - i;
  const [a, b] = [RAMP[i], RAMP[i + 1]].map((h) =>
    [1, 3, 5].map((k) => parseInt(h.slice(k, k + 2), 16)),
  );
  return `rgb(${a.map((c, j) => Math.round(c + (b[j] - c) * f)).join(",")})`;
}

type ChartPoint = FindingChart["points"][number];

/**
 * A finding's data: one dot per row, the 70% discovery points (blue) apart from the 30%
 * unseen points (orange) the engine never used, plus a LOWESS trend fitted on the discovery
 * points only, with its 95% bootstrap band. Coloured by a third variable, the split moves to
 * the shape: filled = discovery, ring = unseen.
 */
export function ScatterChart({ chart }: { chart: FindingChart }) {
  const [tip, setTip] = useState<Tip | null>(null);
  const [ref, W] = useChartWidth();
  const PW = W - M.left - M.right;
  const points = useMemo(
    () =>
      chart.points
        .map((p) => ({ ...p, yn: toNum(p.y as Row[string]) }))
        .filter((p): p is ChartPoint & { yn: number } => p.yn !== null),
    [chart.points],
  );
  const colorOf = useMemo(() => {
    if (!chart.color_by) return null;
    if (chart.color_kind === "numeric") {
      const vals = points
        .map((p) => p.color)
        .filter((v): v is number => typeof v === "number");
      const [lo, hi] = [Math.min(...vals), Math.max(...vals)];
      return {
        kind: "numeric" as const,
        lo,
        hi,
        fn: (v: ChartPoint["color"]) =>
          typeof v === "number"
            ? rampColor(hi > lo ? (v - lo) / (hi - lo) : 0.5)
            : "var(--muted)",
      };
    }
    const cats = [...new Set(points.map((p) => String(p.color)))].sort();
    const shown = cats.slice(0, CATS.length);
    return {
      kind: "categorical" as const,
      cats: shown,
      other: cats.length > shown.length,
      fn: (v: ChartPoint["color"]) => {
        const i = shown.indexOf(String(v));
        return i >= 0 ? CATS[i] : "var(--muted)"; // a 6th+ category folds into "other"
      },
    };
  }, [chart.color_by, chart.color_kind, points]);

  if (points.length === 0)
    return <p className="text-sm text-muted">No data to plot.</p>;

  const isBool = points.every((p) => typeof p.y === "boolean");
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.yn);
  const band = (chart.trend?.low ?? [])
    .concat(chart.trend?.high ?? [])
    .filter((v): v is number => v !== null);
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [y0, y1] = isBool
    ? [-0.25, 1.25]
    : [Math.min(...ys, ...band), Math.max(...ys, ...band)];
  const pad = (a: number, b: number) => (b - a || 1) * 0.05;
  const sx = (v: number) =>
    M.left + ((v - (x0 - pad(x0, x1))) / (x1 - x0 + 2 * pad(x0, x1))) * PW;
  const sy = (v: number) =>
    M.top + PH - ((v - (y0 - pad(y0, y1))) / (y1 - y0 + 2 * pad(y0, y1))) * PH;
  const jitter = (i: number) =>
    isBool ? (((i * 7919) % 100) / 100 - 0.5) * 0.3 : 0;

  const t = chart.trend;
  const seg = (ys2: (number | null)[]) =>
    t
      ? t.x
          .map((xv, i) =>
            ys2[i] === null ? null : `${sx(xv)},${sy(ys2[i] as number)}`,
          )
          .filter(Boolean)
      : [];
  const line = seg(t?.y ?? []);
  const lowPts = seg(t?.low ?? []);
  const highPts = seg(t?.high ?? []);
  const fill = (p: ChartPoint) =>
    colorOf
      ? colorOf.fn(p.color)
      : p.split === "discovery"
        ? "var(--series-1)"
        : "var(--series-2)";
  // draw unseen points last so they stay visible on top
  const order = [...points.keys()].sort(
    (a, b) =>
      Number(points[a].split === "holdout") -
      Number(points[b].split === "holdout"),
  );

  return (
    <figure
      ref={ref}
      className="relative w-full min-w-0"
      onMouseLeave={() => setTip(null)}
    >
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        {colorOf ? (
          <>
            <LegendDot filled label={`Discovery (${chart.discovery_points})`} />
            <LegendDot label={`Unseen (${chart.holdout_points})`} />
            {colorOf.kind === "numeric" ? (
              <span className="flex items-center gap-1.5">
                {label(chart.color_by ?? "")}: {fmt(colorOf.lo, 3)}
                <span
                  className="inline-block h-2 w-16 rounded-sm"
                  style={{
                    background: `linear-gradient(90deg, ${RAMP[0]}, ${RAMP[6]})`,
                  }}
                />
                {fmt(colorOf.hi, 3)}
              </span>
            ) : (
              colorOf.cats.map((c, i) => (
                <span key={c} className="flex items-center gap-1.5">
                  <span
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ background: CATS[i] }}
                  />
                  {c}
                </span>
              ))
            )}
            {colorOf.kind === "categorical" && colorOf.other && (
              <span className="flex items-center gap-1.5">
                <span
                  className="h-2.5 w-2.5 rounded-full"
                  style={{ background: "var(--muted)" }}
                />
                other
              </span>
            )}
          </>
        ) : (
          <>
            <LegendDot
              filled
              color="var(--series-1)"
              label={`Discovery, 70% (${chart.discovery_points})`}
            />
            <LegendDot
              filled
              color="var(--series-2)"
              label={`Unseen, 30% (${chart.holdout_points})`}
            />
          </>
        )}
        {t && (
          <span className="flex items-center gap-1.5">
            <span className="relative inline-block h-3 w-6">
              <span className="absolute inset-0 rounded-sm bg-ink opacity-10" />
              <span className="absolute inset-x-0 top-1/2 h-0.5 -translate-y-1/2 bg-ink" />
            </span>
            Trend from discovery data, 95% band
          </span>
        )}
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block h-auto max-w-full"
          role="img"
          aria-label={`Scatter plot of ${label(chart.y)} against ${label(chart.x)}: ${chart.discovery_points} discovery and ${chart.holdout_points} unseen points${t ? ", with a smoothed trend fitted on the discovery points" : ""}`}
        >
          <Axes
            W={W}
            xTicks={ticks(x0, x1)}
            yTicks={isBool ? [0, 1] : ticks(y0, y1)}
            sx={sx}
            sy={sy}
            xLabel={label(chart.x)}
            yLabel={
              isBool ? `${label(chart.y)} (trend = rate)` : label(chart.y)
            }
            yFormat={isBool ? (v) => (v ? "yes" : "no") : undefined}
          />
          {lowPts.length > 1 && (
            <polygon
              points={[...highPts, ...lowPts.reverse()].join(" ")}
              fill="var(--ink)"
              fillOpacity={0.08}
            />
          )}
          {order.map((i) => {
            const p = points[i];
            const cx = sx(p.x);
            const cy = sy(p.yn + jitter(i));
            const unseenRing = colorOf && p.split === "holdout";
            return (
              <g key={i}>
                <circle
                  cx={cx}
                  cy={cy}
                  r={4}
                  fill={unseenRing ? "var(--surface)" : fill(p)}
                  fillOpacity={unseenRing ? 1 : 0.75}
                  stroke={unseenRing ? fill(p) : "var(--surface)"}
                  strokeWidth={unseenRing ? 2 : 1}
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
                        `${label(chart.x)}: ${fmt(p.x)}`,
                        `${label(chart.y)}: ${fmt(p.y)}`,
                        ...(chart.color_by
                          ? [`${label(chart.color_by)}: ${fmt(p.color)}`]
                          : []),
                        p.split === "discovery"
                          ? "Discovery data"
                          : "Unseen by discovery",
                      ],
                    })
                  }
                />
              </g>
            );
          })}
          {line.length > 1 && (
            <polyline
              points={line.join(" ")}
              fill="none"
              stroke="var(--ink)"
              strokeWidth={2}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          )}
        </svg>
        <Tooltip tip={tip} />
      </div>
      <details className="mt-2 text-xs text-ink-2">
        <summary className="cursor-pointer text-muted">Data table</summary>
        <div className="mt-2 max-h-56 overflow-auto">
          <table className="w-full text-left tabular-nums">
            <thead className="text-muted">
              <tr>
                <th className="py-1 pr-3 font-medium">experiment</th>
                <th className="py-1 pr-3 font-medium">{label(chart.x)}</th>
                <th className="py-1 pr-3 font-medium">{label(chart.y)}</th>
                {chart.color_by && (
                  <th className="py-1 pr-3 font-medium">
                    {label(chart.color_by)}
                  </th>
                )}
                <th className="py-1 pr-3 font-medium">split</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-line">
              {points.slice(0, 200).map((p, i) => (
                <tr key={i}>
                  <td className="py-1 pr-3">{p.id}</td>
                  <td className="py-1 pr-3">{fmt(p.x)}</td>
                  <td className="py-1 pr-3">{fmt(p.y)}</td>
                  {chart.color_by && (
                    <td className="py-1 pr-3">{fmt(p.color)}</td>
                  )}
                  <td className="py-1 pr-3">
                    {p.split === "discovery" ? "discovery" : "unseen"}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {points.length > 200 && (
            <p className="mt-1 text-muted">
              First 200 of {points.length} rows.
            </p>
          )}
        </div>
      </details>
    </figure>
  );
}

function LegendDot({
  label: text,
  color = "var(--ink-2)",
  filled = false,
}: {
  label: string;
  color?: string;
  filled?: boolean;
}) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className="h-2.5 w-2.5 rounded-full"
        style={
          filled ? { background: color } : { border: `2px solid ${color}` }
        }
      />
      {text}
    </span>
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
