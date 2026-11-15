"use client";

import Link from "next/link";
import { Fragment, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import { Orb, type Stage } from "@/components/orb";

/* Ask FlamexSI: answers only from FlamexSI's NASA results, streamed with the real stages
 * the server is in (POST /api/assistant/ask, NDJSON), every number cited to a source card. */

interface Source { n: number; id: string; title: string; page: string }
interface Msg {
  role: "user" | "assistant";
  text: string;
  sources?: Source[];
  cited?: number[];
  invalid?: number[];
  followups?: string[];
  stage?: Stage;
  stageText?: string;
  status?: "streaming" | "done" | "error" | "stopped";
  error?: string;
  started?: number;
  seconds?: number;
}
type Ctx = { frame?: string; counts?: { a: number; b: number; shared: number } };

const STORE = "flamexsi.assistant";
const TOPICS: { title: string; mode: Parameters<typeof Orb>[0]["mode"]; qs: string[] }[] = [
  { title: "Fire detection", mode: "listening", qs: [
    "Why does the ISS smoke detector read Kapton smoke weakly?",
    "How late did the cabin smoke detector react in Saffire-III?"] },
  { title: "Oxygen & flames", mode: "solving", qs: [
    "Does more oxygen make droplets burn faster in the FLEX data?",
    "At what oxygen level do heptane droplet flames start to go out?"] },
  { title: "Moon & Mars", mode: "connecting", qs: [
    "What experiment would matter most for a Moon base?",
    "What can FlamexSI not tell us about Mars?"] },
  { title: "Seeing the flame", mode: "searching", qs: [
    "How well does OpenCV find the flame compared with people?",
    "How many FLEX-2 tests kept a flame after the igniter?"] },
  { title: "Can I trust it?", mode: "shaping", qs: [
    "How does FlamexSI decide a finding is real?",
    "Which investigations are about fire suppression?"] },
  { title: "Suppression", mode: "weaving", qs: [
    "What does helium or CO₂ in the atmosphere do to droplet burning?",
    "Which FLEX tests ended because the flame went out?"] },
];

export default function Assistant() {
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [ctx, setCtx] = useState<Ctx>({});
  const [now, setNow] = useState(0);
  const abort = useRef<AbortController | null>(null);
  const end = useRef<HTMLDivElement>(null);
  const box = useRef<HTMLTextAreaElement>(null);

  // restore the conversation; read ?q=, ?frame= and local-frame counts from the link
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      try {
        const saved = JSON.parse(sessionStorage.getItem(STORE) ?? "[]") as Msg[];
        setMsgs(saved.map((m) => (m.status === "streaming" ? { ...m, status: "stopped" } : m)));
      } catch {}
      const p = new URLSearchParams(window.location.search);
      const c: Ctx = {};
      if (p.get("frame")) c.frame = p.get("frame")!;
      if (p.get("a") && p.get("b") && p.get("shared"))
        c.counts = { a: +p.get("a")!, b: +p.get("b")!, shared: +p.get("shared")! };
      setCtx(c);
      if (p.get("q")) setInput(p.get("q")!);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(STORE, JSON.stringify(msgs.slice(-20)));
    } catch {}
  }, [msgs]);

  // a seconds counter while an answer is on its way
  useEffect(() => {
    if (!busy) return;
    const t = window.setInterval(() => setNow(Date.now()), 500);
    return () => window.clearInterval(t);
  }, [busy]);

  const scroll = () => end.current?.scrollIntoView({ behavior: "smooth", block: "end" });

  const ask = useCallback(async (raw: string) => {
    const q = raw.trim();
    if (!q || busy) return;
    setInput("");
    setBusy(true);
    const history = msgs
      .reduce<{ question: string; answer: string }[]>((acc, m, i) => {
        const next = msgs[i + 1];
        if (m.role === "user" && next?.role === "assistant" && next.status === "done" && next.text)
          acc.push({ question: m.text.slice(0, 1200), answer: next.text.slice(0, 6000) });
        return acc;
      }, [])
      .slice(-6);
    const started = Date.now();
    setMsgs((old) => [...old, { role: "user", text: q },
      { role: "assistant", text: "", status: "streaming", stage: "think",
        stageText: "Sending your question", started }]);
    const patch = (f: (m: Msg) => Msg) =>
      setMsgs((old) => { const c = old.slice(); c[c.length - 1] = f(c[c.length - 1]); return c; });
    const ctl = new AbortController();
    abort.current = ctl;
    const timer = window.setTimeout(() => ctl.abort("timeout"), 90_000);
    requestAnimationFrame(scroll);
    try {
      const res = await fetch("/api/assistant/ask", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, history, ...ctx }),
        signal: ctl.signal,
      });
      if (!res.ok || !res.body) {
        throw new Error(
          res.status === 429 ? "Too many questions right now. Try again in a minute."
          : res.status === 422 ? "Please shorten or rephrase the question (up to 1,200 characters)."
          : res.status === 503 ? "The assistant is not configured on this server."
          : "The assistant could not answer this time. Please try again.");
      }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";
        for (const line of lines) {
          if (!line.trim()) continue;
          const e = JSON.parse(line);
          if (e.type === "stage") patch((m) => ({ ...m, stage: e.stage, stageText: e.text }));
          else if (e.type === "sources") patch((m) => ({ ...m, sources: e.sources }));
          else if (e.type === "delta") patch((m) => ({ ...m, text: m.text + e.text }));
          else if (e.type === "done")
            patch((m) => ({ ...m, status: "done", cited: e.cited, invalid: e.invalid,
              followups: e.followups, seconds: (Date.now() - started) / 1000 }));
          else if (e.type === "error") throw new Error(e.message);
        }
        scroll();
      }
      patch((m) => (m.status === "streaming"
        ? { ...m, status: "error", error: "The answer was cut off. Please ask again." } : m));
    } catch (err) {
      const reason = ctl.signal.aborted ? String(ctl.signal.reason ?? "") : "";
      patch((m) => ({
        ...m,
        status: reason === "stopped" ? "stopped" : "error",
        stage: "error",
        error: reason === "stopped" ? undefined
          : reason === "timeout" ? "No answer after 90 seconds. Please try again."
          : err instanceof TypeError ? "No connection to the server. Check your network."
          : (err as Error).message,
        seconds: (Date.now() - started) / 1000,
      }));
    } finally {
      window.clearTimeout(timer);
      abort.current = null;
      setBusy(false);
      box.current?.focus();
    }
  }, [busy, msgs, ctx]);

  const last = msgs[msgs.length - 1];
  const empty = msgs.length === 0;

  return (
    <div className="mx-auto flex min-h-[calc(100dvh-8rem)] max-w-4xl flex-col">
      <header className="flex items-center justify-between gap-3 border-b border-line pb-3">
        <div className="flex items-center gap-3">
          <Orb stage={busy ? last?.stage ?? "think" : "idle"} size={36} label="Ask FlamexSI" />
          <div>
            <h1 className="font-display text-2xl leading-tight text-ink">Ask FlamexSI</h1>
            <p className="text-xs text-muted">
              Answers only from NASA flight data FlamexSI analysed · every number cited
            </p>
          </div>
        </div>
        {!empty && (
          <button
            type="button"
            disabled={busy}
            onClick={() => { setMsgs([]); setCtx({}); }}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 hover:text-ink disabled:opacity-40"
          >
            New chat
          </button>
        )}
      </header>

      {(ctx.frame || ctx.counts) && (
        <div className="mt-3 flex items-center justify-between gap-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-xs text-ink-2">
          <span>
            Asking about {ctx.frame ? <b className="text-ink">BASS-II frame {ctx.frame}</b>
              : <b className="text-ink">the frame you measured</b>}: its pixel counts are added to the evidence.
          </span>
          <button type="button" onClick={() => setCtx({})} className="text-accent">Remove</button>
        </div>
      )}

      <div className="flex-1 py-6">
        {empty ? (
          <Welcome onAsk={ask} />
        ) : (
          <div className="space-y-6">
            {msgs.map((m, i) =>
              m.role === "user" ? (
                <div key={i} className="flex justify-end">
                  <div dir="auto" className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md bg-accent px-4 py-2.5 text-sm text-white">
                    {m.text}
                  </div>
                </div>
              ) : (
                <Answer key={i} m={m} onAsk={ask} busy={busy} now={now} />
              ),
            )}
          </div>
        )}
        <div ref={end} />
      </div>

      <form
        className="sticky bottom-0 bg-bg/90 pb-3 pt-2 backdrop-blur"
        onSubmit={(e) => { e.preventDefault(); ask(input); }}
      >
        <div className="flex items-end gap-2 rounded-2xl border border-line bg-surface p-2 shadow-card focus-within:ring-2 focus-within:ring-accent/40">
          <textarea
            ref={box}
            dir="auto"
            rows={1}
            maxLength={1200}
            value={input}
            onChange={(e) => {
              setInput(e.target.value);
              e.target.style.height = "auto";
              e.target.style.height = `${Math.min(e.target.scrollHeight, 180)}px`;
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey && !e.nativeEvent.isComposing) {
                e.preventDefault();
                ask(input);
              }
            }}
            placeholder="Ask about the NASA flight data…"
            aria-label="Your question"
            className="max-h-44 min-h-[2.5rem] flex-1 resize-none bg-transparent px-2 py-2 text-sm text-ink outline-none placeholder:text-muted"
          />
          {busy ? (
            <button type="button" onClick={() => abort.current?.abort("stopped")}
              className="rounded-xl border border-line px-4 py-2 text-sm text-ink-2 hover:text-ink">
              Stop
            </button>
          ) : (
            <button type="submit" disabled={!input.trim()}
              className="rounded-xl bg-accent px-4 py-2 text-sm font-medium text-white disabled:opacity-40">
              Ask
            </button>
          )}
        </div>
        <p className="mt-1.5 flex justify-between px-1 text-[11px] text-muted">
          <span>Enter to send · Shift+Enter for a new line · Answers use Gemini and can be wrong; check the cited sources.</span>
          {input.length > 1000 && <span className="tabular-nums">{input.length}/1200</span>}
        </p>
      </form>
    </div>
  );
}

function Welcome({ onAsk }: { onAsk: (q: string) => void }) {
  const modes = ["breathing", "searching", "solving", "connecting", "composing", "weaving"] as const;
  const [i, setI] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setI((n) => (n + 1) % modes.length), 3200);
    return () => window.clearInterval(t);
  }, [modes.length]);
  return (
    <div className="flex flex-col items-center text-center">
      <Orb mode={modes[i]} size={132} label="Ask FlamexSI" />
      <h2 className="mt-4 font-display text-3xl text-ink">What do you want to know?</h2>
      <p className="mt-2 max-w-xl text-sm text-ink-2">
        I read FlamexSI&apos;s results from NASA&apos;s PSI flight experiments (FLEX, FLEX-2,
        SAME, Saffire-III, BASS-II and 22 investigations) and answer with every number cited.
        If the data cannot answer, I say what is missing.
      </p>
      <div className="mt-8 grid w-full gap-3 text-left sm:grid-cols-2 lg:grid-cols-3">
        {TOPICS.map((t) => (
          <div key={t.title} className="rounded-2xl border border-line bg-surface p-3">
            <div className="mb-2 flex items-center gap-2">
              <Orb mode={t.mode} size={20} label={t.title} />
              <span className="text-xs font-medium uppercase tracking-wider text-muted">{t.title}</span>
            </div>
            {t.qs.map((q) => (
              <button key={q} type="button" dir="auto" onClick={() => onAsk(q)}
                className="mb-1.5 block w-full rounded-lg bg-surface-2 px-3 py-2 text-left text-sm text-ink-2 transition hover:bg-accent/10 hover:text-ink">
                {q}
              </button>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

function Answer({ m, onAsk, busy, now }: {
  m: Msg; onAsk: (q: string) => void; busy: boolean; now: number;
}) {
  const streaming = m.status === "streaming";
  const secs = streaming && m.started ? Math.max(0, Math.floor((now - m.started) / 1000)) : m.seconds;
  const [open, setOpen] = useState<number | null>(null);
  const cited = new Set(m.cited ?? []);
  return (
    <div className="flex gap-3">
      <div className="mt-0.5 shrink-0">
        <Orb stage={streaming ? m.stage ?? "think" : "idle"} size={28}
          tint={streaming || m.status === "done"} label="FlamexSI" />
      </div>
      <div className="min-w-0 flex-1">
        {streaming && (
          <div role="status" aria-live="polite" className="mb-2 flex items-center gap-2 text-xs text-ink-2">
            <span key={m.stageText} className="think-sheen font-medium">{m.stageText}</span>
            <span className="tabular-nums text-muted">· {secs ?? 0} s</span>
          </div>
        )}
        {m.text && (
          <div dir="auto" className="prose-chat text-sm leading-relaxed text-ink">
            {renderMarkdown(m.text, (n) => setOpen(open === n ? null : n))}
            {streaming && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-accent align-middle" />}
          </div>
        )}
        {m.status === "error" && (
          <div className="mt-2 rounded-lg border border-line bg-surface-2 px-3 py-2 text-sm text-ink-2">
            <b style={{ color: "var(--critical)" }}>Could not answer:</b> {m.error}
          </div>
        )}
        {m.status === "stopped" && <p className="mt-2 text-xs text-muted">Stopped.</p>}
        {m.sources && m.sources.length > 0 && (m.status === "done" || streaming) && (
          <div className="mt-3 flex flex-wrap gap-1.5">
            {m.sources.map((s) => (
              <Link key={s.n} href={s.page} title={s.title}
                className={`inline-flex max-w-full items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] transition ${
                  cited.has(s.n) || open === s.n ? "border-accent/50 bg-accent/10 text-ink"
                    : "border-line text-muted hover:text-ink"}`}>
                <b className="text-accent">S{s.n}</b>
                <span className="truncate">{s.title}</span>
              </Link>
            ))}
          </div>
        )}
        {m.status === "done" && (
          <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted">
            <span>{m.seconds?.toFixed(1)} s</span>
            {(m.invalid?.length ?? 0) > 0 && <span>{m.invalid!.length} unsupported citation(s) removed</span>}
            <button type="button" onClick={() => navigator.clipboard?.writeText(m.text)} className="hover:text-ink">Copy</button>
          </div>
        )}
        {m.status === "done" && m.followups && m.followups.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {m.followups.map((q) => (
              <button key={q} type="button" disabled={busy} onClick={() => onAsk(q)}
                className="rounded-full border border-line bg-surface px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink disabled:opacity-40">
                {q}
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

/* A small, safe Markdown subset: paragraphs, - and 1. lists, ### headings, **bold**,
 * `code`, and [S1] citation chips. Text is never injected as HTML. */
function inline(text: string, cite: (n: number) => void): ReactNode[] {
  const out: ReactNode[] = [];
  const re = /(\*\*[^*]+\*\*|`[^`]+`|\[S\d+\](?:\s*\[S\d+\])*)/g;
  let lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text))) {
    if (m.index > lastIndex) out.push(text.slice(lastIndex, m.index));
    const tok = m[0];
    if (tok.startsWith("**")) out.push(<strong key={m.index}>{tok.slice(2, -2)}</strong>);
    else if (tok.startsWith("`"))
      out.push(<code key={m.index} className="rounded bg-surface-2 px-1 text-[0.9em]">{tok.slice(1, -1)}</code>);
    else
      out.push(
        <Fragment key={m.index}>
          {[...tok.matchAll(/S(\d+)/g)].map((c) => (
            <button key={c[1]} type="button" onClick={() => cite(+c[1])}
              className="mx-0.5 inline-flex h-4 min-w-4 items-center justify-center rounded bg-accent/15 px-1 align-super text-[10px] font-semibold text-accent">
              S{c[1]}
            </button>
          ))}
        </Fragment>,
      );
    lastIndex = m.index + tok.length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
}

/* Gemini sometimes writes $\rho = 0.6$ despite the prompt: turn it into plain symbols. */
const GREEK: Record<string, string> = {
  rho: "ρ", alpha: "α", beta: "β", gamma: "γ", delta: "δ", Delta: "Δ", mu: "µ", sigma: "σ",
  lambda: "λ", eta: "η", theta: "θ", pi: "π", chi: "χ", times: "×", cdot: "·", approx: "≈",
  le: "≤", leq: "≤", ge: "≥", geq: "≥", pm: "±", sim: "~", circ: "°", to: "→", rightarrow: "→",
};
function deLatex(text: string): string {
  return text.replace(/\$\$?([^$\n]{1,120})\$\$?/g, (_, inner: string) =>
    inner
      .replace(/\\text\{([^}]*)\}/g, "$1")
      .replace(/\\mathrm\{([^}]*)\}/g, "$1")
      .replace(/\\([A-Za-z]+)/g, (_m, w: string) => GREEK[w] ?? w)
      .replace(/_\{?([A-Za-z0-9]+)\}?/g, "$1")
      .replace(/\^\{?([A-Za-z0-9]+)\}?/g, "^$1")
      .replace(/\\%/g, "%")
      .replace(/[{}]/g, ""));
}

function renderMarkdown(raw: string, cite: (n: number) => void): ReactNode[] {
  const text = deLatex(raw);
  const blocks = text.replace(/\r/g, "").split(/\n{2,}/);
  return blocks.map((b, i) => {
    const lines = b.split("\n").filter((l) => l.trim());
    if (lines.length && lines.every((l) => /^\s*([-*•]|\d+[.)])\s+/.test(l))) {
      const ordered = /^\s*\d/.test(lines[0]);
      const items = lines.map((l, j) => <li key={j}>{inline(l.replace(/^\s*([-*•]|\d+[.)])\s+/, ""), cite)}</li>);
      return ordered ? <ol key={i} className="my-2 list-decimal space-y-1 ps-5">{items}</ol>
        : <ul key={i} className="my-2 list-disc space-y-1 ps-5">{items}</ul>;
    }
    if (/^#{1,6}\s/.test(b))
      return <h4 key={i} className="mb-1 mt-3 font-display text-base text-ink">{inline(b.replace(/^#{1,6}\s*/, ""), cite)}</h4>;
    return (
      <p key={i} className="my-2 first:mt-0">
        {lines.map((l, j) => (
          <Fragment key={j}>{j > 0 && <br />}{inline(l, cite)}</Fragment>
        ))}
      </p>
    );
  });
}
