"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";
import type { Showcase } from "@/lib/types";

const f2 = (v: number) => (v < 0 ? `−${Math.abs(v).toFixed(2)}` : v.toFixed(2));

/**
 * The "why trust it" example. Every number is computed live by the engine
 * (GET /api/showcase, synthetic test data) — nothing here is typed in by hand. The values are
 * always shown in their final state; only the bar widths animate on scroll (landing-fx).
 */
export function TrustCard() {
  const [s, setS] = useState<Showcase | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    api
      .showcase()
      .then(setS)
      .catch(() => setError(true));
  }, []);

  if (error) {
    return (
      <div className="card" style={{ padding: 30 }}>
        <p style={{ color: "var(--l-ink2)" }}>
          The live example could not be computed right now (the analysis engine
          is unreachable).
        </p>
      </div>
    );
  }

  const oxygen = s?.controls.oxygen;
  const pressure = s?.controls.pressure;

  return (
    <div
      className="card"
      data-reveal
      data-trust-card
      data-found={s ? Math.abs(s.effect_all_rows) : undefined}
      data-oxygen={oxygen ? Math.abs(oxygen.effect) : undefined}
      data-pressure={pressure ? Math.abs(pressure.effect) : undefined}
      aria-busy={!s}
      style={{ padding: 30 }}
    >
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          gap: 8,
          flexWrap: "wrap",
        }}
      >
        <span className="badge">
          <span className="dot" style={{ background: "var(--l-good)" }} />
          Replicated on unseen data
        </span>
        <span className="synth">Synthetic test data · not NASA</span>
      </div>
      <p
        className="serif"
        style={{ fontSize: 28, margin: "18px 0 6px", lineHeight: 1.2 }}
      >
        {s?.headline ?? "Computing the example…"}
      </p>
      <p style={{ fontSize: 13, color: "var(--l-muted)" }}>
        {s
          ? `Rank correlation · ${s.n_experiments} experiments · split by experiment: ${s.split.discovery_experiments} discovery / ${s.split.holdout_experiments} unseen, ${s.split.shared_across_split.experiment_id ?? 0} shared`
          : "Running the engine on synthetic test data…"}
      </p>

      <div className="checks">
        <div className="check">
          1 · Discovery data<b>{s ? `ρ = ${f2(s.discovery_effect)}` : "…"}</b>
        </div>
        <div className="check">
          2 · Unseen data<b>{s ? `ρ = ${f2(s.unseen_effect)}` : "…"}</b>
        </div>
        <div className="check">
          3 · Random shuffles as strong
          <b>{s ? `${s.shuffles_as_strong} / ${s.permutations}` : "…"}</b>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--l-muted)", margin: "20px 0 0" }}>
        4 · Third-variable check — the same {s?.n_experiments ?? "…"}{" "}
        experiments, re-measured while holding one other condition fixed:
      </p>
      <div className="bars" style={{ marginTop: 12 }}>
        <div className="bar">
          <span>No variable held fixed</span>
          <div className="track">
            <div
              className="fill"
              data-bar="found"
              style={{ background: "var(--l-blue)" }}
            />
          </div>
          <span>{s ? f2(s.effect_all_rows) : "…"}</span>
        </div>
        <div className="bar">
          <span>Oxygen held fixed</span>
          <div className="track">
            <div
              className="fill"
              data-bar="oxygen"
              style={{ background: "var(--l-bad)" }}
            />
          </div>
          <span>{oxygen ? f2(oxygen.effect) : "…"}</span>
        </div>
        <div className="bar">
          <span>Pressure held fixed</span>
          <div className="track">
            <div
              className="fill"
              data-bar="pressure"
              style={{ background: "#2d4f8f" }}
            />
          </div>
          <span>{pressure ? f2(pressure.effect) : "…"}</span>
        </div>
      </div>
      {s && oxygen && pressure && (
        <div className="verdict" data-verdict>
          <b>Result:</b> with oxygen held fixed only{" "}
          {Math.round(oxygen.retained_share * 100)}% of the association remains
          ({f2(s.effect_all_rows)} → {f2(oxygen.effect)}), so it is largely
          explained by oxygen. Holding pressure fixed changes nothing (
          {f2(pressure.effect)}), so pressure does not explain it. The finding
          stays visible with this warning and ranks {s.rank} of {s.of} validated
          findings for this outcome.
        </div>
      )}
    </div>
  );
}
