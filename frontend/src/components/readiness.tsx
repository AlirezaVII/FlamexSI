import type { Finding } from "@/lib/types";

const LEVELS = [
  "No supported relationship",
  "Signal in the discovery data",
  "Not chance: random shuffles are weaker",
  "Replicated on unseen experiments",
  "Survives the third-variable checks",
  "Uncertainty bounded: stable bootstrap interval",
  "Compared with published knowledge",
  "Signed off by a domain expert",
];

/** Compact "ERL 5/7" chip for lists. */
export function ReadinessChip({ f }: { f: Finding }) {
  const r = f.readiness;
  if (!r) return null;
  return (
    <span
      title={`Evidence readiness level ${r.level} of ${r.of}: ${r.label}`}
      className="inline-flex items-center gap-1 rounded-full border border-line px-2 py-0.5 text-[11px] tabular-nums text-ink-2"
    >
      ERL {r.level}/{r.of}
    </span>
  );
}

/** The full ladder: what this finding has passed, and the next step to raise it. */
export function ReadinessLadder({ f }: { f: Finding }) {
  const r = f.readiness;
  if (!r) return null;
  return (
    <div>
      <ol className="space-y-1.5">
        {LEVELS.slice(1).map((text, i) => {
          const lvl = i + 1;
          const done = lvl <= r.level;
          const next = lvl === r.level + 1;
          return (
            <li key={lvl} className="flex items-center gap-2.5 text-sm">
              <span
                className={`grid h-6 w-6 shrink-0 place-items-center rounded-full text-[11px] font-medium tabular-nums ${
                  done ? "bg-accent text-white" : next ? "border-2 border-accent text-accent" : "border border-line text-muted"
                }`}
              >
                {lvl}
              </span>
              <span className={done ? "text-ink" : "text-muted"}>{text}</span>
            </li>
          );
        })}
      </ol>
      <p className="mt-3 rounded-lg bg-surface-2 p-3 text-xs text-ink-2">
        <b className="text-ink">Next step to raise it:</b> {r.next}
      </p>
    </div>
  );
}
