"use client";

import { useState } from "react";

type Counts = { a: number; b: number; shared: number };
type Source = { label: string; url: string | null };
type Turn = { question: string; answer: string; sources: Source[] };
const prompts = [
  "How much do the two masks agree in this frame?",
  "What relationship did FLEX find between gas composition and burning rate after accounting for pressure?",
  "How reliable is the finding for spacecraft fire safety?",
  "Which experiment would test the remaining uncertainty?",
];

export function EvidenceChat({ frame, counts }: { frame?: string; counts?: Counts }) {
  const [turns, setTurns] = useState<Turn[]>([]);
  const [question, setQuestion] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  async function ask(input: string) {
    const text = input.trim();
    if (!text || busy) return;
    setBusy(true);
    setError("");
    setQuestion(text);
    try {
      const response = await fetch("/api/flight-evidence/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: text, frame, counts,
          history: turns.slice(-4).map(({ question, answer }) => ({ question, answer })) }),
        signal: AbortSignal.timeout(60000),
      });
      if (!response.ok) throw Error(response.status === 429
        ? "The assistant is busy. Try again in a minute." : "The assistant is unavailable. Please retry.");
      const { answer, sources } = await response.json();
      setTurns(old => [...old, { question: text, answer, sources }]);
      setQuestion("");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed. Please retry.");
    } finally {
      setBusy(false);
    }
  }
  return (
    <section className="mt-5 rounded-xl border border-line bg-surface p-4">
      <h3 className="font-display text-xl text-ink">Ask Falmex</h3>
      <p className="mt-1 text-sm text-muted">{frame ?? "Local frame"} · Ask about pixel counts, FLEX gas mixtures or a follow-up experiment. Questions and numeric evidence are sent for analysis. The image stays in your browser.</p>
      <div className="my-3 flex flex-wrap gap-2">{prompts.map(p =>
        <button key={p} type="button" disabled={busy} onClick={() => ask(p)}
          className="rounded-lg border border-line px-3 py-2 text-left text-xs text-ink hover:text-accent">{p}</button>)}</div>
      <div aria-live="polite" className="space-y-3">{turns.map((turn, i) =>
        <article className="border-l-2 border-line pl-3 text-sm" key={i}>
          <p dir="auto" className="font-medium text-ink">{turn.question}</p>
          <p dir="auto" className="mt-1 whitespace-pre-wrap text-ink-2">{turn.answer}</p>
          <div className="mt-2 flex flex-wrap gap-3 text-xs">{turn.sources.map(s => s.url
            ? <a key={s.label} className="text-accent underline" href={s.url} target="_blank" rel="noreferrer">{s.label}</a>
            : <span key={s.label}>{s.label} · local analysis</span>)}</div>
        </article>)}</div>
      <form className="mt-3 flex flex-wrap items-end gap-2" onSubmit={e => { e.preventDefault(); ask(question); }}>
        <label className="min-w-0 flex-1 text-xs text-muted">Your question
          <textarea dir="auto" maxLength={1200} rows={2} value={question} disabled={busy}
            onChange={e => setQuestion(e.target.value)}
            className="mt-1 block w-full rounded-lg border border-line bg-surface p-2 text-sm text-ink" />
        </label>
        <button type="submit" disabled={busy || !question.trim()} className="rounded-lg border border-line px-4 py-2 text-sm text-ink disabled:opacity-50">{busy ? "Answering…" : "Ask"}</button>
      </form>
      {error && <p role="alert" className="mt-2 text-sm text-ink">{error}</p>}
    </section>
  );
}
