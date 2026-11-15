"use client";

import { useCallback, useState } from "react";
import { fmt, label } from "@/lib/api";
import type { FlammabilityMap, ReferenceLimit } from "@/lib/types";

const H = 420;
const M = { top: 16, right: 20, bottom: 46, left: 56 };
const BURN = "#e34948"; // diverging pole: burns (red)
const OUT = "#2a78d6"; // diverging pole: goes out (blue); midpoint = the surface grey

function useWidth() {
  const [width, setWidth] = useState(720);
  const ref = useCallback((el: HTMLElement | null) => {
    if (!el) return;
    const ro = new ResizeObserver(([e]) =>
      setWidth(Math.max(300, Math.round(e.contentRect.width))),
    );
    ro.observe(el);
  }, []);
  return [ref, width] as const;
}

interface Tip {
  x: number;
  y: number;
  lines: string[];
}

/**
 * Oxygen (y) against gravity or flow (x): the fitted probability that a flame keeps burning,
 * as a diverging blue (goes out) / red (burns) field with a grey midpoint at 50%; the 50%
 * boundary; every experiment (filled = burned, ring = went out); the chosen environment;
 * and published limits the team entered with a citation.
 */
export function FlammabilityChart({
  map,
  env,
  limits,
}: {
  map: FlammabilityMap;
  env: { name: string; x: number; oxygen: number } | null;
  limits: ReferenceLimit[];
}) {
  const [ref, W] = useWidth();
  const [tip, setTip] = useState<Tip | null>(null);
  const PW = W - M.left - M.right;
  const PH = H - M.top - M.bottom;
  const gx = map.grid.x;
  const go = map.grid.oxygen;
  const xs = [gx[0], gx[gx.length - 1], ...(env ? [env.x] : [])];
  const [x0, x1] = [Math.min(...xs), Math.max(...xs)];
  const [o0, o1] = [go[0], go[go.length - 1]];
  const sx = (v: number) => M.left + ((v - x0) / (x1 - x0 || 1)) * PW;
  const sy = (v: number) => M.top + PH - ((v - o0) / (o1 - o0 || 1)) * PH;
  const cw = PW / gx.length + 0.6;
  const ch = PH / go.length + 0.6;
  const unit = map.axis === "gravity" ? "g" : "cm/s";

  const boundary = map.boundary.filter(
    (b) => b.oxygen !== null && b.oxygen >= o0 && b.oxygen <= o1,
  );
  const inRange = (o: number) =>
    o >= map.ranges.oxygen[0] && o <= map.ranges.oxygen[1];
  const xTicks = Array.from({ length: 6 }, (_, i) => x0 + ((x1 - x0) * i) / 5);
  const oTicks = [15, 20, 25, 30, 35, 40].filter((v) => v >= o0 && v <= o1);
  const axisVal = (l: ReferenceLimit) =>
    map.axis === "gravity" ? l.gravity_g : l.flow_cm_s;

  return (
    <figure
      ref={ref}
      className="relative w-full min-w-0"
      onMouseLeave={() => setTip(null)}
    >
      <figcaption className="mb-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-ink-2">
        <span className="flex items-center gap-1.5">
          Goes out
          <span
            className="inline-block h-2.5 w-24 rounded-sm"
            style={{
              background: `linear-gradient(90deg, ${OUT}, var(--surface-2), ${BURN})`,
            }}
          />
          Burns
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-0.5 w-5 bg-ink" /> 50% boundary
          (estimate)
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-ink" /> burned
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border-2 border-ink" /> went
          out
        </span>
        {limits.length > 0 && (
          <span className="flex items-center gap-1.5">
            <span
              className="inline-block h-0 w-5 border-t-2 border-dashed"
              style={{ borderColor: "var(--series-4)" }}
            />
            published limit (cited)
          </span>
        )}
        <span className="text-muted">
          Faded = outside the data&apos;s oxygen range
        </span>
      </figcaption>
      <div className="relative">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          width={W}
          height={H}
          className="block h-auto max-w-full"
          role="img"
          aria-label={`Estimated probability of burning by ${label(map.axis)} and oxygen, from ${map.n} experiments`}
        >
          <rect
            x={M.left}
            y={M.top}
            width={PW}
            height={PH}
            fill="var(--surface-2)"
          />
          {go.map((o, iy) =>
            gx.map((x, ix) => {
              const p = map.grid.p_burn[iy][ix];
              const strength = Math.abs(p - 0.5) * 2;
              const inside = map.grid.in_data[iy][ix];
              return (
                <rect
                  key={`${iy}-${ix}`}
                  x={sx(x) - cw / 2}
                  y={sy(o) - ch / 2}
                  width={cw}
                  height={ch}
                  fill={p >= 0.5 ? BURN : OUT}
                  fillOpacity={strength * (inside ? 0.75 : 0.28)}
                  onMouseEnter={() =>
                    setTip({
                      x: sx(x),
                      y: sy(o),
                      lines: [
                        `P(burn) ${fmt(p, 2)}${inside ? "" : " (extrapolated)"}`,
                        `${label(map.axis)}: ${fmt(x, 3)} ${unit}`,
                        `oxygen: ${fmt(o, 3)}%`,
                      ],
                    })
                  }
                />
              );
            }),
          )}
          {/* axes */}
          <g fontSize={11} fill="var(--muted)">
            {oTicks.map((t) => (
              <text
                key={t}
                x={M.left - 8}
                y={sy(t)}
                textAnchor="end"
                dominantBaseline="middle"
              >
                {t}
              </text>
            ))}
            {xTicks.map((t, i) => (
              <text key={i} x={sx(t)} y={H - M.bottom + 18} textAnchor="middle">
                {fmt(t, 2)}
              </text>
            ))}
            <text
              x={M.left + PW / 2}
              y={H - 8}
              textAnchor="middle"
              fill="var(--ink-2)"
            >
              {label(map.axis)} ({unit})
            </text>
            <text
              transform={`translate(14 ${M.top + PH / 2}) rotate(-90)`}
              textAnchor="middle"
              fill="var(--ink-2)"
            >
              oxygen (%)
            </text>
          </g>
          {/* published limits */}
          {limits.map((l) => {
            const xv = axisVal(l);
            const y = sy(l.oxygen_percent);
            if (l.oxygen_percent < o0 || l.oxygen_percent > o1) return null;
            return xv != null ? (
              <g key={l.limit_id}>
                <rect
                  x={sx(xv) - 6}
                  y={y - 6}
                  width={12}
                  height={12}
                  transform={`rotate(45 ${sx(xv)} ${y})`}
                  fill="var(--series-4)"
                  stroke="var(--surface)"
                  strokeWidth={2}
                />
                <rect
                  x={sx(xv) - 10}
                  y={y - 10}
                  width={20}
                  height={20}
                  fill="transparent"
                  onMouseEnter={() =>
                    setTip({
                      x: sx(xv),
                      y,
                      lines: [
                        `${l.kind} ${fmt(l.oxygen_percent)}% · ${l.material}`,
                        l.source,
                      ],
                    })
                  }
                />
              </g>
            ) : (
              <g key={l.limit_id}>
                <line
                  x1={M.left}
                  x2={M.left + PW}
                  y1={y}
                  y2={y}
                  stroke="var(--series-4)"
                  strokeWidth={2}
                  strokeDasharray="6 4"
                />
                <line
                  x1={M.left}
                  x2={M.left + PW}
                  y1={y}
                  y2={y}
                  stroke="transparent"
                  strokeWidth={10}
                  onMouseEnter={() =>
                    setTip({
                      x: M.left + PW / 2,
                      y,
                      lines: [
                        `${l.kind} ${fmt(l.oxygen_percent)}% · ${l.material}`,
                        l.source,
                      ],
                    })
                  }
                />
              </g>
            );
          })}
          {/* experiments */}
          {map.points.map((p, i) => (
            <circle
              key={i}
              cx={sx(p.x) + (((i * 7919) % 100) / 100 - 0.5) * 6}
              cy={sy(p.oxygen)}
              r={3}
              fill={p.burned ? "var(--ink)" : "var(--surface)"}
              fillOpacity={p.burned ? 0.6 : 0.9}
              stroke="var(--ink)"
              strokeOpacity={0.7}
              strokeWidth={p.burned ? 0 : 1.2}
            />
          ))}
          {/* 50% boundary: solid inside the data's oxygen range, dashed outside */}
          {boundary.slice(1).map((b, i) => {
            const a = boundary[i];
            const solid =
              inRange(a.oxygen as number) && inRange(b.oxygen as number);
            return (
              <line
                key={i}
                x1={sx(a.x)}
                y1={sy(a.oxygen as number)}
                x2={sx(b.x)}
                y2={sy(b.oxygen as number)}
                stroke="var(--ink)"
                strokeWidth={2.5}
                strokeDasharray={solid ? undefined : "5 4"}
                strokeLinecap="round"
              />
            );
          })}
          {/* chosen environment */}
          {env && env.oxygen >= o0 && env.oxygen <= o1 && (
            <g>
              <circle
                cx={sx(env.x)}
                cy={sy(env.oxygen)}
                r={8}
                fill="none"
                stroke="var(--ink)"
                strokeWidth={2.5}
              />
              <circle
                cx={sx(env.x)}
                cy={sy(env.oxygen)}
                r={8}
                fill="none"
                stroke="var(--surface)"
                strokeWidth={1}
              />
              <text
                x={sx(env.x) + (sx(env.x) > W - 160 ? -12 : 12)}
                y={sy(env.oxygen) - 10}
                textAnchor={sx(env.x) > W - 160 ? "end" : "start"}
                fontSize={12}
                fontWeight={600}
                fill="var(--ink)"
                paintOrder="stroke"
                stroke="var(--surface)"
                strokeWidth={3}
              >
                {env.name}
              </text>
            </g>
          )}
        </svg>
        {tip && (
          <div
            className="pointer-events-none absolute z-10 -translate-x-1/2 -translate-y-[calc(100%+10px)] max-w-xs rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs text-ink shadow-md"
            style={{ left: tip.x, top: tip.y }}
          >
            {tip.lines.map((l, i) => (
              <div key={i} className={i === 0 ? "font-semibold" : "text-ink-2"}>
                {l}
              </div>
            ))}
          </div>
        )}
      </div>
    </figure>
  );
}
