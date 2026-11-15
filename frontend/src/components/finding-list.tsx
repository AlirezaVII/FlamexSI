import Link from "next/link";
import { fmt, label } from "@/lib/api";
import type { Finding } from "@/lib/types";
import { StatusBadge } from "./ui";

/** Ranked findings. Rank = score; hover the score to see what it is made of. */
export function FindingList({ findings, start = 1 }: { findings: Finding[]; start?: number }) {
  if (findings.length === 0) return <p className="text-sm text-muted">No findings.</p>;
  return (
    <ol className="divide-y divide-line">
      {findings.map((f, i) => (
        <li key={f.finding_id}>
          <Link
            href={`/findings/${f.finding_id}`}
            className="grid grid-cols-[2rem_1fr_auto] items-start gap-3 py-3 hover:bg-surface-2 sm:px-2"
          >
            <span className="pt-0.5 text-sm tabular-nums text-muted">{start + i}</span>
            <span>
              <span className="block text-sm font-medium text-ink">{f.headline}</span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <StatusBadge status={f.status} />
                <span>
                  {label(f.effect_metric)} {fmt(f.effect_size, 2)}
                </span>
                <span>· {f.evidence.n_experiments} experiments</span>
                <span>· {label(f.analyzer)}</span>
              </span>
            </span>
            <span
              className="text-right text-sm font-semibold tabular-nums text-ink"
              title={Object.entries(f.score_components)
                .map(([k, v]) => `${label(k)}: ${fmt(v, 2)}`)
                .join("\n")}
            >
              {fmt(f.score, 2)}
              <span className="block text-[10px] font-normal text-muted">score</span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
