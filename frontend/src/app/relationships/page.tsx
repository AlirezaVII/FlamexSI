"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { FindingList } from "@/components/finding-list";
import { Button, Card, ErrorNote, NoDataset, PageHeader, SyntheticBanner } from "@/components/ui";
import { api, label } from "@/lib/api";
import type { Finding, Variable } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";

export default function RelationshipsPage() {
  const { dataset } = useWorkspace();
  const [outcomes, setOutcomes] = useState<Variable[]>([]);
  const [outcome, setOutcome] = useState("extinction");
  const [findings, setFindings] = useState<Finding[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showWeak, setShowWeak] = useState(false);

  const datasetId = dataset?.dataset_id;

  useEffect(() => {
    if (!dataset) return;
    api
      .meta()
      .then((m) => {
        const present = m.variables.filter(
          (v) => v.role === "outcome" && dataset.columns.includes(v.name),
        );
        setOutcomes(present);
        setOutcome((o) => (present.some((v) => v.name === o) ? o : (present[0]?.name ?? o)));
      })
      .catch((e) => setError(e.message));
  }, [dataset]);

  const load = useCallback(async () => {
    if (!datasetId) return;
    try {
      setFindings(await api.findings({ dataset_id: datasetId }));
      setLoaded(true);
      setError(null);
    } catch (e) {
      setError((e as Error).message);
    }
  }, [datasetId]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on dataset change
    load();
  }, [load]);

  async function discover() {
    if (!datasetId) return;
    setBusy(true);
    try {
      await api.discover(datasetId);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const forOutcome = useMemo(
    () => findings.filter((f) => f.outcome === outcome),
    [findings, outcome],
  );
  const strong = forOutcome.filter((f) => f.status === "validated" || f.status === "candidate");
  const weak = forOutcome.filter((f) => f.status === "rejected" || f.status === "not_significant");

  if (!dataset) return <NoDataset />;

  return (
    <>
      <PageHeader eyebrow="Discover" title={`What affects ${label(outcome)}?`}>
        Every condition is tested against the outcome on 70% of experiments. Relationships that
        look significant are then re-tested on the 30% the engine never saw, and against random
        shuffles. Only relationships that survive both are marked validated.
      </PageHeader>
      {dataset.synthetic && <SyntheticBanner />}

      <div className="mb-4 flex flex-wrap items-center gap-2">
        {outcomes.map((o) => (
          <button
            key={o.name}
            onClick={() => setOutcome(o.name)}
            className={`rounded-full border px-3 py-1.5 text-sm ${o.name === outcome ? "border-accent bg-surface font-medium text-ink" : "border-line text-ink-2 hover:text-ink"}`}
          >
            {label(o.name)}
          </button>
        ))}
        <Button className="ml-auto" onClick={discover} disabled={busy}>
          {busy ? "Analyzing…" : findings.length ? "Re-run discovery" : "Run discovery"}
        </Button>
      </div>

      {error && <ErrorNote message={error} />}

      {loaded && findings.length === 0 ? (
        <Card>
          <p className="text-sm text-ink-2">
            No analysis yet for this dataset. Run discovery to test every condition against every
            outcome.
          </p>
        </Card>
      ) : (
        <div className="space-y-4">
          <Card title={`Supported relationships (${strong.length})`}>
            <FindingList findings={strong} />
          </Card>
          <Card
            title={`Not supported (${weak.length})`}
            action={
              <Button variant="ghost" onClick={() => setShowWeak((s) => !s)}>
                {showWeak ? "Hide" : "Show"}
              </Button>
            }
          >
            {showWeak ? (
              <FindingList findings={weak} />
            ) : (
              <p className="text-sm text-muted">
                Conditions with no evidence of an effect, or effects that failed validation.
                Knowing what does <em>not</em> matter is a result too.
              </p>
            )}
          </Card>
        </div>
      )}
    </>
  );
}
