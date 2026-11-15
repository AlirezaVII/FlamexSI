import { PipelineLink as Link } from "./pipeline-link";
import { fmt, label } from "@/lib/api";
import type { Finding } from "@/lib/types";
import { StatusBadge } from "./ui";

/** Why a finding is where it is, in one line (rejected / candidate / not significant). */
export function statusReason(f: Finding): string {
  if (f.status === "rejected") {
    const failed = f.validations.find((v) => v.passed === false);
    return `Initial signal (q = ${fmt(f.q_value, 3)}), but validation failed: ${failed?.message ?? "see details"}`;
  }
  if (f.status === "candidate") {
    const open = f.validations.find((v) => v.passed === null);
    return `Validation inconclusive: ${open?.message ?? "see details"}`;
  }
  if (f.status === "not_significant") {
    return `No supported relationship with this analysis and data (q = ${fmt(f.q_value, 3)}); not evidence of no effect.`;
  }
  return "Observed in discovery data and supported on unseen experiments and against random shuffles; still not causal or external replication.";
}

/** Ranked findings. Rank = score; hover the score to see what it is made of. */
export function FindingList({
  findings,
  start = 1,
  reason = false,
}: {
  findings: Finding[];
  start?: number;
  reason?: boolean;
}) {
  if (findings.length === 0)
    return <p className="text-sm text-muted">No findings.</p>;
  return (
    <ol className="divide-y divide-line">
      {findings.map((f, i) => (
        <li key={f.finding_id}>
          <Link
            href={`/findings/${f.finding_id}`}
            className="grid grid-cols-[2rem_1fr_auto] items-start gap-3 py-3 hover:bg-surface-2 sm:px-2"
          >
            <span className="pt-0.5 text-sm tabular-nums text-muted">
              {start + i}
            </span>
            <span>
              <span className="block text-sm font-medium text-ink">
                {f.headline}
              </span>
              <span className="mt-1 flex flex-wrap items-center gap-2 text-xs text-muted">
                <StatusBadge status={f.status} />
                <span>
                  {label(f.effect_metric)} {fmt(f.effect_size, 2)}
                </span>
                <span>· {f.evidence.n_experiments} experiments</span>
                <span>· {label(f.analyzer)}</span>
              </span>
              {f.deep
                .filter(
                  (p) =>
                    p.probe === "third_variable" && p.verdict === "weakens",
                )
                .map((p) => (
                  <span
                    key={p.params.control}
                    className="mt-1 block text-xs"
                    style={{ color: "var(--critical)" }}
                  >
                    ⚠ May be largely explained by {label(p.params.control)}{" "}
                    (third-variable check)
                  </span>
                ))}
              {reason && statusReason(f) && (
                <span className="mt-1 block text-xs text-ink-2">
                  {statusReason(f)}
                </span>
              )}
            </span>
            <span
              className="text-right text-sm font-semibold tabular-nums text-ink"
              title={Object.entries(f.score_components)
                .map(([k, v]) => `${label(k)}: ${fmt(v, 2)}`)
                .join("\n")}
            >
              {fmt(f.score, 2)}
              <span className="block text-[10px] font-normal text-muted">
                score
              </span>
            </span>
          </Link>
        </li>
      ))}
    </ol>
  );
}
