"use client";

import { useState } from "react";
import { LoadingLabel } from "@/components/loading";
import { Button, Card, ErrorNote } from "@/components/ui";
import { api } from "@/lib/api";
import type { Finding, Novelty, Reference, SearchPlan } from "@/lib/types";

export const NOVELTY: Record<Novelty, { label: string; hint: string }> = {
  unreviewed: {
    label: "Not checked yet",
    hint: "No one has checked prior work.",
  },
  known: {
    label: "Already known",
    hint: "Already described in NASA reports or the literature.",
  },
  partly_known: {
    label: "Partly known",
    hint: "Part of it is known, part is not.",
  },
  new_conditions: {
    label: "Known, new conditions",
    hint: "A known relationship seen under new conditions or a new combination.",
  },
  possibly_new: {
    label: "Possibly new",
    hint: "No prior description found. Needs expert confirmation.",
  },
};

const KIND: Record<Reference["kind"], string> = {
  nasa_primary: "NASA source",
  challenge: "Challenge material",
  paper: "Paper",
  other: "Other",
};

const emptyRef = (): Reference => ({
  title: "",
  url: "",
  kind: "nasa_primary",
  note: "",
});

/**
 * Step 8: was this finding already known? The system builds search terms and links (NASA
 * sources first); a person reads the sources and records the judgement. Only worth doing
 * for findings that matter, not for every finding.
 */
export function PriorKnowledgeCard({
  finding,
  onSaved,
}: {
  finding: Finding;
  onSaved: (f: Finding) => void;
}) {
  const [plan, setPlan] = useState<SearchPlan | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const pk = finding.prior_knowledge;
  const [form, setForm] = useState({
    novelty: (pk?.novelty ?? "partly_known") as Novelty,
    summary: pk?.summary ?? "",
    reviewer: pk?.reviewer ?? "",
    references: pk?.references.length ? pk.references : [emptyRef()],
  });

  const blocked = finding.synthetic
    ? "Prior knowledge is not recorded for synthetic test data. The search terms still work, to try the flow."
    : finding.status !== "validated" && finding.status !== "candidate"
      ? "Worth checking only for validated or candidate findings."
      : null;

  async function search() {
    setBusy(true);
    setError(null);
    try {
      setPlan(await api.searchPriorKnowledge(finding.finding_id));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    try {
      const saved = await api.savePriorKnowledge(finding.finding_id, {
        ...form,
        references: form.references.filter((r) => r.title.trim()),
      });
      onSaved(saved);
      setOpen(false);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const setRef = (i: number, patch: Partial<Reference>) =>
    setForm({
      ...form,
      references: form.references.map((r, j) =>
        j === i ? { ...r, ...patch } : r,
      ),
    });

  return (
    <Card
      title="Prior knowledge — was this already known?"
      className="mt-4"
      action={
        <Button
          variant={plan ? "ghost" : "primary"}
          onClick={search}
          disabled={busy}
        >
          {busy
            ? "Preparing…"
            : plan
              ? "New search terms"
              : "Find sources to check"}
        </Button>
      }
    >
      <p className="text-sm text-ink-2">
        Check important findings only. NASA&apos;s own reports and the challenge
        material come first; papers only when more is needed. The system builds
        the searches, people read the sources and judge what is new.
      </p>
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}

      {busy && (
        <div className="mt-3">
          <LoadingLabel>Writing search terms from this finding…</LoadingLabel>
        </div>
      )}
      {plan && !busy && (
        <div className="fade-in mt-4 space-y-2">
          {plan.queries.map((q) => (
            <div
              key={q.query}
              className="flex flex-wrap items-center gap-2 rounded-lg border border-line px-3 py-2 text-sm"
            >
              <span className="font-medium text-ink">“{q.query}”</span>
              <span className="ml-auto flex flex-wrap gap-2 text-xs">
                {q.links.map((l) => (
                  <a
                    key={l.site}
                    href={l.url}
                    target="_blank"
                    rel="noreferrer"
                    className="rounded-full border border-line px-2 py-0.5 text-accent hover:bg-surface-2"
                  >
                    {l.site} ↗
                  </a>
                ))}
              </span>
            </div>
          ))}
          <p className="text-xs text-muted">
            Experiment data:{" "}
            <a
              href={plan.nasa_psi}
              target="_blank"
              rel="noreferrer"
              className="text-accent"
            >
              NASA Physical Sciences Informatics ↗
            </a>
            . {plan.note} (terms by {plan.provider})
          </p>
        </div>
      )}

      {pk && (
        <div className="mt-4 rounded-lg border border-line bg-surface-2 p-3 text-sm">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            {NOVELTY[pk.novelty].label}
          </p>
          <p className="mt-1 text-ink">{pk.summary}</p>
          {pk.references.length > 0 && (
            <ul className="mt-2 space-y-1 text-xs text-ink-2">
              {pk.references.map((r) => (
                <li key={r.title}>
                  <span className="text-muted">{KIND[r.kind]}:</span>{" "}
                  {r.url ? (
                    <a
                      href={r.url}
                      target="_blank"
                      rel="noreferrer"
                      className="text-accent"
                    >
                      {r.title}
                    </a>
                  ) : (
                    r.title
                  )}
                  {r.note && <span> — {r.note}</span>}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-2 text-xs text-muted">
            Checked by {pk.reviewer} on{" "}
            {new Date(pk.reviewed_at).toLocaleDateString()}
          </p>
        </div>
      )}

      {blocked ? (
        <p className="mt-3 text-sm text-muted">{blocked}</p>
      ) : !open ? (
        <Button className="mt-3" variant="ghost" onClick={() => setOpen(true)}>
          {pk ? "Edit the check…" : "Record what the sources say…"}
        </Button>
      ) : (
        <div className="mt-4 grid gap-3">
          <fieldset>
            <legend className="mb-1 text-xs text-muted">
              Compared with prior work, this finding is…
            </legend>
            <div className="flex flex-wrap gap-2">
              {(Object.keys(NOVELTY) as Novelty[])
                .filter((n) => n !== "unreviewed")
                .map((n) => (
                  <button
                    key={n}
                    type="button"
                    title={NOVELTY[n].hint}
                    onClick={() => setForm({ ...form, novelty: n })}
                    className={`rounded-full border px-3 py-1 text-xs ${form.novelty === n ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
                  >
                    {NOVELTY[n].label}
                  </button>
                ))}
            </div>
          </fieldset>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">
              How it relates to what is known
            </span>
            <textarea
              rows={2}
              value={form.summary}
              onChange={(e) => setForm({ ...form, summary: e.target.value })}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5"
            />
          </label>
          <div className="space-y-2">
            <p className="text-xs text-muted">Sources read</p>
            {form.references.map((r, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[9rem_1fr_1fr]">
                <select
                  aria-label="Source type"
                  value={r.kind}
                  onChange={(e) =>
                    setRef(i, { kind: e.target.value as Reference["kind"] })
                  }
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                >
                  {Object.entries(KIND).map(([k, v]) => (
                    <option key={k} value={k}>
                      {v}
                    </option>
                  ))}
                </select>
                <input
                  aria-label="Title"
                  placeholder="Title"
                  value={r.title}
                  onChange={(e) => setRef(i, { title: e.target.value })}
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                />
                <input
                  aria-label="Link"
                  placeholder="Link (optional)"
                  value={r.url}
                  onChange={(e) => setRef(i, { url: e.target.value })}
                  className="rounded-md border border-line bg-surface px-2 py-1.5 text-sm"
                />
              </div>
            ))}
            <button
              type="button"
              onClick={() =>
                setForm({
                  ...form,
                  references: [...form.references, emptyRef()],
                })
              }
              className="text-xs text-accent"
            >
              + Add source
            </button>
          </div>
          <label className="text-sm">
            <span className="mb-1 block text-xs text-muted">Checked by</span>
            <input
              value={form.reviewer}
              onChange={(e) => setForm({ ...form, reviewer: e.target.value })}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5"
            />
          </label>
          <div className="flex gap-2">
            <Button onClick={save}>Save check</Button>
            <Button variant="ghost" onClick={() => setOpen(false)}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Card>
  );
}
