import type { Metadata } from "next";
import Link from "next/link";
import { LandingFX } from "@/components/landing/landing-fx";
import { BrandLogo } from "@/components/logo";

export const metadata: Metadata = {
  title: "Falmex — Findings you can verify",
  description:
    "Falmex searches NASA microgravity combustion data for associations, re-tests every one on experiments it never saw, and shows the evidence behind it.",
};

// Deterministic star layers (rendered on the server; moved by parallax on the client).
function stars(
  count: number,
  seed: number,
  rMin: number,
  rMax: number,
  oMin: number,
  oMax: number,
) {
  return Array.from({ length: count }, (_, i) => {
    const k = i * seed + 7;
    return {
      x: (k * 7919) % 1600,
      y: (k * 104729) % 3600,
      r: rMin + (((k * 31) % 5) / 4) * (rMax - rMin),
      o: oMin + (((k * 13) % 5) / 4) * (oMax - oMin),
    };
  });
}
const SKY = [
  { speed: 0.12, fill: "#9fb3e6", list: stars(260, 3, 0.4, 0.8, 0.15, 0.45) },
  { speed: 0.32, fill: "#cfdcff", list: stars(120, 5, 0.8, 1.3, 0.3, 0.7) },
  { speed: 0.6, fill: "#ffffff", list: stars(40, 11, 1.3, 2, 0.5, 0.9) },
];

const STEPS = [
  [
    "01",
    "Data",
    "NASA files kept unchanged, standardised and quality-checked. Every change has a reason.",
  ],
  [
    "02",
    "Finding",
    "Associations between conditions and flame behaviour, found on 70% of experiments.",
  ],
  [
    "03",
    "Validation",
    "Re-tested on the 30% never seen, against random shuffles, and for hidden third variables.",
  ],
  [
    "04",
    "Evidence",
    "Which experiments, which files, how stable, what limits. AI explains it in plain words.",
  ],
];

export default function Landing() {
  return (
    <>
      <div className="sky" aria-hidden>
        {SKY.map((layer) => (
          <svg
            key={layer.speed}
            data-speed={layer.speed}
            width="1600"
            height="3600"
            fill={layer.fill}
          >
            {layer.list.map((s, i) => (
              <circle key={i} cx={s.x} cy={s.y} r={s.r} opacity={s.o} />
            ))}
          </svg>
        ))}
      </div>
      <LandingFX />

      <header className="topbar">
        <nav className="navrow" aria-label="Main">
          <Link href="/" className="brand serif">
            <BrandLogo size={34} variant="glow" /> Falmex
          </Link>
          <a className="nl" href="#how">
            How it works
          </a>
          <a className="nl" href="#trust">
            Why trust it
          </a>
          <span style={{ flex: 1 }} />
          <div
            className="journey"
            aria-label="Journey: where the page has taken you"
          >
            <ol>
              <li>Earth</li>
              <li>Orbit</li>
              <li>Moon</li>
              <li>Mars</li>
            </ol>
            <span className="g">
              <small>gravity</small>
              <b data-gravity>1.00 g</b>
            </span>
          </div>
          <Link
            className="btn ghost open-app"
            href="/overview"
            style={{ padding: "9px 18px", fontSize: 14 }}
          >
            Open the app →
          </Link>
        </nav>
        <div className="progress" />
      </header>

      <main>
        <div className="hero">
          <div className="wrap hero-grid">
            <div data-hero-copy>
              <div className="eyebrow">
                NASA Space Apps 2026 · Flame in Freefall
              </div>
              <h1 className="serif">
                Decades of microgravity flame experiments.
                <br />
                <span style={{ color: "#8fc0ff" }}>
                  Findings you can verify.
                </span>
              </h1>
              <p className="lead">
                Falmex searches NASA combustion data for patterns, re-tests
                every one on experiments it never saw, and shows the evidence
                behind it — so fire-safety researchers can trust what they read.
              </p>
              <div className="cta">
                <Link className="btn primary" href="/relationships">
                  Start discovering →
                </Link>
                <a className="btn ghost" href="#how">
                  How it works
                </a>
              </div>
              <p className="note">
                Statistical associations, never causal claims · AI explains,
                statistics decide
              </p>
            </div>
            <div className="grab" data-grab aria-label="Earth — drag to rotate">
              <span className="grab-hint" data-grab-hint>
                ⟲ Drag to rotate Earth
              </span>
            </div>
          </div>
        </div>

        <section className="wrap block">
          <div className="eyebrow" data-reveal>
            The problem
          </div>
          <h2 className="serif" data-reveal>
            The knowledge exists.
            <br />
            It is just hard to use.
          </h2>
          <p className="sub">
            As crews head back to the Moon and on to Mars, fire safety depends
            on what decades of microgravity experiments already taught us.
          </p>
          <div className="grid3">
            {[
              [
                "Scattered",
                "Results live across many experiments, files and formats.",
              ],
              [
                "Hard to compare",
                "Different conditions, units and measurements make experiments difficult to line up.",
              ],
              [
                "Easy to over-read",
                "With this much data, chance patterns look like discoveries unless every claim is tested.",
              ],
            ].map(([t, d]) => (
              <div key={t} className="card" data-reveal>
                <h3 className="serif">{t}</h3>
                <p>{d}</p>
              </div>
            ))}
          </div>
        </section>

        <section className="wrap block" id="how">
          <div className="eyebrow">How it works</div>
          <h2 className="serif" data-reveal>
            From raw data to a finding you can check.
          </h2>
          <div className="steps">
            {STEPS.map(([n, t, d]) => (
              <div key={n} className="card step" data-reveal>
                <span className="n">{n}</span>
                <h3 className="serif">{t}</h3>
                <p>{d}</p>
                <span className="arrow" aria-hidden>
                  →
                </span>
              </div>
            ))}
            <div className="card step human" data-reveal>
              <span className="n" style={{ color: "var(--l-ink2)" }}>
                05 · people
              </span>
              <h3 className="serif">Insight</h3>
              <p>
                Only after a researcher reviews and interprets a validated
                finding.
              </p>
            </div>
          </div>
        </section>

        <section className="wrap block" id="trust">
          <div className="trust">
            <div>
              <div className="eyebrow">Why trust it</div>
              <h2 className="serif" data-reveal>
                Falmex tries to prove itself wrong.
              </h2>
              <p className="sub">
                A pattern that looks real is not enough. Here a variable seemed
                strongly linked to burn time and even held up on unseen
                experiments — until Falmex held oxygen fixed and the link
                disappeared. It is flagged and ranked down, not reported as a
                discovery.
              </p>
              <p
                className="sub"
                style={{ marginTop: 14, fontSize: 14, color: "var(--l-muted)" }}
              >
                Shown on synthetic test data, built with deliberate traps, until
                NASA&apos;s challenge data is released.
              </p>
            </div>
            <div
              className="card"
              data-reveal
              data-trust-card
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
                  <span
                    className="dot"
                    style={{ background: "var(--l-good)" }}
                  />
                  Replicated on unseen data
                </span>
                <span className="synth">Synthetic test data · not NASA</span>
              </div>
              <p
                className="serif"
                style={{ fontSize: 28, margin: "18px 0 6px", lineHeight: 1.2 }}
              >
                Higher sample mass is associated with lower burn time
              </p>
              <p style={{ fontSize: 13, color: "var(--l-muted)" }}>
                Rank correlation · 300 experiments · discovery 210 / unseen 90
              </p>
              <div className="checks">
                <div className="check">
                  Discovery data<b>ρ = −0.67</b>
                </div>
                <div className="check">
                  Unseen data<b>ρ = −0.73</b>
                </div>
                <div className="check">
                  Random shuffles as strong<b>0 / 200</b>
                </div>
              </div>
              <div className="bars">
                <div className="bar">
                  <span>Effect as found</span>
                  <div className="track">
                    <div
                      className="fill"
                      data-bar="found"
                      style={{ background: "var(--l-blue)" }}
                    />
                  </div>
                  <span>−0.69</span>
                </div>
                <div className="bar">
                  <span>Holding oxygen fixed</span>
                  <div className="track">
                    <div className="fill" data-bar="oxygen" />
                  </div>
                  <span data-bar-value="oxygen">−0.69</span>
                </div>
                <div className="bar">
                  <span>Holding pressure fixed</span>
                  <div className="track">
                    <div
                      className="fill"
                      data-bar="pressure"
                      style={{ background: "#2d4f8f" }}
                    />
                  </div>
                  <span>−0.69</span>
                </div>
              </div>
              <div className="verdict" data-verdict>
                <b>Third-variable check:</b> the association is largely
                explained by oxygen. Kept visible with this warning, ranked
                below every independent finding.
              </div>
            </div>
          </div>
        </section>

        <section className="wrap block">
          <div className="eyebrow">For researchers</div>
          <h2 className="serif" data-reveal>
            Built around the data you bring.
          </h2>
          <div className="grid3">
            <div className="card" data-reveal>
              <div className="ficon">
                <BrandLogo size={30} variant="glow" />
              </div>
              <h3 className="serif">Explore &amp; compare</h3>
              <p>
                Filters and comparisons are generated from your dataset&apos;s
                own variables. See what differs between experiments — and where
                similar conditions led to different flames.
              </p>
            </div>
            <div className="card" data-reveal>
              <div className="ficon" style={{ color: "#8fc0ff", fontSize: 20 }}>
                ?
              </div>
              <h3 className="serif">Questions from the data</h3>
              <p>
                Discovery goals and follow-up questions are generated from the
                columns that exist — nothing is fixed to one outcome in advance.
              </p>
            </div>
            <div className="card" data-reveal>
              <div
                className="ficon"
                style={{ color: "var(--l-good)", fontSize: 18 }}
              >
                ✓
              </div>
              <h3 className="serif">Evidence on every finding</h3>
              <p>
                Validation details, uncertainty, source files, limitations and
                third-variable checks, one click away. AI only explains.
              </p>
            </div>
          </div>
        </section>

        <div className="final">
          <div className="wrap">
            <h2 className="serif">
              Start with the data.
              <br />
              Let it tell you what to look for.
            </h2>
            <div className="cta" style={{ justifyContent: "center" }}>
              <Link className="btn primary" href="/relationships">
                Start discovering →
              </Link>
              <Link className="btn ghost" href="/data">
                Load NASA data
              </Link>
            </div>
          </div>
        </div>
      </main>
      <footer>
        <span>
          Falmex · NASA Space Apps 2026 · Flame in Freefall · Planet maps: NASA
        </span>
        <span>
          Findings are statistical associations and require expert review.
        </span>
      </footer>
    </>
  );
}
