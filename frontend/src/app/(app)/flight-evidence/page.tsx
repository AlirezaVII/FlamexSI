"use client";

import { EvidenceChat } from "./evidence-chat";
import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, Stat } from "@/components/ui";
import burning from "@/lib/flight/burning.json";
import frames from "@/lib/flight/frames.json";
import benchmark from "@/lib/flight/benchmark.json";
import audit from "@/lib/flight/holdout-audit.json";
import models from "@/lib/flight/models.json";
import nextExperiments from "@/lib/flight/next_experiments.json";
import transitions from "@/lib/flight/transitions.json";
import smoke from "@/lib/flight/smoke.json";
import saffire from "@/lib/flight/saffire.json";
import flex2 from "@/lib/flight/flex2.json";

/*
 * Flight evidence: NASA FLEX (PSI-69) droplet measurements and BASS-II frames.
 * Ported from the standalone flex-comparison.html into the app (same data, same backend
 * endpoint). Data files are written by backend/scripts/build_flex_decision_review.py.
 */

type Row = [number, number, number]; // condition, estimate, neighbours
interface Task {
  id: string;
  title: string;
  xname: string;
  yname: string;
  insight: string;
  options: Record<string, Row[]>;
  train: number;
  test: number;
  mae: number;
  baseline: number;
  cutoff: string;
  rho: number;
  finding: string;
}
const TASKS = models as unknown as Task[];
const FRAMES = frames as unknown as [string, number, number, number, number, number][];
const BURN = burning as unknown as Record<string, [number, number, number][]>;
const gain = (t: Task) => 100 * (1 - t.mae / t.baseline);
const f3 = (v: number) => v.toFixed(3);

// What each finding could mean for crew fire safety, phrased as a question for experts.
const SAFETY: Record<string, string> = {
  "Oxygen → extinction diameter ratio":
    "Richer oxygen let droplets burn down further before the visible flame went out. If this holds beyond FLEX, oxygen-enriched cabins may let small fuel fires persist longer: a question for follow-up tests, not a design limit.",
  "Initial diameter → extinction diameter":
    "Larger droplets went out at larger sizes. When extinction is compared across tests or vehicles, starting droplet size has to be matched, or the comparison can mislead.",
  "Oxygen → burning rate":
    "Higher oxygen ranked with faster burning. The predictive model does not beat the fuel median on the last window, so rely on the measured medians below rather than the model.",
};

// Cabin atmospheres from NASA programmes, used to read the FLEX measurements at their
// oxygen fraction. FLEX ran at its own pressures, so this compares oxygen fraction only.
const ATMOSPHERES = [
  {
    name: "Spacecraft & ISS cabin",
    o2: 0.21,
    note: "Sea-level air: about 21% oxygen at 14.7 psi.",
  },
  {
    name: "Moon base & pressurized rover",
    o2: 0.3,
    note: "Expected 30% oxygen or more at 10.2 psi or less, to shorten spacewalk pre-breathe (challenge text). More than 40% above Earth's oxygen: materials are much more flammable.",
  },
  {
    name: "Spacesuit / Apollo 1 cabin",
    o2: 1.0,
    note: "Suits hold 100% oxygen at 4.3 psi; Apollo 1 burned in pure oxygen on the pad (1967). FLEX did not go this high; ACME CFI-G tested gas flames with up to 85% oxygen (see Investigations).",
  },
];

const STUDIES: [string, string, string, string][] = [
  [
    "Visible extinction of a liquid droplet",
    "FLEX · liquid fuels",
    "Choose FLEX to compare observed droplet diameters and oxygen conditions. In some heptane experiments combustion continued after visible flame extinction. An optical measurement alone cannot establish complete extinction.",
    "https://www.nasa.gov/wp-content/uploads/2022/03/iss_technical_publication_030116.pdf",
  ],
  [
    "Flame spread over solid materials",
    "BASS-II · solid fuels",
    "BASS-II compared airflow, sample thickness, preheating and oxygen in a flow tunnel. Its solid samples address a different question from FLEX droplets. Our image analysis measures luminous regions only.",
    "https://ntrs.nasa.gov/citations/20160000593",
  ],
  [
    "Smoke sensing in microgravity",
    "SAME · smoke and aerosols",
    "SAME investigated particle size distributions and smoke transport in low gravity. Particle measurements would complement a camera when testing a smoke detector. This dashboard uses the investigation record as context.",
    "https://psi.nasa.gov/physci/repo/data/investigations/PSI-102",
  ],
  [
    "Fire hazards in a spacecraft cabin",
    "Saffire VI · practical-scale fires",
    "In uncrewed spacecraft tests, investigators measured smoke and gases alongside temperature. Consult the Saffire results when asking about cabin-scale hazards. The FLEX droplet model has no gas-concentration output.",
    "https://ntrs.nasa.gov/citations/20240007488",
  ],
];

const SECTIONS = [
  ["transition", "Transition finder"],
  ["next", "Next experiment"],
  ["atmosphere", "Mission check"],
  ["smoke", "Smoke detection"],
  ["saffire", "Saffire cabin fire"],
  ["flex2", "FLEX-2 raw logs"],
  ["ranking", "Ranking"],
  ["report", "Report & planner"],
  ["methods", "Methods & uncertainty"],
  ["sources", "NASA sources"],
  ["vision", "Image evidence"],
  ["burning", "Burning rates"],
] as const;

const select =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40";

export default function FlightEvidence() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="NASA FLEX · SAME · SAME-R · BASS-II" title="Reading fire in microgravity">
        In the FLEX experiments, droplets exposed to more oxygen tended to be smaller
        relative to their starting size when the visible flame disappeared. Compare two
        conditions, inspect the optical evidence, and see which conclusions the measurements
        support.
      </PageHeader>
      <nav className="flex flex-wrap gap-2 print:hidden" aria-label="Sections">
        {SECTIONS.map(([id, label]) => (
          <a
            key={id}
            href={`#${id}`}
            className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2 hover:text-ink"
          >
            {label}
          </a>
        ))}
      </nav>
      <NasaLessons />
      <ExtinctionCurve />
      <TransitionFinder />
      <NextExperiment />
      <AtmosphereCheck />
      <SmokeDetection />
      <SaffireCabin />
      <Flex2Logs />
      <Ranking />
      <ReportAndPlanner />
      <EvidenceMethods />
      <Sources />
      <ImageEvidence />
      <FrameTester />
      <BurningRates />
    </div>
  );
}

/* ---------------------------------------------------------------------------------- */

/** What NASA concluded from these experiments, next to what Falmex re-tested in the data. */
function NasaLessons() {
  return (
    <Card title="What microgravity fire experiments changed" className="print:hidden">
      <div className="grid gap-5 md:grid-cols-2">
        <div className="space-y-3 text-sm text-ink-2">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            NASA&apos;s conclusion from FLEX
          </p>
          <p className="font-display text-xl text-ink">
            Flames survive at lower oxygen in microgravity, so ground standards for
            inert-gas suppressants do not give the same margin of safety in space.
          </p>
          <p>
            FLEX showed that the flammability limit of heptane and methanol droplets is
            lower in reduced gravity. It also recorded combustion continuing as a
            &quot;cool flame&quot; after the visible flame went out.
          </p>
          <p className="text-xs text-muted">
            Source: NASA, A Researcher&apos;s Guide to ISS Combustion Science (2015).
          </p>
        </div>
        <div className="space-y-3 text-sm text-ink-2">
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            Three assumptions the experiments overturned
          </p>
          <ol className="list-decimal space-y-1.5 pl-5">
            <li>&quot;A steady fire cannot exist in still air in microgravity.&quot; A candle on Mir burned for 45 minutes.</li>
            <li>&quot;A fire goes out if ventilation is shut off.&quot;</li>
            <li>&quot;Microgravity is inherently safer, so ground tests are conservative.&quot; NASA-STD-6001&apos;s 1 g flame test may not be conservative in low gravity (BASS, SoFIE, FLARE).</li>
          </ol>
          <p className="text-xs font-medium uppercase tracking-wider text-accent">
            Re-tested here on the FLEX flight table (suppression)
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>Higher carbon dioxide fraction is associated with a lower droplet burning rate.</li>
            <li>Higher helium fraction is associated with a higher droplet burning rate.</li>
          </ul>
          <p className="text-xs text-muted">
            Associations validated on experiments the engine did not use to find them
            (Findings page, PSI-69). They describe FLEX droplets, not cabin fires.
          </p>
        </div>
      </div>
    </Card>
  );
}

function ExtinctionCurve() {
  const task = TASKS.find((t) => t.title.startsWith("Oxygen → extinction")) ?? TASKS[0];
  const W = 460;
  const H = 190;
  const x = (o: number) => 52 + ((o - 0.12) / (0.34 - 0.12)) * (W - 70);
  const y = (v: number) => 20 + (1 - v) * (H - 52);
  const colors: Record<string, string> = {
    Methanol: "var(--series-1)",
    Heptane: "var(--series-2)",
  };
  return (
    <Card className="print:hidden">
      <div className="grid items-center gap-5 md:grid-cols-[1fr_1.4fr]">
        <div>
          <h2 className="font-display text-2xl font-medium text-ink">
            What remains when the visible flame disappears?
          </h2>
          <p className="mt-2 text-sm text-ink-2">
            Predicted extinction diameter as a share of the starting diameter, at the oxygen
            levels actually flown. Model estimates at observed training conditions.
          </p>
          <div className="mt-3 flex gap-4 text-xs">
            {Object.keys(task.options).map((fuel) => (
              <span key={fuel} className="flex items-center gap-1.5 text-ink-2">
                <i className="h-2.5 w-2.5 rounded-full" style={{ background: colors[fuel] }} />
                {fuel}
              </span>
            ))}
          </div>
        </div>
        <svg
          viewBox={`0 0 ${W} ${H}`}
          className="w-full"
          role="img"
          aria-label="Predicted extinction diameter ratio at observed oxygen levels by fuel"
        >
          {[0, 0.5, 1].map((v) => (
            <g key={v}>
              <line x1={52} x2={W - 18} y1={y(v)} y2={y(v)} stroke="var(--grid)" />
              <text x={42} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)">
                {v.toFixed(1)}
              </text>
            </g>
          ))}
          {[0.12, 0.21, 0.34].map((o) => (
            <text key={o} x={x(o)} y={H - 18} textAnchor="middle" fontSize="11" fill="var(--muted)">
              {o}
            </text>
          ))}
          <text x={W / 2 + 18} y={H - 3} textAnchor="middle" fontSize="11" fill="var(--muted)">
            Oxygen mole fraction
          </text>
          {Object.entries(task.options).map(([fuel, rows]) => (
            <g key={fuel}>
              <polyline
                fill="none"
                stroke={colors[fuel]}
                strokeWidth={2.5}
                points={rows.map(([o, v]) => `${x(o)},${y(v)}`).join(" ")}
              />
              {rows.map(([o, v, n]) => (
                <circle key={o} cx={x(o)} cy={y(v)} r={3.2} fill={colors[fuel]}>
                  <title>{`${fuel} at ${o}: ${f3(v)} (${n} neighbouring experiments)`}</title>
                </circle>
              ))}
            </g>
          ))}
        </svg>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- */

interface Transition {
  n: number;
  tested_oxygen: [number, number];
  transition_oxygen: number | null;
  interval: [number, number] | null;
  shuffle_p: number;
  later_dates: { test_experiments: number; cutoff: string; balanced_accuracy: number; baseline: number } | null;
  status: "supported" | "candidate" | "none";
  levels: { oxygen: number; extinction: number; disruption: number; completion: number }[];
  by_diluent: Record<string, { n: number; transition_oxygen: number | null }>;
}
const TRANSITIONS = transitions as unknown as { method: string; fuels: Record<string, Transition> };
const pct = (v: number) => `${(v * 100).toFixed(1)}%`;

/** Fire Behavior Transition Finder: where does the end of a burn change with oxygen? */
function TransitionFinder() {
  return (
    <Card title="Fire behavior transition finder" className="scroll-mt-24 print:hidden">
      <span id="transition" className="sr-only" />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        FLEX records how each burn ended: the visible flame went out (extinction), the
        droplet broke apart (disruption), or the fuel burned away (completion). Below
        which oxygen level do flames go out? Falmex looks for that boundary, then tries to
        break it with shuffles and with test dates it did not use. It reports a boundary
        only if it survives.
      </p>
      <div className="grid gap-5 md:grid-cols-2">
        {Object.entries(TRANSITIONS.fuels).map(([fuel, t]) => {
          const max = Math.max(...t.levels.map((l) => l.extinction + l.disruption + l.completion));
          const badge =
            t.status === "supported"
              ? ["Supported boundary", "var(--good)"]
              : t.status === "candidate"
                ? ["Candidate: not confirmed on later dates", "var(--warning)"]
                : ["No boundary supported", "var(--muted)"];
          return (
            <div key={fuel} className="rounded-xl border border-line p-4">
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h3 className="font-display text-lg text-ink">{fuel}</h3>
                <span className="rounded-full px-2 py-0.5 text-xs" style={{ color: badge[1], border: `1px solid ${badge[1]}` }}>
                  {badge[0]}
                </span>
              </div>
              {t.transition_oxygen !== null && t.interval && (
                <p className="mt-1 text-sm text-ink-2">
                  Flames mostly went out below about{" "}
                  <b className="text-ink">{pct(t.transition_oxygen)}</b> oxygen (95% interval{" "}
                  {pct(t.interval[0])}–{pct(t.interval[1])}), {t.n} tests, shuffle p{" "}
                  {t.shuffle_p < 0.001 ? "< 0.001" : `= ${t.shuffle_p}`}.
                </p>
              )}
              <div className="mt-3 space-y-1" aria-label={`${fuel}: how burns ended at each oxygen level`}>
                {t.levels.map((l) => {
                  const total = l.extinction + l.disruption + l.completion;
                  return (
                    <div key={l.oxygen} className="grid grid-cols-[3rem_minmax(0,1fr)_2rem] items-center gap-2 text-xs">
                      <span className="tabular-nums text-muted">{pct(l.oxygen)}</span>
                      <div className="flex h-3 overflow-hidden rounded-full bg-surface-2" style={{ width: `${(100 * total) / max}%` }}>
                        <i style={{ width: `${(100 * l.extinction) / total}%`, background: "var(--series-1)" }} title={`${l.extinction} extinction`} />
                        <i style={{ width: `${(100 * l.disruption) / total}%`, background: "var(--series-2)" }} title={`${l.disruption} disruption`} />
                        <i style={{ width: `${(100 * l.completion) / total}%`, background: "var(--good)" }} title={`${l.completion} completion`} />
                      </div>
                      <span className="tabular-nums text-muted">{total}</span>
                    </div>
                  );
                })}
              </div>
              <p className="mt-2 flex flex-wrap gap-3 text-[11px] text-muted">
                <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--series-1)" }} />extinction</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--series-2)" }} />disruption</span>
                <span><i className="mr-1 inline-block h-2 w-2 rounded-full" style={{ background: "var(--good)" }} />completion</span>
              </p>
              {t.later_dates && (
                <p className="mt-2 text-xs text-ink-2">
                  Later-date check: fitted before {t.later_dates.cutoff}, scored on{" "}
                  {t.later_dates.test_experiments} later tests: balanced accuracy{" "}
                  {t.later_dates.balanced_accuracy} vs {t.later_dates.baseline} for always
                  predicting extinction.
                  {t.later_dates.balanced_accuracy <= t.later_dates.baseline &&
                    " The boundary did not predict later tests, so it is not reported as general."}
                </p>
              )}
              <p className="mt-1 text-xs text-muted">
                By suppressant:{" "}
                {Object.entries(t.by_diluent)
                  .map(([k, v]) => `${k} ${v.transition_oxygen !== null ? pct(v.transition_oxygen) : "no boundary"} (${v.n})`)
                  .join(" · ")}
              </p>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">
        A boundary in how FLEX burns ended, not the limiting oxygen index itself: pressure,
        diluent and droplet size vary between tests. Fire-safety reading: in these droplet
        tests the visible flame mostly went out below about 21% (heptane) and 24%
        (methanol) oxygen, and above that burns mostly ended in disruption or completion.
        The 30% expected in a Moon base lies above both; whether the boundary holds at
        Moon-base pressure is an experiment worth running.
      </p>
    </Card>
  );
}

interface Cell {
  fuel: string;
  oxygen: string;
  pressure: string;
  tests: number;
  habitat: number;
  boundary: number;
  value: number;
  why: string[];
}
const NEXT = nextExperiments as unknown as {
  method: string;
  moon_base_tests: number;
  suggestions: Cell[];
  grid: Cell[];
};

/** Which experiment adds the most information next? Coverage gaps of the FLEX table. */
function NextExperiment() {
  const fuels = [...new Set(NEXT.grid.map((c) => c.fuel))];
  const byNumber = (a: string, b: string) => parseFloat(a) - parseFloat(b);
  const oxy = [...new Set(NEXT.grid.map((c) => c.oxygen))].sort(byNumber);
  const press = [...new Set(NEXT.grid.map((c) => c.pressure))].sort(byNumber);
  return (
    <Card title="Which experiment should come next?" className="scroll-mt-24 print:hidden">
      <span id="next" className="sr-only" />
      <p className="mb-2 max-w-3xl text-sm text-ink-2">
        Where are the FLEX measurements thin, and where would one more test matter most
        for crews? Each cell counts the tests already flown at that oxygen and pressure.
      </p>
      <p className="mb-4 rounded-lg border-l-4 p-3 text-sm text-ink-2" style={{ borderColor: "var(--warning)", background: "var(--surface-2)" }}>
        <b className="text-ink">{NEXT.moon_base_tests} FLEX tests</b> were run at the
        planned Moon-base / rover atmosphere (30% oxygen or more at 8.2–10.2 psi). The
        conditions crews will live in have not been tested with burning droplets.
      </p>
      <ol className="mb-5 grid gap-2 md:grid-cols-2">
        {NEXT.suggestions.map((c, i) => (
          <li key={i} className="rounded-lg border border-line p-3 text-sm">
            <p className="font-medium text-ink">
              {i + 1}. {c.fuel} · {c.oxygen} oxygen · {c.pressure}
            </p>
            <p className="text-xs text-ink-2">{c.why.join(" · ")}</p>
            <p className="mt-1 text-xs tabular-nums text-muted">value {(c.value * 100).toFixed(0)} / 100</p>
          </li>
        ))}
      </ol>
      <div className="grid gap-5 md:grid-cols-2">
        {fuels.map((fuel) => (
          <div key={fuel} className="overflow-x-auto" data-lenis-prevent>
            <p className="mb-1 text-sm font-medium text-ink">{fuel}: tests flown</p>
            <table className="w-full min-w-[22rem] text-xs tabular-nums">
              <thead>
                <tr>
                  <th className="py-1 text-left font-normal text-muted">O₂ \ pressure</th>
                  {press.map((p) => (
                    <th key={p} className="px-1 py-1 text-center font-normal text-muted">{p.replace(" mmHg", "")}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {oxy.map((o) => (
                  <tr key={o}>
                    <td className="py-0.5 pr-2 text-muted">{o}</td>
                    {press.map((p) => {
                      const c = NEXT.grid.find((x) => x.fuel === fuel && x.oxygen === o && x.pressure === p)!;
                      const ring = c.habitat === 1 ? "2px solid var(--accent)" : undefined;
                      return (
                        <td key={p} className="px-0.5 py-0.5">
                          <div
                            className="grid h-7 place-items-center rounded"
                            style={{
                              background: c.tests ? `color-mix(in srgb, var(--series-1) ${Math.min(90, 15 + c.tests * 6)}%, transparent)` : "var(--surface-2)",
                              outline: ring,
                              color: c.tests > 8 ? "white" : "var(--ink-2)",
                            }}
                            title={c.why.join(" · ")}
                          >
                            {c.tests || "·"}
                          </div>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">Pressure in mmHg; outlined cells: Moon-base / rover atmosphere.</p>
          </div>
        ))}
      </div>
      <details className="mt-4 rounded-lg border border-line p-3 text-xs text-ink-2">
        <summary className="cursor-pointer font-medium text-ink">How the value is scored</summary>
        <p className="mt-2 whitespace-pre-line">{NEXT.method}</p>
      </details>
    </Card>
  );
}

/** Innovation: read the flight measurements at the oxygen level of real cabin atmospheres. */
function AtmosphereCheck() {
  const ratio = TASKS.find((t) => t.title.startsWith("Oxygen → extinction"))!;
  const nearest = (rows: [number, ...number[]][], o: number) =>
    rows.reduce((b, r) => (Math.abs(r[0] - o) < Math.abs(b[0] - o) ? r : b));
  const maxO2 = Math.max(...Object.values(BURN).flatMap((rows) => rows.map((r) => r[0])));
  return (
    <Card title="Mission atmosphere check" className="scroll-mt-24 print:hidden">
      <span id="atmosphere" className="sr-only" />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        Future habitats may not breathe sea-level air. What did the flight measurements show
        at the oxygen fraction each atmosphere uses? Measured medians where FLEX flew that
        oxygen level; nothing is extrapolated beyond the {maxO2} oxygen fraction FLEX tested.
      </p>
      <div className="grid gap-4 md:grid-cols-3">
        {ATMOSPHERES.map((a) => {
          const inRange = a.o2 <= maxO2 + 1e-9;
          return (
            <div key={a.name} className="rounded-xl border border-line bg-surface-2 p-4">
              <p className="text-xs uppercase tracking-wider text-accent">
                {Math.round(a.o2 * 100)}% oxygen
              </p>
              <h3 className="mt-1 font-display text-lg font-medium text-ink">{a.name}</h3>
              <p className="mt-1 text-xs text-muted">{a.note}</p>
              {inRange ? (
                <div className="mt-3 space-y-3">
                  {Object.entries(BURN).map(([fuel, rows]) => {
                    const at = nearest(rows, a.o2);
                    const ref = nearest(rows, 0.21);
                    const est = nearest(ratio.options[fuel], a.o2);
                    const delta = ((at[2] - ref[2]) / ref[2]) * 100;
                    return (
                      <div key={fuel}>
                        <p className="text-sm font-medium text-ink">{fuel}</p>
                        <p className="text-xs text-ink-2">
                          Median burning rate <b className="tabular-nums text-ink">{at[2].toFixed(2)}</b>{" "}
                          ({at[1]} experiments)
                          {a.o2 !== 0.21 && (
                            <span className="ml-1 tabular-nums" style={{ color: "var(--serious)" }}>
                              {delta >= 0 ? "+" : ""}
                              {delta.toFixed(0)}% vs 21%
                            </span>
                          )}
                        </p>
                        <p className="text-xs text-ink-2">
                          Flame went out at about{" "}
                          <b className="tabular-nums text-ink">{Math.round(est[1] * 100)}%</b> of
                          the starting diameter (model)
                        </p>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <p className="mt-3 rounded-lg border border-dashed border-line p-3 text-xs text-ink-2">
                  Outside the FLEX data: FLEX did not test this oxygen level, so Falmex makes
                  no estimate here. Higher-oxygen evidence exists only for gas flames
                  (ACME CFI-G, up to 85%); droplet and solid-material data at this level
                  is where new experiments are needed.
                </p>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-xs text-muted">
        Observational contrasts within FLEX droplet tests. Pressure, diluent and droplet size
        differ between experiments, and a droplet is not a cabin fire: use this to choose
        follow-up experiments, not to set oxygen limits.
      </p>
    </Card>
  );
}

const pv = (p: number | null | undefined) =>
  p == null ? "–" : p < 0.001 ? "p < 0.001" : `p = ${p.toFixed(3)}`;

/** Detection pillar: what the SAME and SAME-R smoke flights show, each flight tested on
 * its own so the second one is a replication (backend/scripts/build_smoke_insights.py). */
function SmokeDetection() {
  const flights = Object.entries(smoke.flights);
  const maxD = Math.max(...smoke.materials.map((m) => m.aged_diameter_um));
  const later = smoke.flights["SAME-R (2010)"];
  return (
    <Card title="Smoke detection · SAME and SAME-R" className="scroll-mt-24 print:hidden">
      <span id="smoke" className="sr-only" />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        Two ISS flights heated five spacecraft materials and measured the smoke:{" "}
        {smoke.fuel_tests} flight tests (SAME 2007, SAME-R 2010). Each question below is
        tested in both flights separately, so the 2010 flight checks the 2007 one.
      </p>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-wider text-accent">1 · Smoke ages</p>
          <p className="mt-1 font-display text-lg text-ink">
            Smoke held in the cabin air grows larger particles
          </p>
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {flights.map(([fl, v]) => (
              <li key={fl}>
                <b className="text-ink">{fl}</b>: larger after aging in {v.aging.grew} of{" "}
                {v.aging.pairs} samples, ×{v.aging.median_ratio} median ({pv(v.aging.p_value)})
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-wider text-accent">2 · Material matters</p>
          <p className="mt-1 font-display text-lg text-ink">
            Wire insulation smoke (Kapton) has the smallest particles
          </p>
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {flights.map(([fl, v]) => (
              <li key={fl}>
                <b className="text-ink">{fl}</b>: fresh-smoke size differs by material,{" "}
                {pv(v.material.p_value)}
                {(v.material.p_value ?? 1) >= 0.05 && " (not significant: few fresh tests)"}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-surface-2 p-4">
          <p className="text-xs uppercase tracking-wider text-accent">3 · The ISS detector</p>
          <p className="mt-1 font-display text-lg text-ink">
            The light-scattering detector reads Kapton and Teflon smoke weakly
          </p>
          <ul className="mt-2 space-y-1 text-xs text-ink-2">
            {flights.map(([fl, v]) => (
              <li key={fl}>
                <b className="text-ink">{fl}</b>: signal rises with particle size at the
                same smoke mass, ρ = {v.detector.partial_rho.toFixed(2)} (
                {v.detector.shuffles_as_strong} of {v.detector.shuffles} shuffles as strong)
              </li>
            ))}
          </ul>
        </div>
      </div>

      <div className="mt-5 overflow-x-auto">
        <table className="w-full min-w-[34rem] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-2 pr-3 font-medium">Material</th>
              <th className="py-2 pr-3 font-medium">Particle size, fresh → aged (µm)</th>
              <th className="py-2 pr-3 font-medium">ISS detector, median</th>
              <th className="py-2 font-medium">Tests</th>
            </tr>
          </thead>
          <tbody>
            {smoke.materials.map((m) => (
              <tr key={m.material} className="border-b border-line/60">
                <td className="py-2 pr-3 font-medium text-ink">{m.material}</td>
                <td className="py-2 pr-3">
                  <div className="flex items-center gap-2">
                    <div className="relative h-2 w-32 rounded-full bg-surface-2">
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-accent/35"
                        style={{ width: `${(m.aged_diameter_um / maxD) * 100}%` }}
                      />
                      <div
                        className="absolute inset-y-0 left-0 rounded-full bg-accent"
                        style={{ width: `${(m.fresh_diameter_um / maxD) * 100}%` }}
                      />
                    </div>
                    <span className="tabular-nums text-xs text-ink-2">
                      {m.fresh_diameter_um.toFixed(2)} → {m.aged_diameter_um.toFixed(2)}
                    </span>
                  </div>
                </td>
                <td className="py-2 pr-3 tabular-nums text-xs text-ink-2">
                  <b
                    className="text-ink"
                    style={{ color: m.detector_median_v < 2 ? "var(--serious)" : undefined }}
                  >
                    {m.detector_median_v.toFixed(2)} V
                  </b>
                  {m.at_full_scale > 0.5 && " (mostly at full scale)"}
                </td>
                <td className="py-2 tabular-nums text-xs text-ink-2">{m.tests}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <div className="mt-4 rounded-lg border-l-4 border-accent bg-surface-2 p-3 text-sm text-ink-2">
        <b className="text-ink">What it means for detection:</b> wire insulation (Kapton,
        Teflon) is a likely early fire source in spacecraft, and its smoke gave the ISS
        scattering detector a median of under 1 V, against about 6.2 V for the other
        materials. Teflon and lampwick smoke have almost the same particle size, so size alone
        does not explain the gap; the material does. A detector tuned on large, aged smoke may
        respond late to an electrical fire. The 2010 flight (n = {later.detector.n}) repeated
        the 2007 pattern.
      </div>
      <p className="mt-3 text-xs text-muted">
        {Math.round(smoke.full_scale_share * 100)}% of detector readings sit at the detector&apos;s
        full-scale output (about 6.2 V), so differences above that cannot be seen. The table
        does not include the alarm threshold, so these are signal levels, not alarm times.
        Associations in flight data, not a detector specification. Source: {smoke.source}.{" "}
        <a className="text-accent underline" href="/data/psi-101-same-smoke-tests.csv">
          Download the {smoke.tests}-test table (CSV)
        </a>
      </p>
    </Card>
  );
}

/** Saffire-III: a real fire on a Cygnus cargo craft (build_saffire_summary.py). */
function SaffireCabin() {
  const big = saffire.samples.find((x) => x.burn_s && x.burn_s > 60) ?? saffire.samples[0];
  const scat = big.detectors.CDH_F2PCM_SMK_DET_SCAT_SENS_P as {
    responded: boolean; first_s?: number; peak_s?: number; peak?: number; baseline?: number };
  const obs = big.detectors.CDH_F2PCM_SMK_DET_OBS_SENS_P as { responded: boolean };
  const t0 = saffire.series_t0;
  const rows = saffire.series as (number | null)[][];
  const tMin = (rows[0][0] as number) - t0;
  const tMax = (rows[rows.length - 1][0] as number) - t0;
  const rMax = Math.max(...rows.flatMap((r) => [r[1] ?? 0, r[2] ?? 0]));
  const sMax = Math.max(...rows.map((r) => r[3] ?? 0));
  const X = (t: number) => 40 + ((t - tMin) / (tMax - tMin)) * 540;
  const Yr = (v: number) => 170 - Math.max(0, (v + 20) / (rMax + 20)) * 150;
  const Ys = (v: number) => 170 - (v / sMax) * 150;
  const line = (i: number, y: (v: number) => number) =>
    rows.filter((r) => r[i] != null)
      .map((r) => `${X((r[0] as number) - t0).toFixed(1)},${y(r[i] as number).toFixed(1)}`).join(" ");
  const stats: [string, string][] = [
    ["Burn (radiometers lit)", `${big.burn_s} s`],
    ["Flame front: pair 1+3 → 2+4", `${big.spread_lag_s} s`],
    ["Smoke detector first responds", scat.responded ? `${scat.first_s} s after ignition` : "no response"],
    ["Cabin pressure rise", `+${big.pressure.rise} psi (${(big.pressure.rise * 6.895).toFixed(2)} kPa)`],
    ["Cabin temperature rise", `+${big.temperature.rise} °C`],
  ];
  return (
    <Card title="Saffire-III · a real fire inside a spacecraft" className="scroll-mt-24 print:hidden">
      <span id="saffire" className="sr-only" />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        On 5 June 2017, after leaving the ISS, the Cygnus cargo craft burned large material
        samples inside a closed box and logged what its sensors saw. Below is sample{" "}
        {big.sample}, from the craft&apos;s own telemetry: how long it burned, how the flame
        front moved, and when the smoke detector noticed.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-xs text-muted">{k}</p>
            <p className="mt-1 font-display text-lg tabular-nums text-ink">{v}</p>
          </div>
        ))}
      </div>
      <svg viewBox="0 0 600 200" className="mt-5 w-full" role="img" aria-label="Flame radiation and smoke over time">
        {[0, 300, 600, 900, 1200].filter((t) => t >= tMin && t <= tMax).map((t) => (
          <g key={t}>
            <line x1={X(t)} x2={X(t)} y1={20} y2={170} stroke="var(--line)" />
            <text x={X(t)} y={186} fontSize={10} textAnchor="middle" fill="var(--muted)">{t} s</text>
          </g>
        ))}
        {saffire.samples.map((x) => (
          <g key={x.sample}>
            <line x1={X(x.ignition_s - t0)} x2={X(x.ignition_s - t0)} y1={14} y2={170} stroke="var(--serious)" strokeDasharray="3 3" />
            <text x={X(x.ignition_s - t0) + 3} y={24} fontSize={10} fill="var(--serious)">ignite {x.sample}</text>
          </g>
        ))}
        <polyline points={line(1, Yr)} fill="none" stroke="#ff8a3d" strokeWidth={2} />
        <polyline points={line(2, Yr)} fill="none" stroke="#ffc53d" strokeWidth={2} />
        <polyline points={line(3, Ys)} fill="none" stroke="#4f7cff" strokeWidth={2} />
      </svg>
      <p className="mt-1 flex flex-wrap gap-x-4 text-xs text-muted">
        <span><span style={{ color: "#ff8a3d" }}>━</span> radiometers 1+3</span>
        <span><span style={{ color: "#ffc53d" }}>━</span> radiometers 2+4 (further along the sample)</span>
        <span><span style={{ color: "#4f7cff" }}>━</span> smoke detector, light scattering</span>
        <span>time from the first ignition</span>
      </p>
      <p className="mt-1 text-xs text-muted">
        The smoke spike before the first ignition comes from the experiment&apos;s smoke wire
        (switched on about two minutes earlier to show the airflow): the detector reacted to
        that smoke within about half a minute.
      </p>
      <div className="mt-4 rounded-lg border-l-4 border-accent bg-surface-2 p-3 text-sm text-ink-2">
        <b className="text-ink">What it means for detection:</b> the flame was radiating from{" "}
        {big.pairs["radiometers 1+3"] && "first_s" in big.pairs["radiometers 1+3"]
          ? `${(big.pairs["radiometers 1+3"] as { first_s: number }).first_s} s`
          : "the start"}{" "}
        after ignition, but the cabin&apos;s scattering smoke detector only crossed its
        threshold at {scat.first_s} s and peaked near the end of the burn; its signal was still
        raised 15 minutes later, because smoke lingers in still air.{" "}
        {!obs.responded && "The obscuration (light-blocking) channel did not change at all. "}
        The radiometers sit next to the sample, unlike a cabin sensor, but the gap is a
        question worth testing: a sensor that sees the flame itself could warn earlier than
        one waiting for smoke to drift to it.
      </div>
      <p className="mt-3 text-xs text-muted">
        One flight and one large burn: sample {saffire.samples.find((x) => x !== big)?.sample}{" "}
        gave only a brief, weak signal. The file gives no distance between the radiometers, so
        no spread speed is computed; radiometer values are in the file&apos;s units. The second
        detector&apos;s channels are empty in this file. Source: {saffire.source}.
      </p>
    </Card>
  );
}

/** FLEX-2: every raw per-test log summarised (build_flex2_summary.py). */
function Flex2Logs() {
  const bins = flex2.flame_seconds_bins;
  const hist = flex2.flame_seconds_hist;
  const max = Math.max(...hist);
  const stats: [string, string][] = [
    ["Test points with a log", `${flex2.with_log} of ${flex2.tests}`],
    ["Sustained flame after the igniter", `${flex2.flame_seen} (${Math.round((flex2.flame_seen / flex2.with_log) * 100)}%)`],
    ["Median flame time", `${flex2.median_flame_seconds} s`],
    ["Chamber pressure tested", `${flex2.psia_range?.[0]}–${flex2.psia_range?.[1]} psia`],
    ["Free droplets / on a fiber", `${flex2.free_droplet} / ${flex2.fiber_supported}`],
  ];
  return (
    <Card title="FLEX-2 · every raw test log, summarised" className="scroll-mt-24 print:hidden">
      <span id="flex2" className="sr-only" />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        FLEX-2 (PSI-68) ran {flex2.tests} droplet test points on the ISS between{" "}
        {flex2.dates[0]} and {flex2.dates[1]}, but NASA publishes them as raw instrument logs,
        not a results table. Falmex read every log and wrote one row per test: igniter
        settings, whether a flame kept burning after the igniter switched off, how long, and
        the chamber pressure and temperature.
      </p>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
        {stats.map(([k, v]) => (
          <div key={k} className="rounded-xl border border-line bg-surface-2 p-3">
            <p className="text-xs text-muted">{k}</p>
            <p className="mt-1 font-display text-lg tabular-nums text-ink">{v}</p>
          </div>
        ))}
      </div>
      <p className="mt-5 text-xs font-medium text-ink-2">How long the flames burned (tests with a sustained flame)</p>
      <div className="mt-2 flex h-32 items-end gap-2">
        {hist.map((n, i) => (
          <div key={i} className="flex flex-1 flex-col items-center gap-1">
            <span className="text-[11px] tabular-nums text-ink-2">{n}</span>
            <div className="w-full rounded-t bg-accent/70" style={{ height: `${(n / max) * 90}px` }} />
            <span className="text-[11px] text-muted">{bins[i]}–{bins[i + 1]} s</span>
          </div>
        ))}
      </div>
      <div className="mt-4 rounded-lg border-l-4 border-accent bg-surface-2 p-3 text-sm text-ink-2">
        <b className="text-ink">Why it matters:</b> {flex2.with_log - flex2.flame_seen} logged
        tests ({Math.round(((flex2.with_log - flex2.flame_seen) / flex2.with_log) * 100)}%) show
        only the igniter&apos;s own glow and no flame afterwards. Those are the conditions
        where a droplet would not keep burning: the boundary a fire-safety analysis needs,
        now findable without opening hundreds of files.
      </div>
      <p className="mt-3 text-xs text-muted">
        The hot igniter wire glows, so a flame counts only when the wide-view radiometer stays
        above 20% of its peak for 2 s or more, starting 1 s after the igniter switched off
        (spot-checked by hand on example logs). The oxygen and diluent of each test are in
        separate, larger chamber files not read yet, so this table cannot yet link flames to
        atmosphere. Source: {flex2.source}.{" "}
        <a className="text-accent underline" href="/data/psi-68-flex2-test-summary.csv">
          Download the {flex2.tests}-test summary (CSV)
        </a>
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- */

function Ranking() {
  const rows = [...TASKS].sort((a, b) => gain(b) - gain(a));
  return (
    <Card title="Which outcome travels best across test dates?" className="scroll-mt-24 print:hidden">
      <span id="ranking" className="sr-only" />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        Three candidate relationships, ranked by reduction in mean absolute error against the
        training median for each fuel. The final 20% of experiment dates were reserved for
        evaluation. This ranking measures predictive usefulness in FLEX.
      </p>
      <ol className="space-y-3">
        {rows.map((t, i) => {
          const g = gain(t);
          return (
            <li key={t.id} className="grid items-center gap-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_9rem]">
              <span className="font-mono text-xs text-muted">{i + 1}</span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-ink">{t.title}</p>
                <p className="text-xs text-muted">
                  {t.train} training / {t.test} test experiments · test dates from {t.cutoff}
                </p>
              </div>
              <div>
                <div className="h-2 overflow-hidden rounded-full bg-surface-2">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${Math.min(100, Math.abs(g) * 4)}%`,
                      background: g > 0 ? "var(--good)" : "var(--critical)",
                    }}
                  />
                </div>
                <p className="mt-1 text-xs tabular-nums" style={{ color: g > 0 ? "var(--good)" : "var(--critical)" }}>
                  {g > 0 ? `${g.toFixed(1)}% less error` : `${(-g).toFixed(1)}% worse than median`}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- */

interface Interpretation {
  model?: string;
  summary?: string;
  interpretation?: string;
  safety_relevance?: string;
  caveats?: string[];
  provider?: string;
}

function ReportAndPlanner() {
  const [ti, setTi] = useState(0);
  const t = TASKS[ti];
  const fuels = Object.keys(t.options);
  const [fuel, setFuel] = useState(fuels[0]);
  const rows = t.options[fuel] ?? t.options[fuels[0]];
  const [ci, setCi] = useState(0);
  const [di, setDi] = useState(Math.floor(rows.length / 2));
  const [ai, setAi] = useState<{ state: "idle" | "busy" | "done" | "error"; text?: string; data?: Interpretation; cached?: boolean }>({ state: "idle" });

  const requestVersion = useRef(0);
  const pickTask = (i: number) => {
    requestVersion.current++;
    setTi(i);
    const f = Object.keys(TASKS[i].options)[0];
    setFuel(f);
    setCi(0);
    setDi(Math.floor(TASKS[i].options[f].length / 2));
    setAi({ state: "idle" });
  };
  const pickFuel = (f: string) => {
    setFuel(f);
    setCi(0);
    setDi(Math.floor(t.options[f].length / 2));
  };
  const [x, a, n] = rows[Math.min(ci, rows.length - 1)];
  const [y, b, m] = rows[Math.min(di, rows.length - 1)];
  const max = Math.max(a, b, 1e-9);
  const g = gain(t);
  const warning =
    t.mae >= t.baseline
      ? { tone: "var(--critical)", text: "Prediction alert: the fuel-only baseline has lower error. Use measured observations to plan a follow-up." }
      : x === y
        ? { tone: "var(--warning)", text: "Comparison alert: both inputs select the same condition." }
        : { tone: "var(--warning)", text: `Observed error was ${g.toFixed(1)}% lower than the fuel median. The date-resampled interval also includes zero gain. See Methods & uncertainty.` };

  async function interpret() {
    const version = ++requestVersion.current;
    setAi({ state: "busy" });
    try {
      const r = await fetch(`/api/flight-evidence/${encodeURIComponent(t.id)}/interpret`, {
        method: "POST",
        signal: AbortSignal.timeout(45000),
      });
      if (r.status === 429) throw Error("too many requests, try again in a few minutes");
      if (r.status === 503) throw Error("Gemini is not configured on this server");
      if (!r.ok) throw Error("Gemini could not write the report this time; please retry");
      const { interpretation, cached } = (await r.json()) as { interpretation: Interpretation; cached?: boolean };
      if (!interpretation?.summary) throw Error("no Gemini output");
      if (version !== requestVersion.current) return;
      setAi({ state: "done", data: interpretation, cached });
    } catch (e) {
      if (version !== requestVersion.current) return;
      const err = e as Error;
      setAi({ state: "error", text: err.name === "TimeoutError"
        ? "no report after 45 seconds; please retry"
        : err instanceof TypeError ? "no connection to the server" : err.message });
    }
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
      <Card title="Interpret a finding · experiment planner" className="scroll-mt-24 print:hidden">
        <span id="report" className="sr-only" />
        <div className="space-y-4 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Finding</span>
            <select className={`${select} w-full`} value={ti} onChange={(e) => pickTask(Number(e.target.value))}>
              {TASKS.map((task, i) => (
                <option key={task.id} value={i}>
                  {task.title}
                </option>
              ))}
            </select>
          </label>
          <p className="text-ink-2">{t.insight}</p>
          <div className="rounded-lg border-l-4 p-3 text-ink-2" style={{ borderColor: "var(--accent)", background: "var(--surface-2)" }}>
            <p className="text-xs font-medium uppercase tracking-wider text-accent">Fire-safety reading · for expert review</p>
            <p className="mt-1">{SAFETY[t.title] ?? "Open question for expert review."}</p>
          </div>
          <p className="text-xs text-muted">
            Scientific review finding {t.finding} · date-split holdout rank correlation {f3(t.rho)} ·
            prediction test dates start {t.cutoff}.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Held-out error" value={f3(t.mae)} hint="Mean absolute error on later experiments" />
            <Stat label="Fuel-only baseline" value={f3(t.baseline)} hint="Same outcome scale" />
          </div>
          <div className="flex flex-wrap gap-3">
            <label>
              <span className="mb-1 block text-xs text-muted">Fuel</span>
              <select className={select} value={fuel} onChange={(e) => pickFuel(e.target.value)}>
                {fuels.map((f) => (
                  <option key={f}>{f}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-muted">{t.xname}</span>
              <select className={select} value={ci} onChange={(e) => setCi(Number(e.target.value))}>
                {rows.map((r, i) => (
                  <option key={i} value={i}>
                    {r[0]}
                  </option>
                ))}
              </select>
            </label>
            <label>
              <span className="mb-1 block text-xs text-muted">Compare with</span>
              <select className={select} value={di} onChange={(e) => setDi(Number(e.target.value))}>
                {rows.map((r, i) => (
                  <option key={i} value={i}>
                    {r[0]}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <p className="text-ink-2" aria-live="polite">
            {t.yname}: estimated <b className="text-ink">{f3(a)}</b> from {n} neighbouring
            training experiments.
          </p>
          <p className="text-ink-2" aria-live="polite">
            {x === y
              ? "Select two different conditions to compare."
              : `${fuel} at ${x} and ${y}: predicted ${f3(a)} and ${f3(b)} (difference ${f3(b - a)}). For a follow-up, repeat both conditions with matched pressure and diluent protocol and record the initial droplet size.`}
          </p>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-xs font-medium text-ink">Three chronological evaluations</summary>
            <p className="mt-2 text-xs text-ink-2">
              Each model learned only from earlier experiment dates. Windows cover successive
              fifths of the 80 dates. Entries show mean absolute error for the model and the fuel-only baseline.
            </p>
            <table className="mt-2 w-full text-xs tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 text-left font-normal">Outcome</th>
                  <th className="text-left font-normal">Jun 2010</th>
                  <th className="text-left font-normal">Jan 2011</th>
                  <th className="text-left font-normal">Sep 2011</th>
                </tr>
              </thead>
              <tbody className="text-ink-2">
                {[
                  ["Extinction ratio", ".210 / .227", ".177 / .213", ".182 / .211"],
                  ["Extinction diameter", ".817 / .936", ".588 / .808", ".762 / .774"],
                  ["Burning rate", ".078 / .118", ".055 / .081", ".169 / .146"],
                ].map((r) => (
                  <tr key={r[0]} className="border-t border-line">
                    {r.map((c, i) => (
                      <td key={i} className="py-1">
                        {c}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="mt-2 text-xs text-muted">
              The ratio had 55, 46 and 39 test measurements. The final window informed
              selection, so external performance is unknown.
            </p>
          </details>
          <details className="rounded-lg border border-line p-3">
            <summary className="cursor-pointer text-xs font-medium text-ink">Model, source and limits</summary>
            <p className="mt-2 text-xs text-ink-2">
              The regressor returns the median outcome among the five nearest training
              experiments within the selected fuel, including distance ties. Pressure, gas
              mixture and other covariates can differ. These observational estimates apply to
              PSI-69 droplet experiments. They cannot establish cabin limits, extinction
              commands or detector sensitivity.
            </p>
          </details>
        </div>
      </Card>

      <Card title="Scientific report" className="flight-report">
        <div className="space-y-4 text-sm">
          <p className="text-ink-2">
            <b className="text-ink">{t.title} · {fuel}.</b> At {x} and {y} ({t.xname.toLowerCase()}),
            the model estimates {f3(a)} and {f3(b)} ({t.yname}), using {n} and {m} neighbouring
            training cases. It was evaluated on {t.test} later observations: mean absolute error{" "}
            {f3(t.mae)} versus {f3(t.baseline)} for the fuel median.
          </p>
          <div className="space-y-2">
            {[
              [x, a],
              [y, b],
            ].map(([c, v], i) => (
              <div key={i} className="grid grid-cols-[7.5rem_minmax(0,1fr)] items-center gap-3 text-xs">
                <span className="tabular-nums text-ink-2">
                  {c} · {f3(v)}
                </span>
                <i
                  className="block h-3 rounded-full"
                  style={{ width: `${(70 * v) / max}%`, background: i ? "var(--series-2)" : "var(--series-1)" }}
                />
              </div>
            ))}
          </div>
          <p className="border-l-4 pl-3 text-ink-2" style={{ borderColor: warning.tone }} role="status">
            {warning.text}
          </p>
          <p className="text-ink-2">
            <b className="text-ink">Fire-safety reading.</b> {SAFETY[t.title]}
          </p>
          <div className="flex flex-wrap gap-2 print:hidden">
            <Button variant="ghost" onClick={() => window.print()}>
              Print report / PDF
            </Button>
            <Button onClick={interpret} disabled={ai.state === "busy"}>
              {ai.state === "busy" ? "Asking Gemini…" : "Add Gemini interpretation"}
            </Button>
          </div>
          {ai.state === "error" && (
            <p className="text-xs text-muted" role="status">
              Gemini unavailable ({ai.text}). The measurement-based report above is complete
              and can be printed.
            </p>
          )}
          {ai.state === "done" && ai.data && (
            <div className="space-y-2 rounded-lg bg-surface-2 p-3" role="status">
              <p className="text-xs font-medium uppercase tracking-wider text-accent">
                Gemini · explains the overall finding across experiments{ai.data.model ? ` · ${ai.data.model}` : ""}
                {ai.cached ? " · saved answer" : ""}
              </p>
              <p className="text-ink">{ai.data.summary}</p>
              {ai.data.interpretation && <p className="text-ink-2">{ai.data.interpretation}</p>}
              {ai.data.safety_relevance && (
                <p className="text-ink-2">
                  <b className="text-ink">Safety relevance:</b> {ai.data.safety_relevance}
                </p>
              )}
              {!!ai.data.caveats?.length && (
                <ul className="list-disc pl-5 text-xs text-muted">
                  {ai.data.caveats.map((c) => (
                    <li key={c}>{c}</li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      </Card>
    </div>
  );
}

/* ---------------------------------------------------------------------------------- */

function EvidenceMethods() {
  const repo = "https://github.com/AlirezaVII/Falmex/blob/main/";
  const source = repo + "backend/review_seed/PSI-69_Experimental%20table_FLEX.csv";
  return (
    <section id="methods" className="scroll-mt-24">
      <Card title="How to read and reproduce a prediction">
        <ol className="list-decimal space-y-2 pl-5 text-sm text-ink-2">
          <li>Open Report &amp; planner. Choose one fuel and two measured conditions. Each estimate is the median outcome among the five closest training rows for that fuel, including ties. The extinction ratio divides visible extinction diameter by initial diameter.</li>
          <li>Compare absolute errors on experiments dated {audit.cutoff} or later. The baseline predicts the median for that fuel in training. Positive gain means lower mean absolute error for the planner. Each row below uses its outcome’s units.</li>
          <li>Read the interval before interpreting the ranking. We resampled whole test dates with replacement {audit.replicates.toLocaleString("en-US")} times and kept paired errors together. Each interval spans the 2.5th to 97.5th percentiles. It measures sensitivity to the sampled dates with training fixed.</li>
        </ol>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full text-left text-xs tabular-nums">
            <caption className="pb-2 text-left text-sm font-medium">Held-out gain over the fuel median</caption>
            <thead><tr>{["Target", "Rows / dates", "MAE gain", "95% interval"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{audit.results.map(r => <tr key={r.title} className="border-t border-line">
              <td className="p-2">{r.title}</td><td className="p-2">{r.rows} / {r.days}</td>
              <td className="p-2">{r.gain.toFixed(3)}</td><td className="p-2">[{r.low.toFixed(3)}, {r.high.toFixed(3)}]</td>
            </tr>)}</tbody>
          </table>
        </div>
        <p className="mt-3 text-sm text-ink-2">All three intervals include zero. These experiments leave the direction of the predictive advantage uncertain. Each interval is exploratory and applies to FLEX only. Gemini explains the selected statistical finding. Its text does not estimate a cabin hazard.</p>
        <details className="mt-4 rounded-lg border border-line p-3 text-sm">
          <summary className="cursor-pointer font-medium">Can a multivariable model predict better?</summary>
          <p className="mt-2 text-ink-2">Using fuel, gas composition, pressure and starting diameter, we compared standardized Ridge and Extra Trees against the planner and fuel median. Three expanding date windows selected the lowest mean absolute error before scoring the final window. These dates have been studied previously, so this is an exploratory benchmark.</p>
          <div className="mt-2 overflow-x-auto"><table className="w-full text-left text-xs tabular-nums">
            <caption className="pb-2 text-left">Final-window mean absolute errors. Lower is better within each row.</caption>
            <thead><tr>{["Outcome", "Selected", "Ridge", "Extra Trees", "Planner", "Fuel median"].map(h => <th key={h} className="p-2">{h}</th>)}</tr></thead>
            <tbody>{benchmark.map(r => <tr key={r.title} className="border-t border-line">
              <td className="p-2">{r.title}</td><td className="p-2">{r.chosen}</td>
              {(["Ridge", "Extra Trees", "Planner", "Fuel median"] as const).map(k => <td key={k} className="p-2">{r.finalMAE[k].toFixed(3)}</td>)}
            </tr>)}</tbody>
          </table></div>
          <p className="mt-2 text-ink-2">Ridge improved the burning-rate estimate and lost to the fuel median for both extinction outcomes. The fuel and oxygen controls alone cannot reproduce a multivariable prediction.</p>
          <a className="text-xs text-accent underline" href={repo + "backend/scripts/benchmark_flex_models.py"}>Model settings, input columns and chronological selection code</a>
        </details>
        <div className="mt-3 flex flex-wrap gap-4 text-xs text-accent underline">
          <a href={source}>FLEX source table</a>
          <a href={repo + "backend/scripts/build_flex_decision_review.py"}>Prediction formula and units</a>
          <a href={repo + "backend/scripts/audit_flex_holdout.py"}>Resampling code</a>
          <a href={repo + "frontend/src/lib/flight/holdout-audit.json"}>Exact test rows, seed and dataset checksum</a>
          <a href={repo + "bass-cv/independent-review-results-v6/dual-reference-folds.json"}>Image scores by held-out video</a>
        </div>
      </Card>
    </section>
  );
}

function Sources() {
  const [i, setI] = useState(0);
  const [, name, text, url] = STUDIES[i];
  return (
    <Card title="Which NASA investigation answers the question?" className="scroll-mt-24 print:hidden">
      <span id="sources" className="sr-only" />
      <label className="block text-sm">
        <span className="mb-1 block text-xs text-muted">Research question</span>
        <select className={`${select} w-full sm:w-auto`} value={i} onChange={(e) => setI(Number(e.target.value))}>
          {STUDIES.map((s, k) => (
            <option key={s[0]} value={k}>
              {s[0]}
            </option>
          ))}
        </select>
      </label>
      <h3 className="mt-4 font-display text-xl font-medium text-ink">{name}</h3>
      <p className="mt-1 max-w-3xl text-sm text-ink-2">{text}</p>
      <a className="mt-2 inline-block text-sm text-accent underline" href={url} target="_blank" rel="noreferrer">
        Read the NASA source ↗
      </a>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- */

function ImageEvidence() {
  const [fi, setFi] = useState(0);
  const [previews, setPreviews] = useState<Record<string, string> | null | "error">(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver((e) => {
      if (!e.some((x) => x.isIntersecting)) return;
      io.disconnect();
      fetch("/bass-predictions.json")
        .then((r) => (r.ok ? r.json() : Promise.reject()))
        .then(setPreviews)
        .catch(() => setPreviews("error"));
    });
    io.observe(el);
    return () => io.disconnect();
  }, []);
  const [name, a, b, iou, pa, pb] = FRAMES[fi];
  const alert =
    pa && pb
      ? "Both models flag a region. Inspect the overlay for reflections or instrument text."
      : pa || pb
        ? "Model disagreement: only one model flags a region. Review the source before interpreting this frame."
        : "No region flagged. Optical evidence is inconclusive.";
  const src = previews && previews !== "error" ? previews[`${name}.png`] : undefined;
  return (
    <Card title="BASS-II · Can the images localize a flame?" className="scroll-mt-24 print:hidden">
      <span id="vision" className="sr-only" />
      <div ref={ref} />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        A and B marked visible regions in seven of 24 frames. Only B marked regions in the
        other seventeen. Bright regions alone cannot distinguish a spark, reflection or
        instrument display.
      </p>
      <div className="grid gap-5 md:grid-cols-[1.25fr_1fr]">
        <figure>
          <div className="aspect-[3/2] overflow-hidden rounded-lg bg-[#13222a]">
            {src ? (
              // eslint-disable-next-line @next/next/no-img-element -- inline data from the predictions file
              <img src={`data:image/webp;base64,${src}`} alt={`Cross-validated predictions over BASS-II frame ${name}`} className="h-full w-full object-contain" />
            ) : (
              <div className="grid h-full place-items-center text-xs text-muted">
                {previews === "error" ? "Image unavailable. Frame statistics remain available." : "Loading frame…"}
              </div>
            )}
          </div>
          <figcaption className="mt-2 text-xs text-muted">
            <span style={{ color: "#4bb9ff" }}>Blue</span> A model only ·{" "}
            <span style={{ color: "#ff6b44" }}>coral</span> B model only ·{" "}
            <span style={{ color: "#3fcf7a" }}>green</span> both
          </figcaption>
        </figure>
        <div className="space-y-3 text-sm">
          <label className="block">
            <span className="mb-1 block text-xs text-muted">Frame</span>
            <select className={`${select} w-full`} value={fi} onChange={(e) => setFi(Number(e.target.value))}>
              {FRAMES.map((f, i) => (
                <option key={f[0]} value={i}>
                  {f[0]}
                </option>
              ))}
            </select>
          </label>
          <p className="border-l-4 pl-3 text-ink-2" style={{ borderColor: pa && pb ? "var(--good)" : "var(--warning)" }} role="status">
            {alert}
          </p>
          <div className="grid grid-cols-2 gap-3">
            <Stat label="Marked pixels A / B" value={`${a} / ${b}`} />
            <Stat label="Reference IoU" value={f3(iou)} />
            <Stat label="Predicted A / B" value={`${pa} / ${pb}`} />
          </div>
          <p className="text-xs text-muted">
            Each model learned one annotation convention from the other two videos. This replay
            cannot estimate a cabin false-alarm rate.
          </p>
          <p className="text-xs text-ink-2">
            A plain OpenCV method with no training overlaps the reviewers far better (pixel IoU
            0.53 vs A, 0.38 vs B, against 0.03 for these models).{" "}
            <a className="text-accent underline" href="/bass-review">See it on BASS-II evidence</a>
          </p>
        </div>
      </div>
      <EvidenceChat key={name} frame={name} />
      <div className="mt-5 overflow-x-auto" data-lenis-prevent>
        <table className="w-full min-w-[28rem] text-xs tabular-nums">
          <thead className="text-muted">
            <tr>
              {["Model", "Initial IoU", "A IoU", "B IoU"].map((h) => (
                <th key={h} className="py-1 text-left font-normal">
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="text-ink-2">
            {[
              ["Extra Trees · cross-fitted", "—", "0.3170", "0.2536"],
              ["Brightness · cross-fitted", "—", "0.1461", "0.0654"],
              ["v3", "0.0372", "0.0447", "0.0859"],
              ["v4", "0.0000", "0.0087", "0.0075"],
              ["v5", "0.0000", "0.0198", "0.0215"],
              ["v6", "0.0000", "0.0271", "0.0337"],
            ].map((r) => (
              <tr key={r[0]} className="border-t border-line">
                {r.map((c, i) => (
                  <td key={i} className={`py-1 ${i === 0 ? "text-ink" : ""}`}>
                    {c}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        <p className="mt-2 text-xs text-muted">
          Each Extra Trees model uses RGB, colour differences and local contrast. The newer
          two-target experiment rotates the same three videos through training and testing, so
          its agreement estimates describe these annotations. Independent flight validation
          remains open.
        </p>
      </div>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- */

function FrameTester() {
  const canvas = useRef<HTMLCanvasElement>(null);
  const worker = useRef<Worker | null>(null);
  const run = useRef(0);
  const [status, setStatus] = useState("");
  const [counts, setCounts] = useState<{ a: number; b: number; shared: number } | null>(null);
  const [shown, setShown] = useState(false);
  useEffect(() => () => worker.current?.terminate(), []);

  async function inspect(file: Blob) {
    const token = ++run.current;
    worker.current?.terminate();
    worker.current = null;
    setCounts(null);
    setShown(false);
    try {
      if (file.size > 4_000_000) throw Error("Choose a PNG under 4 MB.");
      const header = new DataView(await file.slice(0, 24).arrayBuffer());
      if (header.byteLength < 24 || header.getUint32(0) !== 0x89504e47 || header.getUint32(16) !== 720 || header.getUint32(20) !== 480)
        throw Error("Expected a native 720 × 480 PNG frame.");
      const img = await createImageBitmap(file);
      if (token !== run.current) return img.close();
      const ctx = canvas.current!.getContext("2d", { willReadFrequently: true })!;
      ctx.drawImage(img, 0, 0);
      img.close();
      setShown(true);
      const pixels = ctx.getImageData(0, 0, 720, 480);
      setStatus("Analysing both annotation targets locally…");
      const w = new Worker("/optical-worker.js");
      worker.current = w;
      w.onerror = () => token === run.current && setStatus("The optical worker could not run in this browser.");
      w.onmessage = ({ data }) => {
        if (token !== run.current) return;
        if (data.error) return setStatus(data.error);
        let a = 0;
        let b = 0;
        let both = 0;
        const colors = [null, [75, 185, 255], [255, 107, 68], [99, 236, 153]] as const;
        (data.mask as Uint8Array).forEach((v: number, p: number) => {
          if (!v) return;
          if (v & 1) a++;
          if (v & 2) b++;
          if (v === 3) both++;
          const c = colors[v]!;
          for (let k = 0; k < 3; k++) pixels.data[4 * p + k] = 0.4 * pixels.data[4 * p + k] + 0.6 * c[k];
        });
        setCounts({ a, b, shared: both });
        ctx.putImageData(pixels, 0, 0);
        setStatus(
          `${a && b ? (both ? "Both models flag overlapping regions." : "Spatial disagreement: both models flag different regions.") : a || b ? "Single-model flag." : "No optical signal flagged."} A: ${a} pixels. B: ${b} pixels. Shared: ${both}. Research review only.`,
        );
      };
      w.postMessage({ rgba: pixels.data, packed: null });
    } catch (e) {
      if (token === run.current) setStatus((e as Error).message);
    }
  }

  return (
    <Card title="Test an original BASS frame" className="print:hidden">
      <p className="mb-3 max-w-3xl text-sm text-ink-2">
        Select a 720 × 480 PNG frame from the original camera. Both trained models run locally
        in your browser; no image leaves your device. Other scenes have unknown performance.
      </p>
      <div className="flex flex-wrap items-center gap-3">
        <label className="text-sm">
          <span className="sr-only">Camera frame</span>
          <input
            type="file"
            accept="image/png"
            className="text-sm text-ink-2 file:mr-3 file:rounded-lg file:border file:border-line file:bg-surface file:px-3 file:py-1.5 file:text-ink"
            onChange={(e) => e.target.files?.[0] && inspect(e.target.files[0])}
          />
        </label>
        <Button
          variant="ghost"
          onClick={async () => {
            try {
              const r = await fetch("/bass-sample.png");
              if (!r.ok) throw Error();
              await inspect(await r.blob());
            } catch {
              setStatus("The sample could not be loaded.");
            }
          }}
        >
          Run a sample frame
        </Button>
      </div>
      {status && (
        <p className="mt-3 text-sm text-ink-2" role="status">
          {status}
        </p>
      )}
      {counts && <EvidenceChat counts={counts} />}
      <canvas ref={canvas} width={720} height={480} hidden={!shown} className="mt-3 h-auto w-full max-w-[720px] rounded-lg" />
      <p className="mt-2 text-xs text-muted">
        Blue marks A only, coral B only, green both. The sample comes from training for this
        final fit; the replay above uses held-out predictions.
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- */

function BurningRates() {
  const all = useMemo(() => Object.values(BURN).flat(), []);
  const max = Math.max(...all.map((r) => r[2]));
  return (
    <Card title="Measured burning rates by oxygen level" className="scroll-mt-24 print:hidden">
      <span id="burning" className="sr-only" />
      <p className="mb-4 max-w-3xl text-sm text-ink-2">
        Observations at each initial oxygen mole fraction. Sample counts show where a median
        rests on only a few experiments.
      </p>
      <div className="grid gap-6 md:grid-cols-2">
        {Object.entries(BURN).map(([fuel, rows], k) => (
          <div key={fuel}>
            <h3 className="mb-2 text-sm font-medium text-ink">{fuel}</h3>
            <div className="space-y-1.5">
              {rows.map(([o, n, v]) => (
                <div key={o} className="grid grid-cols-[3rem_minmax(0,1fr)_5.5rem] items-center gap-2 text-xs">
                  <span className="tabular-nums text-muted">{o}</span>
                  <i
                    className="block h-2.5 rounded-full"
                    style={{
                      width: `${(100 * v) / max}%`,
                      background: k ? "var(--series-2)" : "var(--series-1)",
                      opacity: n < 3 ? 0.45 : 1,
                    }}
                    title={`${n} experiments`}
                  />
                  <span className="tabular-nums text-ink-2">
                    {v.toFixed(3)} <span className="text-muted">· {n}</span>
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-4 text-sm text-ink-2">
        Across 258 usable experiments, higher oxygen ranked with higher droplet burning rate.
        Held-out Spearman correlations were 0.571 for the primary split and 0.703 for the date
        split. Within-fuel descriptive correlations were 0.687 for methanol and 0.432 for
        heptane. Pressure, diluent and droplet size can differ between groups. Faded bars rest
        on fewer than three experiments.
      </p>
      <p className="mt-2 text-xs text-muted">
        Source: PSI-69 Experimental table FLEX, columns Fuel, O initial ambient composition and
        Burning rate. Holdout results come from eight_findings_review.csv, finding 1.
      </p>
    </Card>
  );
}
