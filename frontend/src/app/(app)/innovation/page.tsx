"use client";

import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useState } from "react";
import { ListSkeleton, LoadingLabel } from "@/components/loading";
import { Button, Card, ErrorNote, PageHeader } from "@/components/ui";
import { api } from "@/lib/api";
import { INNOVATION_KINDS, STAGES } from "@/lib/labels";
import type {
  Innovation,
  InnovationKind,
  InnovationStage,
  InnovationSuggestion,
  Insight,
} from "@/lib/types";

const FLOW = ["Insight", "Innovation", "Build", "Prototype", "Demo & story"];
const BOARD: InnovationStage[] = [
  "idea",
  "evaluating",
  "building",
  "prototype",
  "demo",
];

export default function InnovationPage() {
  return (
    <Suspense fallback={<ListSkeleton rows={3} />}>
      <Innovations />
    </Suspense>
  );
}

function Innovations() {
  const preselect = useSearchParams().get("insight");
  const [insights, setInsights] = useState<Insight[] | null>(null);
  const [items, setItems] = useState<Innovation[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    Promise.all([api.insights(), api.innovations()])
      .then(([ins, inn]) => {
        setInsights(ins);
        setItems(inn);
      })
      .catch((e) => setError(e.message));
  }, []);

  const byId = new Map((insights ?? []).map((i) => [i.insight_id, i]));
  const upsert = (x: Innovation) =>
    setItems((list) => [
      x,
      ...(list ?? []).filter((i) => i.innovation_id !== x.innovation_id),
    ]);

  return (
    <>
      <PageHeader eyebrow="Beyond the challenge" title="Innovation">
        Once the team reaches an insight about fire safety, the next question
        is: what new capability does it make possible? The answer is not chosen
        in advance. It comes out of the insight. The AI can suggest directions;
        the team decides what is worth building.
      </PageHeader>

      <ol className="mb-6 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs">
        {FLOW.map((s, i) => (
          <li key={s} className="flex items-center gap-2">
            <span
              className={
                i === 1
                  ? "rounded-full bg-accent px-2 py-0.5 text-accent-ink"
                  : "rounded-full border border-line px-2 py-0.5 text-ink-2"
              }
            >
              {s}
            </span>
            {i < FLOW.length - 1 && (
              <span aria-hidden className="text-muted">
                →
              </span>
            )}
          </li>
        ))}
      </ol>

      {error && <ErrorNote message={error} />}

      {insights === null || items === null ? (
        <Card>
          <ListSkeleton rows={3} />
        </Card>
      ) : insights.length === 0 ? (
        <EmptyState />
      ) : (
        <>
          <NewInnovation
            insights={insights}
            preselect={preselect}
            onCreated={upsert}
          />
          <div className="mt-6 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
            {BOARD.map((stage) => {
              const list = items.filter((i) => i.stage === stage);
              return (
                <section key={stage} aria-label={STAGES[stage]}>
                  <h2 className="mb-2 flex items-center justify-between text-xs font-medium uppercase tracking-wider text-muted">
                    {STAGES[stage]}
                    <span className="tabular-nums">{list.length}</span>
                  </h2>
                  <div className="space-y-3">
                    {list.map((x) => (
                      <InnovationCard
                        key={x.innovation_id}
                        item={x}
                        insights={byId}
                        onChange={upsert}
                      />
                    ))}
                    {list.length === 0 && (
                      <p className="rounded-lg border border-dashed border-line p-3 text-xs text-muted">
                        Nothing here yet
                      </p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
          {items.some((i) => i.stage === "dropped") && (
            <details className="mt-6">
              <summary className="cursor-pointer text-sm text-ink-2">
                Dropped ideas (
                {items.filter((i) => i.stage === "dropped").length})
              </summary>
              <div className="mt-3 grid gap-3 md:grid-cols-2">
                {items
                  .filter((i) => i.stage === "dropped")
                  .map((x) => (
                    <InnovationCard
                      key={x.innovation_id}
                      item={x}
                      insights={byId}
                      onChange={upsert}
                    />
                  ))}
              </div>
            </details>
          )}
        </>
      )}
    </>
  );
}

function EmptyState() {
  return (
    <Card>
      <p className="text-sm text-ink-2">
        No insights yet, so nothing to build on. Innovation starts from a{" "}
        <Link href="/insights" className="font-medium text-accent">
          reviewed insight
        </Link>{" "}
        from real NASA data, never from a raw finding or from synthetic test
        data.
      </p>
      <p className="mt-4 text-xs text-muted">An insight may lead to…</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {Object.values(INNOVATION_KINDS).map((k) => (
          <span
            key={k}
            className="rounded-full border border-line bg-surface-2 px-3 py-1 text-xs text-ink-2"
          >
            {k === "Something else"
              ? "…or something nobody has thought of yet"
              : k}
          </span>
        ))}
      </div>
    </Card>
  );
}

function NewInnovation({
  insights,
  preselect,
  onCreated,
}: {
  insights: Insight[];
  preselect: string | null;
  onCreated: (x: Innovation) => void;
}) {
  const initial =
    insights.find((i) => i.insight_id === preselect)?.insight_id ??
    insights[0].insight_id;
  const [insightId, setInsightId] = useState(initial);
  const [suggestions, setSuggestions] = useState<InnovationSuggestion[] | null>(
    null,
  );
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({
    title: "",
    kind: "indicator" as InnovationKind,
    enables: "",
    description: "",
    proposed_by: "",
  });
  const insight = insights.find((i) => i.insight_id === insightId);

  async function suggest() {
    setBusy(true);
    setError(null);
    try {
      setSuggestions((await api.suggestInnovations(insightId)).suggestions);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    setError(null);
    try {
      onCreated(
        await api.createInnovation({ ...form, insight_ids: [insightId] }),
      );
      setForm({ ...form, title: "", enables: "", description: "" });
      setSuggestions(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <Card title="New innovation">
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">
          Built on the insight
        </span>
        <select
          value={insightId}
          onChange={(e) => {
            setInsightId(e.target.value);
            setSuggestions(null);
          }}
          className="w-full rounded-md border border-line bg-surface px-2 py-1.5"
        >
          {insights.map((i) => (
            <option key={i.insight_id} value={i.insight_id}>
              {i.statement}
            </option>
          ))}
        </select>
      </label>
      {insight && (
        <p className="mt-2 text-xs text-ink-2">
          <span className="text-muted">Fire safety: </span>
          {insight.fire_safety_relevance}
        </p>
      )}

      <div className="mt-4 flex flex-wrap items-center gap-3">
        <Button variant="ghost" onClick={suggest} disabled={busy}>
          {busy ? "Thinking…" : "Ask AI for directions"}
        </Button>
        <span className="text-xs text-muted">
          Suggestions only. Nothing is saved until the team chooses.
        </span>
      </div>
      {error && (
        <div className="mt-3">
          <ErrorNote message={error} />
        </div>
      )}
      {busy && (
        <div className="mt-3">
          <LoadingLabel>Reading the insight…</LoadingLabel>
        </div>
      )}
      {suggestions && !busy && (
        <ul className="fade-in mt-3 grid gap-2 md:grid-cols-2">
          {suggestions.map((s) => (
            <li key={s.title} className="rounded-lg border border-line p-3">
              <p className="text-xs uppercase tracking-wider text-muted">
                {INNOVATION_KINDS[s.kind]}
              </p>
              <p className="text-sm font-medium text-ink">{s.title}</p>
              <p className="mt-1 text-sm text-ink-2">{s.enables}</p>
              <p className="mt-1 text-xs text-muted">{s.rationale}</p>
              <button
                type="button"
                className="mt-2 text-xs font-medium text-accent"
                onClick={() =>
                  setForm({
                    ...form,
                    title: s.title,
                    kind: s.kind,
                    enables: s.enables,
                    description: s.rationale,
                  })
                }
              >
                Use as a starting point ↓
              </button>
            </li>
          ))}
        </ul>
      )}

      <div className="mt-4 grid gap-3 border-t border-line pt-4">
        <fieldset>
          <legend className="mb-1 text-xs text-muted">Kind</legend>
          <div className="flex flex-wrap gap-2">
            {(Object.keys(INNOVATION_KINDS) as InnovationKind[]).map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => setForm({ ...form, kind: k })}
                className={`rounded-full border px-3 py-1 text-xs ${form.kind === k ? "border-accent bg-accent text-accent-ink" : "border-line text-ink-2 hover:bg-surface-2"}`}
              >
                {INNOVATION_KINDS[k]}
              </button>
            ))}
          </div>
        </fieldset>
        {(
          [
            ["title", "Name", 1],
            ["enables", "The new capability it makes possible", 2],
            ["description", "How it would work", 2],
            ["proposed_by", "Proposed by", 1],
          ] as const
        ).map(([k, l, rows]) => (
          <label key={k} className="text-sm">
            <span className="mb-1 block text-xs text-muted">{l}</span>
            <textarea
              rows={rows}
              value={form[k]}
              onChange={(e) => setForm({ ...form, [k]: e.target.value })}
              className="w-full rounded-md border border-line bg-surface px-2 py-1.5"
            />
          </label>
        ))}
        <div>
          <Button onClick={save}>Add to the board</Button>
        </div>
      </div>
    </Card>
  );
}

function InnovationCard({
  item,
  insights,
  onChange,
}: {
  item: Innovation;
  insights: Map<string, Insight>;
  onChange: (x: Innovation) => void;
}) {
  const [note, setNote] = useState(item.decision_note);
  const [error, setError] = useState<string | null>(null);

  async function update(body: {
    stage?: InnovationStage;
    decision_note?: string;
  }) {
    try {
      onChange(await api.updateInnovation(item.innovation_id, body));
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  return (
    <article className="fade-in rounded-xl border border-line bg-surface p-3 shadow-card">
      <p className="text-[11px] uppercase tracking-wider text-accent">
        {INNOVATION_KINDS[item.kind]}
      </p>
      <h3 className="mt-0.5 text-sm font-semibold text-ink">{item.title}</h3>
      <p className="mt-1 text-sm text-ink-2">{item.enables}</p>
      {item.description && (
        <p className="mt-1 text-xs text-muted">{item.description}</p>
      )}
      <ul className="mt-2 space-y-0.5 text-xs text-muted">
        {item.insight_ids.map((id) => (
          <li key={id}>
            From:{" "}
            <Link href="/insights" className="text-accent">
              {insights.get(id)?.statement ?? id}
            </Link>
          </li>
        ))}
      </ul>
      <div className="mt-3 flex flex-wrap items-center gap-2 border-t border-line pt-2">
        <select
          aria-label="Stage"
          value={item.stage}
          onChange={(e) => update({ stage: e.target.value as InnovationStage })}
          className="rounded-md border border-line bg-surface px-2 py-1 text-xs"
        >
          {Object.entries(STAGES).map(([k, v]) => (
            <option key={k} value={k}>
              {v}
            </option>
          ))}
        </select>
        <span className="text-[11px] text-muted">by {item.proposed_by}</span>
      </div>
      <textarea
        aria-label="Team decision"
        rows={2}
        placeholder="Team decision: why keep, build or drop it"
        value={note}
        onChange={(e) => setNote(e.target.value)}
        onBlur={() =>
          note !== item.decision_note && update({ decision_note: note })
        }
        className="mt-2 w-full rounded-md border border-line bg-surface px-2 py-1 text-xs"
      />
      {error && (
        <p className="mt-1 text-xs" style={{ color: "var(--critical)" }}>
          {error}
        </p>
      )}
    </article>
  );
}
