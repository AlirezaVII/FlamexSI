// Loading placeholders shaped like the content they stand in for, so the page keeps its
// layout while data arrives from the server.

export function Skeleton({
  className = "",
  style,
}: {
  className?: string;
  style?: React.CSSProperties;
}) {
  // a span so it is valid inside headings and paragraphs too
  return (
    <span aria-hidden className={`skeleton block ${className}`} style={style} />
  );
}

/** Screen-reader announcement + visible caption for a loading region. */
export function LoadingLabel({
  children = "Loading…",
}: {
  children?: React.ReactNode;
}) {
  return (
    <p role="status" className="flex items-center gap-2 text-xs text-muted">
      <span className="relative flex h-2 w-2">
        <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-accent opacity-60 motion-reduce:animate-none" />
        <span className="relative inline-flex h-2 w-2 rounded-full bg-accent" />
      </span>
      {children}
    </p>
  );
}

export function TextSkeleton({ lines = 3 }: { lines?: number }) {
  const widths = ["w-full", "w-11/12", "w-4/5", "w-2/3", "w-3/4"];
  return (
    <div className="space-y-2.5">
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton
          key={i}
          className={`h-3.5 ${i === lines - 1 ? "w-1/2" : widths[i % widths.length]}`}
        />
      ))}
    </div>
  );
}

export function ListSkeleton({ rows = 4 }: { rows?: number }) {
  return (
    <ul className="divide-y divide-line" aria-hidden>
      {Array.from({ length: rows }, (_, i) => (
        <li
          key={i}
          className="grid grid-cols-[2rem_1fr_auto] items-start gap-3 py-3.5 sm:px-2"
        >
          <Skeleton className="mt-0.5 h-3.5 w-4" />
          <div className="space-y-2">
            <Skeleton className={`h-4 ${i % 2 ? "w-3/5" : "w-4/5"}`} />
            <div className="flex gap-2">
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-5 w-28" />
              <Skeleton className="hidden h-5 w-24 sm:block" />
            </div>
          </div>
          <Skeleton className="h-6 w-10" />
        </li>
      ))}
    </ul>
  );
}

export function TableSkeleton({
  rows = 8,
  cols = 6,
}: {
  rows?: number;
  cols?: number;
}) {
  return (
    <div className="space-y-3" aria-hidden>
      <div className="flex gap-4">
        {Array.from({ length: cols }, (_, c) => (
          <Skeleton key={c} className="h-3 flex-1 opacity-70" />
        ))}
      </div>
      {Array.from({ length: rows }, (_, r) => (
        <div
          key={r}
          className="flex gap-4"
          style={{ opacity: 1 - r * (0.6 / rows) }}
        >
          {Array.from({ length: cols }, (_, c) => (
            <Skeleton
              key={c}
              className={`h-4 flex-1 ${c === 0 ? "max-w-24" : ""}`}
            />
          ))}
        </div>
      ))}
    </div>
  );
}

export function StatSkeleton() {
  return (
    <div className="space-y-1.5" aria-hidden>
      <Skeleton className="h-3 w-16" />
      <Skeleton className="h-6 w-20" />
    </div>
  );
}

/**
 * Chart loader: a ghost chart (grid, axes) whose marks rise in a travelling wave while a
 * trend line draws through them. "bars" for categories, "scatter" for points.
 */
export function ChartSkeleton({
  variant = "scatter",
  label = "Loading chart data…",
}: {
  variant?: "scatter" | "bars";
  label?: string;
}) {
  const W = 640;
  const H = 320;
  const L = 56;
  const B = H - 44;
  const T = 16;
  const R = W - 20;
  const bars = [0.55, 0.8, 0.4, 0.95, 0.65];
  // deterministic "cloud" of points around a gentle curve
  const points = Array.from({ length: 34 }, (_, i) => {
    const t = i / 33;
    const x = L + 16 + t * (R - L - 32);
    const base = 0.25 + 0.5 * t + 0.12 * Math.sin(t * 7);
    const jitter = (((i * 7919) % 100) / 100 - 0.5) * 0.28;
    return { x, y: B - (base + jitter) * (B - T - 10), delay: t * 0.9 };
  });
  // smooth trend through the cloud (the underlying curve, without the jitter)
  const curve = Array.from({ length: 41 }, (_, i) => {
    const t = i / 40;
    const x = L + 16 + t * (R - L - 32);
    const y = B - (0.25 + 0.5 * t + 0.12 * Math.sin(t * 7)) * (B - T - 10);
    return `${i ? "L" : "M"}${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");

  return (
    <div className="space-y-3">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="block h-auto w-full"
        aria-hidden
      >
        {[0, 1, 2, 3, 4].map((i) => {
          const y = T + (i * (B - T)) / 4;
          return (
            <g key={i}>
              <line x1={L} x2={R} y1={y} y2={y} stroke="var(--grid)" />
              <rect
                x={L - 38}
                y={y - 5}
                width={26}
                height={10}
                rx={3}
                fill="var(--skeleton)"
              />
            </g>
          );
        })}
        <line x1={L} x2={R} y1={B} y2={B} stroke="var(--line)" />
        <rect
          x={L + (R - L) / 2 - 36}
          y={H - 16}
          width={72}
          height={10}
          rx={3}
          fill="var(--skeleton)"
        />

        {variant === "bars" ? (
          bars.map((h, i) => {
            const band = (R - L) / bars.length;
            const bw = Math.min(56, band * 0.6);
            const x = L + band * i + (band - bw) / 2;
            const bh = h * (B - T - 8);
            return (
              <rect
                key={i}
                className="chart-loader-mark"
                style={{ animationDelay: `${i * 0.14}s` }}
                x={x}
                y={B - bh}
                width={bw}
                height={bh}
                rx={4}
                fill="var(--series-1)"
              />
            );
          })
        ) : (
          <>
            {points.map((p, i) => (
              <circle
                key={i}
                className="chart-loader-dot"
                style={{ animationDelay: `${p.delay}s` }}
                cx={p.x}
                cy={p.y}
                r={4.5}
                fill="var(--series-1)"
              />
            ))}
            <path
              className="chart-loader-line"
              d={curve}
              pathLength={1}
              fill="none"
              stroke="var(--accent)"
              strokeWidth={2}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          </>
        )}
      </svg>
      <LoadingLabel>{label}</LoadingLabel>
    </div>
  );
}
