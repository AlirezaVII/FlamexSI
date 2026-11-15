"use client";

import Link from "next/link";
import { Orb } from "@/components/orb";

type Counts = { a: number; b: number; shared: number };
const prompts = [
  "How much do the two masks agree in this frame?",
  "What relationship did FLEX find between gas composition and burning rate after accounting for pressure?",
  "How reliable is the finding for spacecraft fire safety?",
  "Which experiment would test the remaining uncertainty?",
];

/** Opens Ask FlamexSI with this frame (or the frame measured in the browser) as context. */
export function EvidenceChat({ frame, counts }: { frame?: string; counts?: Counts }) {
  const ctx = frame
    ? `frame=${encodeURIComponent(frame)}`
    : counts
      ? `a=${counts.a}&b=${counts.b}&shared=${counts.shared}`
      : "";
  const href = (q?: string) =>
    `/assistant?${[ctx, q ? `q=${encodeURIComponent(q)}` : ""].filter(Boolean).join("&")}`;
  return (
    <section className="mt-5 rounded-2xl border border-line bg-surface p-4">
      <div className="flex items-center gap-3">
        <Orb mode="searching" size={40} label="Ask FlamexSI" />
        <div className="min-w-0">
          <h3 className="font-display text-xl text-ink">Ask FlamexSI about {frame ?? "this frame"}</h3>
          <p className="text-sm text-muted">
            The research assistant answers from the NASA results with every number cited; this
            frame&apos;s pixel counts come along as evidence.
          </p>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {prompts.map((p) => (
          <Link key={p} href={href(p)}
            className="rounded-full border border-line px-3 py-1.5 text-xs text-ink-2 hover:border-accent hover:text-ink">
            {p}
          </Link>
        ))}
        <Link href={href()} className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white">
          Open the assistant →
        </Link>
      </div>
    </section>
  );
}
