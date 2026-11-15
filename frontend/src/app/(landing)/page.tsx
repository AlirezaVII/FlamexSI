import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { FlameLab } from "@/components/landing/flame-lab";
import { LandingFX } from "@/components/landing/landing-fx";
import { Team } from "@/components/landing/team";
import { TrustCard } from "@/components/landing/trust-card";
import { BrandLogo } from "@/components/logo";
import { ThemeToggle } from "@/components/theme-toggle";

export const metadata: Metadata = {
  title: "Falmex — Findings you can verify",
  description:
    "Falmex is built to find associations in NASA microgravity combustion data, re-test each one on experiments it never saw, and show the evidence behind it. Explore measured FLEX results and BASS-II image evidence.",
};

// A pre-rendered Earth, inlined into the HTML: the globe is on screen the moment the page
// arrives, before any JavaScript or texture has downloaded. The live 3D globe crossfades in
// over it when ready.
const EARTH_STILL = `data:image/webp;base64,${readFileSync(
  join(process.cwd(), "public/textures/earth-disc.webp"),
).toString("base64")}`;

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
      {/* the mission: a trajectory Earth -> Moon -> Mars that draws itself as you scroll */}
      <svg className="mission" aria-hidden>
        <defs>
          <linearGradient id="route-grad" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0" stopColor="var(--l-hl)" />
            <stop offset="1" stopColor="#ff9a6a" />
          </linearGradient>
        </defs>
        <path data-route-bg className="route-bg" />
        <path data-route className="route" pathLength={1} />
        <g data-craft className="craft">
          <path className="plume" d="M0 0 L-16 -3.5 Q-22 0 -16 3.5 Z" />
          <circle r="3.4" />
        </g>
      </svg>
      {/* a gravity tag that follows the planet you are visiting */}
      <div className="gtag" data-gtag aria-hidden>
        <svg viewBox="-16 -40 32 56">
          <defs>
            <radialGradient id="gflame" cx="50%" cy="70%" r="70%">
              <stop offset="0" stopColor="#fff6d8" />
              <stop offset="0.35" stopColor="var(--gf-core, #ffc24a)" />
              <stop offset="1" stopColor="var(--gf-edge, #ff6a1f)" stopOpacity="0.15" />
            </radialGradient>
          </defs>
          <path data-gflame fill="url(#gflame)" />
          <circle r="2.2" cy="0" fill="#3a2a1a" />
        </svg>
        <span>
          <b data-gname>Earth</b>
          <small data-gval>1.00 g · teardrop flame</small>
        </span>
      </div>

      <header className="topbar">
        <nav className="navrow" aria-label="Main">
          <Link href="/" className="brand serif">
            <BrandLogo size={34} /> Falmex
          </Link>
          <a className="nl" href="#trust">
            Why trust it
          </a>
          <a className="nl" href="#freefall">
            Fire in freefall
          </a>
          <a className="nl" href="#team">
            Team
          </a>
          <span style={{ flex: 1 }} />
          <div
            className="journey"
            aria-label="Journey: where the page has taken you. Gravity values are reference physical constants, not experiment data."
            title="Reference surface gravity of Earth, orbit, the Moon and Mars (physical constants) — part of the story, not experiment data"
          >
            <ol>
              <li>Earth</li>
              <li>Orbit</li>
              <li>Moon</li>
              <li>Mars</li>
            </ol>
            <span className="g">
              <small>ref. gravity</small>
              <b data-gravity>1.00 g</b>
            </span>
          </div>
          <span className="theme">
            <ThemeToggle />
          </span>
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
                NASA Space Apps Challenge 2026 · Flame in Freefall
              </div>
              <h1 className="serif">
                Decades of microgravity flame experiments.
                <br />
                <span className="hl">
                  Findings you can verify.
                </span>
              </h1>
              <p className="lead">
                Compare oxygen conditions using 274 FLEX experiments, inspect competing
                flame annotations on BASS-II footage, and generate a scientific report
                that records where each measurement stops supporting a conclusion.
              </p>
              <div className="cta">
                <Link className="btn primary" href="/flight-evidence">
                  Explore the flight evidence →
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
              {/* eslint-disable-next-line @next/next/no-img-element -- inline data URI */}
              <img className="earth-still" src={EARTH_STILL} alt="" aria-hidden />
              <span className="grab-hint" data-grab-hint>
                ⟲ Drag to rotate Earth
              </span>
            </div>
          </div>
        </div>

        <section className="wrap block" id="freefall">
          <div className="freefall">
            <div>
              <div className="eyebrow">Fire in freefall</div>
              <h2 className="serif" data-reveal>
                Take gravity away,
                <br />
                and fire changes shape.
              </h2>
              <p className="sub">
                On Earth, hot gas rises and drags fresh air in behind it: the
                flame stretches up, flickers and glows yellow with soot. In
                orbit nothing rises. Oxygen reaches the flame only by slow
                diffusion, so it closes into a dim, steady, bluish sphere —
                harder to see, and behaving by different rules.
              </p>
              <p className="sub">
                That is why fire safety for crews cannot simply copy what we
                know on the ground, and why NASA has burned candles, droplets
                and fabrics in microgravity for decades. Falmex turns those
                experiments into findings you can check.
              </p>
              <p className="fine">
                Drag the gravity slider, or keep scrolling: the chamber follows
                the journey from Earth to orbit, the Moon and Mars. An
                illustration of the well-known effect, not a combustion
                simulation.
              </p>
            </div>
            <FlameLab />
          </div>
        </section>

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
                A pattern that looks real is not enough. In this example a
                variable is strongly associated with burn time and the
                association even holds up on unseen experiments — but when
                Falmex holds oxygen fixed, it almost disappears. It is flagged
                and ranked down, not reported as a discovery. The numbers on the
                card are computed live by the engine.
              </p>
              <p
                className="sub"
                style={{ marginTop: 14, fontSize: 14, color: "var(--l-muted)" }}
              >
                This controlled example uses synthetic data with a known confounder.
              </p>
            </div>
            <TrustCard />
          </div>
        </section>

        <section className="wrap block" id="status">
          <div className="eyebrow">Status</div>
          <h2 className="serif" data-reveal>
            What works today, and what does not yet.
          </h2>
          <p className="sub">
            So that this page never claims more than the program can do.
            The flight evidence section uses NASA FLEX measurements and BASS-II frames. Synthetic examples exercise the discovery workflow.
          </p>
          <div className="statusgrid">
            <div className="card" data-reveal>
              <h3 className="serif">
                <span
                  className="dot"
                  style={{ background: "var(--l-good)", marginRight: 10 }}
                />
                Working and tested
              </h3>
              <ul>
                <li>
                  Load CSV, Excel, JSON and Parquet files; the original is
                  stored untouched
                </li>
                <li>
                  Cleaning, unit conversion and a data-quality report with a
                  reason for every change
                </li>
                <li>
                  Filters, comparison and discovery goals generated from the
                  dataset&apos;s own columns
                </li>
                <li>
                  Associations found on 70% of experiments, re-tested on the
                  unseen 30% (split by experiment or by source, with a leakage
                  check)
                </li>
                <li>
                  Random-shuffle test, multiple-testing correction, bootstrap
                  uncertainty
                </li>
                <li>
                  Third-variable checks, evidence and limitations on every
                  finding
                </li>
                <li>
                  AI explanations written only from the computed statistics
                </li>
              </ul>
            </div>
            <div className="card" data-reveal>
              <h3 className="serif">
                <span
                  className="dot"
                  style={{ background: "var(--l-muted)", marginRight: 10 }}
                />
                Not yet
              </h3>
              <ul>
                <li>
                  Independent evaluation on a new flight campaign
                </li>
                <li>Operational flame or smoke alarms</li>
                <li>Non-linear and multi-variable (interaction) analyses</li>
                <li>
                  Expert-reviewed insights — none exist yet; expert sign-off is separate from internal evaluation
                </li>
              </ul>
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
                <BrandLogo size={30} />
              </div>
              <h3 className="serif">Explore &amp; compare</h3>
              <p>
                Filters and comparisons are generated from your dataset&apos;s
                own variables. See what differs between experiments — and where
                similar conditions led to different flames.
              </p>
            </div>
            <div className="card" data-reveal>
              <div className="ficon" style={{ color: "var(--l-hl)", fontSize: 20 }}>
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

        <Team />

        <div className="final">
          <div className="wrap">
            <h2 className="serif">
              Start with the data.
              <br />
              Let it tell you what to look for.
            </h2>
            <div className="cta" style={{ justifyContent: "center" }}>
              <Link className="btn primary" href="/flight-evidence">
                Explore the flight evidence →
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
          Falmex · NASA Space Apps Challenge 2026 · Flame in Freefall · Planet
          maps: NASA
        </span>
        <span>
          Findings are statistical associations and require expert review.
        </span>
      </footer>
    </>
  );
}
