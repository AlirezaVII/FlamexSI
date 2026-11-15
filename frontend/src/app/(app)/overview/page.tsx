"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { StatSkeleton } from "@/components/loading";
import { Card, ErrorNote, Stat } from "@/components/ui";
import { api } from "@/lib/api";
import type { DiscoveryGoal } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

const SECTIONS = [
  {
    href: "/explorer",
    title: "Explore",
    text: "Find and filter experiments by any variable in the data. No conclusions here, just the data.",
  },
  {
    href: "/compare",
    title: "Compare",
    text: "See which variables differ between experiments, with repeated measurements and their spread.",
  },
  {
    href: "/relationships",
    title: "Discover",
    text: "Pick a goal or explore openly. Associations are found on part of the data and validated on the rest.",
  },
  {
    href: "/findings",
    title: "Findings",
    text: "Validated findings, ranked, each with its evidence, uncertainty, limitations and checks.",
  },
  {
    href: "/insights",
    title: "Insights",
    text: "Findings a researcher reviewed and interpreted. Created by people, never automatically.",
  },
  {
    href: "/innovation",
    title: "Innovate",
    text: "Beyond the challenge: what new capability an insight makes possible. AI suggests, the team decides.",
  },
];

export default function Home() {
  const { dataset, datasets, error, loading } = useWorkspace();
  const [llm, setLlm] = useState<string | null | undefined>(undefined);
  const [goals, setGoals] = useState<DiscoveryGoal[]>([]);
  const datasetId = dataset?.dataset_id;

  useEffect(() => {
    if (!datasetId) return;
    api
      .goals(datasetId)
      .then((g) =>
        setGoals(g.goals.filter((x) => x.kind !== "open").slice(0, 3)),
      )
      .catch(() => setGoals([]));
  }, [datasetId]);

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
          comparable and explainable. Falmex finds statistical associations
          between experiment conditions and flame behaviour, checks whether they
          hold up on data it never saw, and shows the evidence behind every
          finding. Interpreting them scientifically stays with researchers.
        </p>
        {goals.length > 0 && (
          <div className="mt-6">
            <p className="mb-2 text-xs text-muted">
              Example questions, generated from the columns of the current
              dataset
              {dataset?.synthetic ? " (synthetic test data)" : ""}. Discovery is
              not limited to these.
            </p>
            <div className="flex flex-wrap gap-2">
              {goals.map((g) => (
                <Link
                  key={g.id}
                  href={`/relationships?goal=${encodeURIComponent(g.id)}`}
                  className="rounded-full border border-line px-3 py-1.5 text-sm text-ink-2 hover:border-accent hover:text-ink"
                >
                  {g.question}
                </Link>
              ))}
            </div>
          </div>
        )}
      </section>

      {error && <ErrorNote message={error} />}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
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
