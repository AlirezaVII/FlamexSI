"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader, Stat } from "@/components/ui";
import burning from "@/lib/flight/burning.json";
import frames from "@/lib/flight/frames.json";
import models from "@/lib/flight/models.json";

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
    name: "ISS / Orion cabin",
    o2: 0.21,
    note: "Sea-level air: about 21% oxygen at 101 kPa (14.7 psia).",
  },
  {
    name: "NASA exploration atmosphere",
    o2: 0.34,
    note: "About 34% oxygen at 56.5 kPa (8.2 psia), proposed for lunar landers and surface habitats to shorten spacewalk pre-breathe.",
  },
  {
    name: "Apollo 1 cabin on the pad",
    o2: 1.0,
    note: "Pure oxygen above sea-level pressure, the atmosphere of the 1967 fire.",
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
  ["atmosphere", "Mission check"],
  ["ranking", "Ranking"],
  ["report", "Report & planner"],
  ["sources", "NASA sources"],
  ["vision", "Image evidence"],
  ["burning", "Burning rates"],
] as const;

const select =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40";

export default function FlightEvidence() {
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="NASA FLEX · PSI-69 · BASS-II" title="Reading fire in microgravity">
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
      <ExtinctionCurve />
      <AtmosphereCheck />
      <Ranking />
      <ReportAndPlanner />
      <Sources />
      <ImageEvidence />
      <FrameTester />
      <BurningRates />
    </div>
  );
}

/* ---------------------------------------------------------------------------------- */

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
                  Outside the flight data: FLEX did not test this oxygen level, so Falmex makes
                  no estimate. This is where new experiments are needed.
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

  const pickTask = (i: number) => {
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
        : { tone: "var(--good)", text: `Validation: ${g.toFixed(1)}% lower error than the fuel median on the final time window. This is an observational contrast within FLEX.` };

  async function interpret() {
    setAi({ state: "busy" });
    try {
      const r = await fetch(`/api/flight-evidence/${encodeURIComponent(t.id)}/interpret`, {
        method: "POST",
        signal: AbortSignal.timeout(45000),
      });
      if (r.status === 429) throw Error("too many requests, try again in a few minutes");
      if (r.status === 503) throw Error("Gemini is not configured on this server");
      if (!r.ok) throw Error(`HTTP ${r.status}`);
      const { interpretation, cached } = (await r.json()) as { interpretation: Interpretation; cached?: boolean };
      if (!interpretation?.summary) throw Error("no Gemini output");
      setAi({ state: "done", data: interpretation, cached });
    } catch (e) {
      setAi({ state: "error", text: (e as Error).message });
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
              fifths of the 80 dates. Entries: model / fuel-only median absolute error.
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
                Gemini · explains the computed facts only{ai.data.model ? ` · ${ai.data.model}` : ""}
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
        </div>
      </div>
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
  const [shown, setShown] = useState(false);
  useEffect(() => () => worker.current?.terminate(), []);

  async function inspect(file: Blob) {
    const token = ++run.current;
    worker.current?.terminate();
    worker.current = null;
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
