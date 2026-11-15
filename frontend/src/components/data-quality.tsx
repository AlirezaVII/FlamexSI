import { label } from "@/lib/api";
import type { Quality } from "@/lib/types";
import { Card, Stat } from "./ui";

const pct = (v: number) => `${(v * 100).toFixed(v > 0 && v < 0.01 ? 2 : 1)}%`;

/**
 * What we have, what we do not, and what changed on the way in. Computed from the data and
 * the pipeline report, never typed in: this is what the scientific question is built on.
 */
export function DataQuality({ q }: { q: Quality }) {
  const removed = Object.entries(q.rows_removed).filter(([, n]) => n > 0);
  const groups = [
    { key: "condition", title: "Conditions" },
    { key: "outcome", title: "Outcomes" },
    { key: "other", title: "Other mapped" },
    {
      key: "unmapped",
      title: "Kept from the file (not in the standard schema)",
    },
  ] as const;

  return (
    <Card title="Data quality">
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Stat
          label="Missing values"
          value={pct(q.missing_cell_share)}
          hint="Share of empty cells"
        />
        <Stat
          label="Duplicate rows"
          value={pct(q.duplicate_row_share)}
          hint="Exact duplicate rows removed"
        />
        <Stat label="Unit conversions" value={q.unit_conversions.length} />
        <Stat
          label="Rows removed"
          value={`${q.rows_in - q.rows_out} of ${q.rows_in}`}
        />
        <Stat label="Variables mapped" value={q.variables_mapped} />
        <Stat label="Variables kept unmapped" value={q.variables_unmapped} />
        <Stat
          label="Usable for analysis"
          value={`${q.variables_usable} of ${q.variables.length}`}
        />
        <Stat
          label="Experiments"
          value={q.experiments}
          hint={`${q.experiments_with_repeated_measurements} with repeated measurements, from ${q.sources} source file(s)`}
        />
      </div>

      <div className="mt-5 grid gap-4 border-t border-line pt-4 text-sm md:grid-cols-3">
        <div>
          <p className="mb-1 font-medium text-ink">
            Removed or changed, and why
          </p>
          <ul className="space-y-0.5 text-ink-2">
            {removed.map(([reason, n]) => (
              <li key={reason}>
                {n} × {reason}
              </li>
            ))}
            {q.invalid_values_set_missing > 0 && (
              <li>
                {q.invalid_values_set_missing} × invalid value (not readable as
                the variable&apos;s type) set to missing
              </li>
            )}
            {!removed.length && !q.invalid_values_set_missing && (
              <li>Nothing removed or changed.</li>
            )}
          </ul>
          {q.outliers_flagged > 0 && (
            <p className="mt-2 text-xs text-muted">
              {q.outliers_flagged} possible outliers flagged (more than 3 IQR
              from the quartiles). Flagged only, never removed: whether they are
              errors is a scientific decision.
            </p>
          )}
        </div>
        <div>
          <p className="mb-1 font-medium text-ink">Unit conversions</p>
          {q.unit_conversions.length ? (
            <ul className="space-y-0.5 text-ink-2">
              {q.unit_conversions.map((c) => (
                <li key={`${c.column}-${c.raw}`}>
                  {label(c.column)}: {c.from} → {c.to}{" "}
                  <span className="text-xs text-muted">
                    ({c.values} values, column “{c.raw}”)
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-ink-2">None needed.</p>
          )}
        </div>
        <div>
          <p className="mb-1 font-medium text-ink">Not usable for analysis</p>
          {q.variables.some((v) => !v.usable) ? (
            <ul className="space-y-0.5 text-ink-2">
              {q.variables
                .filter((v) => !v.usable)
                .map((v) => (
                  <li key={v.name}>
                    {label(v.name)}: {v.problem}
                  </li>
                ))}
            </ul>
          ) : (
            <p className="text-ink-2">
              Every variable has enough varying values.
            </p>
          )}
        </div>
      </div>

      <div className="mt-5 border-t border-line pt-4">
        <p className="mb-2 text-sm font-medium text-ink">
          What this dataset contains
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="py-1.5 pr-4 font-medium">Variable</th>
                <th className="py-1.5 pr-4 font-medium">Type</th>
                <th className="py-1.5 pr-4 font-medium">Unit</th>
                <th className="py-1.5 pr-4 font-medium">Complete</th>
                <th className="py-1.5 pr-4 font-medium">Flags</th>
                <th className="py-1.5 font-medium">Usable</th>
              </tr>
            </thead>
            {groups.map((g) => {
              const vars = q.variables.filter((v) => v.group === g.key);
              if (!vars.length) return null;
              return (
                <tbody key={g.key} className="divide-y divide-line">
                  <tr>
                    <td
                      colSpan={6}
                      className="pt-3 pb-1 text-xs font-semibold uppercase tracking-wider text-muted"
                    >
                      {g.title}
                    </td>
                  </tr>
                  {vars.map((v) => (
                    <tr key={v.name}>
                      <td className="py-1.5 pr-4 text-ink">{label(v.name)}</td>
                      <td className="py-1.5 pr-4 text-ink-2">{v.type}</td>
                      <td className="py-1.5 pr-4 text-ink-2">
                        {v.unit ?? "—"}
                        {v.converted_from && (
                          <span className="text-xs text-muted">
                            {" "}
                            (from {v.converted_from})
                          </span>
                        )}
                      </td>
                      <td className="py-1.5 pr-4">
                        <span className="flex items-center gap-2">
                          <span className="h-1.5 w-16 overflow-hidden rounded-full bg-surface-2">
                            <span
                              className="block h-full rounded-full"
                              style={{
                                width: `${v.completeness * 100}%`,
                                background:
                                  v.completeness < 0.8
                                    ? "var(--warning)"
                                    : "var(--good)",
                              }}
                            />
                          </span>
                          <span className="tabular-nums text-ink-2">
                            {pct(v.completeness)}
                          </span>
                        </span>
                      </td>
                      <td className="py-1.5 pr-4 text-xs text-ink-2">
                        {[
                          v.invalid_values && `${v.invalid_values} invalid`,
                          v.outliers_flagged &&
                            `${v.outliers_flagged} outliers`,
                        ]
                          .filter(Boolean)
                          .join(", ") || "—"}
                      </td>
                      <td className="py-1.5 text-xs">
                        {v.usable ? (
                          <span style={{ color: "var(--good)" }}>✓ yes</span>
                        ) : (
                          <span style={{ color: "var(--critical)" }}>
                            ✕ {v.problem}
                          </span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              );
            })}
          </table>
        </div>
        <p className="mt-2 text-xs text-muted">
          Raw files are kept byte-for-byte unchanged; this view describes the
          processed copy. Columns not in the standard schema are kept,
          filterable and usable in discovery goals.
          {q.synthetic
            ? " Synthetic test data — not NASA laboratory data."
            : ""}
        </p>
      </div>
    </Card>
  );
}
