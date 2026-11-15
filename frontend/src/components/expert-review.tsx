"use client";

import { useState } from "react";
import { Button } from "@/components/ui";
import { api } from "@/lib/api";
import type { ExpertVerdict, Insight } from "@/lib/types";

/* Evidence level 7 is the one step FlamexSI can never take itself: a domain expert reads
 * the insight and its evidence and signs off. This records who reviewed it, their
 * credentials and their verdict, in the open, next to the insight. */

const VERDICTS: [ExpertVerdict, string, string][] = [
  ["endorse", "Endorse", "The evidence supports the insight as written."],
  ["endorse_with_changes", "Endorse with changes", "Right direction; the wording or scope needs edits first."],
  ["reject", "Reject", "The evidence does not support it."],
];
const VERDICT_STYLE: Record<ExpertVerdict, string> = {
  endorse: "border-good/40 bg-good/10 text-good",
  endorse_with_changes: "border-accent/40 bg-accent/10 text-accent",
  reject: "border-serious/40 bg-serious/10 text-serious",
};
const input =
  "w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40";

export function ExpertReviewPanel({ insight, onChange }: {
  insight: Insight; onChange: (updated: Insight) => void;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ reviewer: "", credentials: "", verdict: "endorse" as ExpertVerdict, comment: "" });
  const r = insight.readiness;
  const reviews = insight.expert_reviews ?? [];

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      onChange(await api.addExpertReview(insight.insight_id, form));
      setOpen(false);
      setForm({ reviewer: "", credentials: "", verdict: "endorse", comment: "" });
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-line p-3">
      {r && (
        <div>
          <div className="flex items-center justify-between gap-3">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">Evidence readiness</p>
            <p className="text-xs tabular-nums text-ink-2">level {r.level} of {r.of}</p>
          </div>
          <div className="mt-1.5 flex gap-1" aria-hidden>
            {Array.from({ length: r.of }, (_, i) => (
              <span key={i} className={`h-1.5 flex-1 rounded-full ${i < r.level ? (i === 6 ? "bg-good" : "bg-accent") : "bg-surface-2"}`} />
            ))}
          </div>
          <p className="mt-1.5 text-sm text-ink">{r.label}</p>
          {r.note ? <p className="mt-0.5 text-xs text-ink-2">{r.note}</p>
            : r.level < 7 && <p className="mt-0.5 text-xs text-muted">Next: {r.next}</p>}
        </div>
      )}

      <div className="mt-3 border-t border-line pt-3">
        <p className="text-xs font-medium uppercase tracking-wider text-muted">
          Expert review {reviews.length > 0 && `(${reviews.length})`}
        </p>
        {reviews.length === 0 ? (
          <p className="mt-1 text-xs text-ink-2">
            Not reviewed by a domain expert yet. FlamexSI never signs off on its own results.
          </p>
        ) : (
          <ul className="mt-2 space-y-2">
            {reviews.map((v) => (
              <li key={v.reviewed_at + v.reviewer} className="text-sm">
                <span className={`mr-2 rounded-full border px-2 py-0.5 text-xs ${VERDICT_STYLE[v.verdict]}`}>
                  {VERDICTS.find((x) => x[0] === v.verdict)?.[1]}
                </span>
                <b className="text-ink">{v.reviewer}</b>
                <span className="text-muted"> · {v.credentials} · {new Date(v.reviewed_at).toLocaleDateString()}</span>
                <p className="mt-1 whitespace-pre-line text-ink-2">{v.comment}</p>
              </li>
            ))}
          </ul>
        )}
        {!open ? (
          <Button variant="ghost" className="mt-2" onClick={() => setOpen(true)}>
            Add an expert review
          </Button>
        ) : (
          <form onSubmit={submit} className="mt-3 grid gap-2 sm:grid-cols-2">
            <label className="text-xs text-muted">Reviewer name
              <input required minLength={2} maxLength={120} className={input} value={form.reviewer}
                onChange={(e) => setForm({ ...form, reviewer: e.target.value })} />
            </label>
            <label className="text-xs text-muted">Role and affiliation
              <input required minLength={3} maxLength={200} className={input} placeholder="e.g. Combustion researcher, University of …"
                value={form.credentials} onChange={(e) => setForm({ ...form, credentials: e.target.value })} />
            </label>
            <fieldset className="sm:col-span-2">
              <legend className="mb-1 text-xs text-muted">Verdict</legend>
              <div className="flex flex-wrap gap-2">
                {VERDICTS.map(([id, name, hint]) => (
                  <label key={id} title={hint} className={`cursor-pointer rounded-full border px-3 py-1.5 text-xs ${form.verdict === id ? VERDICT_STYLE[id] : "border-line text-ink-2"}`}>
                    <input type="radio" name={`verdict-${insight.insight_id}`} value={id} checked={form.verdict === id}
                      onChange={() => setForm({ ...form, verdict: id })} className="sr-only" />
                    {name}
                  </label>
                ))}
              </div>
            </fieldset>
            <label className="text-xs text-muted sm:col-span-2">Review (what you checked, what you agree or disagree with)
              <textarea required minLength={10} maxLength={4000} rows={4} className={input} value={form.comment}
                onChange={(e) => setForm({ ...form, comment: e.target.value })} />
            </label>
            {error && <p className="text-xs text-serious sm:col-span-2" role="alert">{error}</p>}
            <div className="flex gap-2 sm:col-span-2">
              <Button type="submit" disabled={busy}>{busy ? "Saving…" : "Save review"}</Button>
              <Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancel</Button>
            </div>
            <p className="text-xs text-muted sm:col-span-2">
              Reviews are public and kept with the insight. Only an endorsement on evidence that
              already meets levels 1 to 6 lifts it to level 7; one rejection blocks it.
            </p>
          </form>
        )}
      </div>
    </div>
  );
}
