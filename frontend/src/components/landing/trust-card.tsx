import Link from "next/link";
import showcase from "@/lib/flight/showcase.json";

const f2 = (v: number) => (v < 0 ? `−${Math.abs(v).toFixed(2)}` : v.toFixed(2));
const LABEL: Record<string, string> = {
  pressure: "Pressure",
  nitrogen_fraction: "Nitrogen fraction",
  carbon_dioxide_fraction: "CO₂ fraction",
  helium_fraction: "Helium fraction",
  initial_droplet_diameter: "Initial droplet diameter",
  oxygen: "Oxygen",
};

/**
 * The "why trust it" example, on the real NASA PSI-69 FLEX table: the top validated
 * finding with every check it went through, and a finding the same run threw out.
 * Built by backend/scripts/build_showcase.py from the findings the engine stored; nothing
 * is typed in by hand. Only the bar widths animate on scroll (landing-fx).
 */
export function TrustCard() {
  const s = showcase;
  const scale = Math.max(
    Math.abs(s.effect_all_rows ?? 0),
    ...s.controls.map((c) => Math.abs(c.effect)),
  );
  const w = (v: number) => ((Math.abs(v) / scale) * 92).toFixed(1);
  return (
    <div className="card" data-reveal data-trust-card style={{ padding: 30 }}>
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
        <span className="synth">
          Real NASA data · {s.source}
        </span>
      </div>
      <p
        className="serif"
        style={{ fontSize: 28, margin: "18px 0 6px", lineHeight: 1.2 }}
      >
        {s.headline}
      </p>
      <p style={{ fontSize: 13, color: "var(--l-muted)" }}>
        Rank correlation · {s.n_experiments} FLEX tests · split by test:{" "}
        {s.split.discovery_experiments} discovery / {s.split.holdout_experiments}{" "}
        unseen, {s.split.shared_across_split.experiment_id ?? 0} shared
      </p>

      <div className="checks">
        <div className="check">
          1 · Discovery tests<b>ρ = {f2(s.discovery_effect)}</b>
        </div>
        <div className="check">
          2 · Unseen tests<b>ρ = {f2(s.unseen_effect)}</b>
        </div>
        <div className="check">
          3 · Random shuffles as strong
          <b>
            {s.shuffles_as_strong} / {s.permutations}
          </b>
        </div>
      </div>

      <p style={{ fontSize: 12, color: "var(--l-muted)", margin: "20px 0 0" }}>
        4 · Third-variable check: the same tests, re-measured while holding one
        other condition fixed:
      </p>
      <div className="bars" style={{ marginTop: 12 }}>
        {s.effect_all_rows != null && (
          <div className="bar">
            <span>Nothing held fixed</span>
            <div className="track">
              <div
                className="fill"
                data-w={w(s.effect_all_rows)}
                style={{ background: "var(--l-blue)" }}
              />
            </div>
            <span>{f2(s.effect_all_rows)}</span>
          </div>
        )}
        {s.controls.map((c) => (
          <div className="bar" key={c.control}>
            <span>{LABEL[c.control] ?? c.control} fixed</span>
            <div className="track">
              <div
                className="fill"
                data-w={w(c.effect)}
                style={{
                  background:
                    c.verdict === "weakens" ? "var(--l-bad)" : "var(--l-good)",
                }}
              />
            </div>
            <span>{f2(c.effect)}</span>
          </div>
        ))}
      </div>
      <div className="verdict">
        <b>Result:</b> the association holds with every one of the{" "}
        {s.controls.length} other conditions held fixed (it keeps at least{" "}
        {Math.round(Math.min(...s.controls.map((c) => c.retained_share)) * 100)}%
        of its strength), so none of them explains it. It ranks first of {s.of}{" "}
        validated findings out of {s.tested} tested.{" "}
        <Link href={`/findings/${s.finding_id}`}>Open the finding →</Link>
      </div>
      <p style={{ fontSize: 13, color: "var(--l-muted)", margin: "16px 0 0" }}>
        <b style={{ color: "var(--l-ink2)" }}>Thrown out in the same run:</b>{" "}
        {s.rejected.headline}. {s.rejected.why}
      </p>
    </div>
  );
}
