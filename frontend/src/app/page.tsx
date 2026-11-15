"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatSkeleton } from "@/components/loading";
import { Card, ErrorNote, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

const SECTIONS = [
  {
    href: "/explorer",
    title: "Explore",
    text: "Search and filter experiments by oxygen, pressure, flow, material and gravity.",
  },
  {
    href: "/compare",
    title: "Compare",
    text: "Put experiments side by side to see how conditions change flame behavior.",
  },
  {
    href: "/relationships",
    title: "Discover",
    text: "Ask what affects a flame outcome. Every relationship is validated on unseen data.",
  },
  {
    href: "/insights",
    title: "Insights",
    text: "Ranked, evidence-backed findings with AI explanations for fire safety review.",
  },
];

const QUESTIONS = [
  "What affects flame extinction?",
  "What controls the burning rate?",
  "Which conditions make ignition more likely?",
];

export default function Home() {
  const { dataset, datasets, error, loading } = useWorkspace();
  const [llm, setLlm] = useState<string | null | undefined>(undefined);

  useEffect(() => {
    api
      .health()
      .then((h) => setLlm(`${h.llm.provider} · ${h.llm.model}`))
      .catch(() => setLlm(null));
  }, []);

  return (
    <div className="space-y-8">
      <section className="rounded-2xl border border-line bg-surface px-6 py-10 shadow-card sm:px-10">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-accent">
          NASA Microgravity Combustion
        </p>
        <h1 className="mt-2 font-display text-5xl font-medium tracking-tight sm:text-6xl">
          Falmex
        </h1>
        <p className="mt-3 max-w-2xl text-ink-2">
          Decades of flame experiments in microgravity, made searchable,
          comparable and explainable. Falmex surfaces relationships between
          experiment conditions and flame behavior, checks whether they hold up
          on unseen data, and shows the evidence behind every claim.
        </p>
        <div className="mt-6 flex flex-wrap gap-2">
          {QUESTIONS.map((q) => (
            <Link
              key={q}
              href="/relationships"
              className="rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-accent hover:text-ink"
            >
              {q}
            </Link>
          ))}
        </div>
      </section>

      {error && <ErrorNote message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        {SECTIONS.map((s) => (
          <Link
            key={s.href}
            href={s.href}
            className="group rounded-xl border border-line bg-surface p-5 shadow-card transition duration-200 hover:-translate-y-0.5 hover:border-accent hover:shadow-card-hover motion-reduce:hover:translate-y-0"
          >
            <h2 className="font-display text-xl font-medium text-ink">
              {s.title}{" "}
              <span className="text-accent transition group-hover:translate-x-0.5">
                →
              </span>
            </h2>
            <p className="mt-1.5 text-sm text-ink-2">{s.text}</p>
          </Link>
        ))}
      </div>

      <Card title="Workspace">
        <div className="grid gap-4 sm:grid-cols-4">
          {loading ? (
            <>
              <StatSkeleton />
              <StatSkeleton />
              <StatSkeleton />
            </>
          ) : (
            <>
              <Stat label="Datasets" value={datasets.length} />
              <Stat
                label="Active dataset"
                value={dataset ? dataset.name : "—"}
              />
              <Stat label="Rows" value={dataset?.n_rows ?? "—"} />
            </>
          )}
          {llm === undefined ? (
            <StatSkeleton />
          ) : (
            <Stat label="AI model" value={llm ?? "offline"} />
          )}
        </div>
        {!loading && !dataset && (
          <p className="mt-4 text-sm text-ink-2">
            Start on the{" "}
            <Link
              href="/data"
              className="font-medium text-accent underline underline-offset-2"
            >
              Data page
            </Link>
            .
          </p>
        )}
      </Card>
    </div>
  );
}
