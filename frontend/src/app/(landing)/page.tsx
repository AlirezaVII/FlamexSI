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
import psi from "@/lib/psi/catalog.json";

// counts shown on the page come from the PSI catalog itself
const INVESTIGATIONS = psi as { acronym: string; pillars: string[] }[];
const byPillar = (p: string) => INVESTIGATIONS.filter((i) => i.pillars.includes(p));

export const metadata: Metadata = {
  title: "Falmex — Findings you can verify",
  description:
    "Falmex summarises, ranks and interprets NASA PSI combustion investigations for spacecraft, Moon and Mars fire safety, and tests the flight data itself: findings re-tested on experiments they never saw, with the evidence behind each.",
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
    "Find",
    "Every combustion investigation in NASA's PSI repository, summarised from NASA's own records: objective, fuel, conditions, sensors.",
  ],
  [
    "02",
    "Rank",
    "Ordered for your crew environment and fire-safety question, with the scoring criteria on the page.",
  ],
  [
    "03",
    "Test",
    "Associations in the flight data, re-tested on later experiments, against random shuffles and hidden third variables.",
  ],
  [
    "04",
    "Interpret",
    "Evidence, limits and what it means for spacecraft fire safety. AI explains only the computed facts.",
  ],
]

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
          <a className="nl" href="#pillars">
            Fire safety
          </a>
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
                Falmex summarises, ranks and interprets all {INVESTIGATIONS.length}{" "}
                combustion investigations in NASA&apos;s PSI repository, then tests
                the flight measurements themselves (274 FLEX experiments, BASS-II
                footage) to deliver fire-safety evidence for spacecraft, Moon and
                Mars bases, and pressurized rovers.
              </p>
              <div className="cta">
                <Link className="btn primary" href="/investigations">
                  Rank the investigations →
                </Link>
                <Link className="btn ghost" href="/flight-evidence">
                  Flight evidence
                </Link>
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
                `${INVESTIGATIONS.length} combustion investigations in NASA PSI, thousands of files, many formats.`,
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

        <section className="wrap block" id="pillars">
          <div className="eyebrow">NASA&apos;s three fire-safety questions</div>
          <h2 className="serif" data-reveal>
            Prevent it, detect it, put it out.
          </h2>
          <p className="sub">
            NASA&apos;s spacecraft fire-safety work rests on three pillars. Each card
            lists the PSI investigations that inform it.
          </p>
          <div className="grid3">
            {(
              [
                ["prevention", "Prevention", "Which materials burn, and at what oxygen and airflow? Flammability limits decide material selection, more so in oxygen-rich Moon-base air."],
                ["detection", "Detection", "Smoke in microgravity has different particle sizes, so detectors built for Earth can look for the wrong signature."],
                ["suppression", "Suppression", "How much inert gas puts a flame out? In FLEX, flames survived at lower oxygen in microgravity than on the ground."],
              ] as const
            ).map(([key, title, text]) => (
              <Link key={key} href="/investigations" className="card" data-reveal>
                <h3 className="serif">{title}</h3>
                <p>{text}</p>
                <p style={{ marginTop: 12, fontSize: 13, color: "var(--l-hl)" }}>
                  {byPillar(key).length} investigations:{" "}
                  {byPillar(key).slice(0, 6).map((i) => i.acronym).join(", ")}
                  {byPillar(key).length > 6 ? "…" : ""}
                </p>
              </Link>
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
                A teaching example: synthetic data with a planted confounder, so the
                right answer is known in advance. The same checks run on every finding
                from the real FLEX flight data.
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
                  Catalog of all {INVESTIGATIONS.length} PSI combustion investigations,
                  ranked by crew environment and fire-safety question, compared side
                  by side
                </li>
                <li>
                  274 FLEX flight experiments analysed: associations found, then
                  re-tested on later test dates and against random shuffles
                </li>
                <li>
                  Third-variable checks, uncertainty, sources and limitations on every
                  finding
                </li>
                <li>
                  Scientific report and Gemini interpretation written only from the
                  computed statistics
                </li>
                <li>
                  BASS-II camera frames annotated independently by two reviewers;
                  image models scored against both
                </li>
                <li>
                  Upload of PSI tables (CSV, TSV, TXT, Excel, JSON, Parquet); the
                  original file is kept untouched
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
                  Partial-gravity data: none exists in PSI yet (LUCI and FM2 will add
                  it); microgravity and 1 g results only bound the Moon and Mars
                </li>
                <li>
                  Raw instrument logs (for example FLEX-2) summarised per test before
                  analysis
                </li>
                <li>Numerical smoke-particle analysis of SAME / SAME-R</li>
                <li>Reliable flame detection in camera images (current models are weak)</li>
                <li>
                  Expert-reviewed insights: none yet; expert sign-off is separate from
                  internal evaluation
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
              <h3 className="serif">Rank &amp; compare investigations</h3>
              <p>
                Objectives, fuels, oxygen, pressure, airflow and sensors of every PSI
                investigation side by side, ranked for the habitat you design for.
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
              <Link className="btn primary" href="/investigations">
                Rank the investigations →
              </Link>
              <Link className="btn ghost" href="/flight-evidence">
                Flight evidence
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
