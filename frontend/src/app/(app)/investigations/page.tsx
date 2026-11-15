"use client";

import { useMemo, useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import catalog from "@/lib/psi/catalog.json";

/*
 * PSI combustion investigations: catalog, mission-relevance ranking and side-by-side
 * comparison. Data: NASA PSI metadata (backend/review_seed/psi_metadata), compiled by
 * backend/scripts/build_psi_catalog.py. The ranking criteria and weights are shown on the
 * page, so the order can be checked rather than trusted.
 */

interface Quote {
  values: number[];
  unit: string;
  quote: string;
}
interface Investigation {
  id: string;
  acronym: string;
  title: string;
  area: string;
  platform: string;
  hardware: string;
  start: string;
  end: string;
  doi: string;
  tags: string[];
  objective: string;
  hypothesis: string;
  approach: string;
  impacts: string;
  publications: number;
  people: number;
  fuel: "solid" | "droplet" | "gas" | "smoke" | "model";
  pillars: Pillar[];
  classification_basis: string;
  conditions: Partial<Record<"oxygen" | "pressure" | "flow", Quote[]>>;
  oxygen_range: [number | null, number] | null;
  oxygen_source: string | null;
  apparatus_oxygen: string | null;
  measurements: string[];
  spacecraft_fire_safety: boolean;
  in_falmex: string | null;
  psi_url: string;
}
type Pillar = "prevention" | "detection" | "suppression";
const ALL = catalog as unknown as Investigation[];

const FUEL: Record<Investigation["fuel"], string> = {
  solid: "Solid materials (fabrics, plastics)",
  droplet: "Liquid fuel droplets",
  gas: "Gaseous-fuel flames",
  smoke: "Smoke and aerosol",
  model: "Modelling / ground study of flight data",
};
const PILLAR_LABEL: Record<Pillar, string> = {
  prevention: "Prevention",
  detection: "Detection",
  suppression: "Suppression",
};

// Habitats named in the challenge. Oxygen and pressure as the challenge states them.
const HABITATS = [
  {
    id: "spacecraft",
    name: "Spacecraft & space station",
    o2: 21,
    note: "Cabin air: about 21% oxygen at 14.7 psi, microgravity, forced ventilation.",
    partialG: false,
  },
  {
    id: "moon",
    name: "Moon base & pressurized rover",
    o2: 30,
    note: "Expected 30% oxygen or more at 10.2 psi or less (challenge text), 1/6 g.",
    partialG: true,
  },
  {
    id: "mars",
    name: "Mars base",
    o2: 30,
    note: "Atmosphere not specified by NASA; the Moon-base assumption (30% O₂ or more) is used. 0.38 g.",
    partialG: true,
  },
] as const;

// Cabin relevance of each fuel type for each concern (0-1). Stated, not learned.
const FUEL_FIT: Record<Pillar, Record<Investigation["fuel"], number>> = {
  prevention: { solid: 1, droplet: 0.7, gas: 0.55, smoke: 0.3, model: 0.5 },
  detection: { smoke: 1, solid: 0.8, gas: 0.5, droplet: 0.4, model: 0.6 },
  suppression: { droplet: 1, solid: 0.8, gas: 0.5, smoke: 0.2, model: 0.6 },
};
const WEIGHTS = { pillar: 0.35, fuel: 0.2, oxygen: 0.25, nasaTag: 0.1, depth: 0.1 };

function oxygenScore(inv: Investigation, target: number): [number, string] {
  const r = inv.oxygen_range;
  if (!r) return [0.3, "oxygen levels not stated in NASA's description"];
  const [lo, hi] = r;
  if (hi >= target && (lo === null || lo <= target))
    return [1, `tested range reaches ${target}% oxygen`];
  if (hi >= target - 5) return [0.6, `tested up to ${hi}%, near ${target}%`];
  return [0.15, `tested only up to ${hi}% oxygen (habitat ${target}%)`];
}

function score(inv: Investigation, habitat: (typeof HABITATS)[number], concern: Pillar | "all") {
  const pillar =
    concern === "all" ? (inv.pillars.length ? 1 : 0) : inv.pillars.includes(concern) ? 1 : 0;
  const fuel =
    concern === "all"
      ? Math.max(...(Object.keys(FUEL_FIT) as Pillar[]).map((p) => FUEL_FIT[p][inv.fuel]))
      : FUEL_FIT[concern][inv.fuel];
  const [oxygen, oxygenWhy] = oxygenScore(inv, habitat.o2);
  const nasaTag = inv.spacecraft_fire_safety ? 1 : 0;
  const depth = Math.min(1, Math.log(inv.publications + 1) / Math.log(52));
  const total =
    WEIGHTS.pillar * pillar +
    WEIGHTS.fuel * fuel +
    WEIGHTS.oxygen * oxygen +
    WEIGHTS.nasaTag * nasaTag +
    WEIGHTS.depth * depth;
  return { total, parts: { pillar, fuel, oxygen, nasaTag, depth }, oxygenWhy };
}

const select =
  "rounded-lg border border-line bg-surface px-2.5 py-1.5 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40";

export default function Investigations() {
  const [compare, setCompare] = useState<string[]>(["PSI-69", "PSI-25", "PSI-102"]);
  const toggle = (id: string) =>
    setCompare((c) => (c.includes(id) ? c.filter((x) => x !== id) : [...c, id].slice(-3)));
  return (
    <div className="space-y-6">
      <PageHeader eyebrow="NASA Physical Sciences Informatics" title="Combustion investigations">
        All {ALL.length} combustion investigations in NASA&apos;s PSI repository, summarised
        from NASA&apos;s own records: what each one asked, what it burned, under which
        conditions, what it measured, and which part of spacecraft fire safety it informs.
        Rank them for your mission, then compare them side by side.
      </PageHeader>
      <Ranker compare={compare} toggle={toggle} />
      <Compare ids={compare} toggle={toggle} />
      <CatalogList compare={compare} toggle={toggle} />
    </div>
  );
}

/* ---------------------------------------------------------------------------------- */

function Ranker({ compare, toggle }: { compare: string[]; toggle: (id: string) => void }) {
  const [hid, setHid] = useState<(typeof HABITATS)[number]["id"]>("moon");
  const [concern, setConcern] = useState<Pillar | "all">("prevention");
  const habitat = HABITATS.find((h) => h.id === hid)!;
  const ranked = useMemo(
    () =>
      ALL.map((inv) => ({ inv, s: score(inv, habitat, concern) })).sort(
        (a, b) => b.s.total - a.s.total,
      ),
    [habitat, concern],
  );
  return (
    <Card title="Which investigations matter most for your mission?">
      <div className="flex flex-wrap gap-4">
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Crew environment</span>
          <select className={select} value={hid} onChange={(e) => setHid(e.target.value as typeof hid)}>
            {HABITATS.map((h) => (
              <option key={h.id} value={h.id}>
                {h.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-xs text-muted">Fire-safety question</span>
          <select className={select} value={concern} onChange={(e) => setConcern(e.target.value as Pillar | "all")}>
            <option value="prevention">Prevention: materials, ignition, flammability limits</option>
            <option value="detection">Detection: smoke and early warning</option>
            <option value="suppression">Suppression: putting fires out</option>
            <option value="all">All three</option>
          </select>
        </label>
      </div>
      <p className="mt-3 text-xs text-muted">{habitat.note}</p>
      {habitat.partialG && (
        <p className="mt-2 rounded-lg border-l-4 p-3 text-sm text-ink-2" style={{ borderColor: "var(--warning)", background: "var(--surface-2)" }}>
          No investigation in PSI was run in partial gravity yet (future: LUCI, FM2).
          Microgravity and normal-gravity results bound what happens at{" "}
          {hid === "moon" ? "1/6 g" : "0.38 g"}; E-FIELD Flames mimicked partial gravity
          with an electric field.
        </p>
      )}
      <ol className="mt-4 space-y-2">
        {ranked.slice(0, 8).map(({ inv, s }, i) => (
          <li key={inv.id} className="grid gap-2 rounded-lg border border-line p-3 sm:grid-cols-[1.5rem_minmax(0,1fr)_9rem]">
            <span className="font-mono text-xs text-muted">{i + 1}</span>
            <div className="min-w-0">
              <p className="text-sm font-medium text-ink">
                {inv.acronym} <span className="font-normal text-muted">· {inv.id}</span>
              </p>
              <p className="truncate text-xs text-ink-2">{inv.title}</p>
              <div className="mt-1.5 flex flex-wrap gap-1.5 text-[11px]">
                <Chip on={s.parts.pillar === 1}>
                  {concern === "all" ? "fire-safety pillar" : PILLAR_LABEL[concern]}
                </Chip>
                <Chip on={s.parts.fuel >= 0.8}>{FUEL[inv.fuel]}</Chip>
                <Chip on={s.parts.oxygen >= 0.6}>{s.oxygenWhy}</Chip>
                <Chip on={s.parts.nasaTag === 1}>
                  {s.parts.nasaTag ? "NASA: spacecraft fire safety" : "not tagged fire safety"}
                </Chip>
                <Chip on={inv.publications >= 10}>{inv.publications} publications</Chip>
              </div>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <div className="h-2 w-full overflow-hidden rounded-full bg-surface-2">
                <div className="h-full rounded-full bg-accent" style={{ width: `${s.total * 100}%` }} />
              </div>
              <span className="text-xs tabular-nums text-ink-2">score {(s.total * 100).toFixed(0)}</span>
              <button type="button" onClick={() => toggle(inv.id)} className="text-xs text-accent underline">
                {compare.includes(inv.id) ? "Remove from compare" : "Compare"}
              </button>
            </div>
          </li>
        ))}
      </ol>
      <details className="mt-4 rounded-lg border border-line p-3 text-xs text-ink-2">
        <summary className="cursor-pointer font-medium text-ink">How the score is computed</summary>
        <ul className="mt-2 list-disc space-y-1 pl-5">
          <li>
            <b>Fire-safety question ({WEIGHTS.pillar * 100}%):</b> 1 if the investigation
            informs the chosen pillar (classification and its basis are shown in the
            catalog), else 0.
          </li>
          <li>
            <b>Fuel relevance ({WEIGHTS.fuel * 100}%):</b> how close the fuel is to what burns
            in a cabin for that question, e.g. for prevention solids 1.0, droplets 0.7,
            gaseous flames 0.55.
          </li>
          <li>
            <b>Oxygen coverage ({WEIGHTS.oxygen * 100}%):</b> 1 if the tested oxygen range
            reaches the habitat&apos;s level, 0.6 within 5 points, 0.15 if it stops well
            below, 0.3 when NASA&apos;s description does not state it.
          </li>
          <li>
            <b>NASA classification ({WEIGHTS.nasaTag * 100}%):</b> 1 if NASA files it under
            spacecraft fire safety.
          </li>
          <li>
            <b>Evidence depth ({WEIGHTS.depth * 100}%):</b> publications on a log scale (51
            publications = 1).
          </li>
        </ul>
        <p className="mt-2">
          The score orders evidence for reading; it does not say an investigation is
          correct, nor that its results transfer to the habitat.
        </p>
      </details>
    </Card>
  );
}

function Chip({ on, children }: { on: boolean; children: React.ReactNode }) {
  return (
    <span
      className={`rounded-full border px-2 py-0.5 ${on ? "border-transparent bg-accent/15 text-ink" : "border-line text-muted"}`}
    >
      {children}
    </span>
  );
}

/* ---------------------------------------------------------------------------------- */

function oxygenText(inv: Investigation) {
  const r = inv.oxygen_range;
  if (!r) return "not stated";
  return r[0] === null ? `up to ${r[1]}%` : r[0] === r[1] ? `${r[1]}%` : `${r[0]}–${r[1]}%`;
}
const quotes = (inv: Investigation, kind: "pressure" | "flow") =>
  inv.conditions[kind]?.map((q) => `${q.values.join("–")} ${q.unit}`).join(", ") || "not stated";
const hardwareGroup = (inv: Investigation) =>
  /ACME/i.test(inv.hardware)
    ? "ACME in the Combustion Integrated Rack"
    : /MDCA|Droplet/i.test(inv.hardware)
      ? "MDCA droplet apparatus in the CIR"
      : /Glovebox|MSG/i.test(inv.hardware)
        ? "Microgravity Science Glovebox flow duct"
        : /Cygnus|Saffire/i.test(inv.hardware)
          ? "Saffire enclosure on a Cygnus cargo craft"
          : inv.hardware || "not stated";

function Compare({ ids, toggle }: { ids: string[]; toggle: (id: string) => void }) {
  const rows = ids.map((id) => ALL.find((x) => x.id === id)!).filter(Boolean);
  if (!rows.length)
    return (
      <Card title="Compare investigations">
        <p className="text-sm text-muted">Pick up to three investigations to compare.</p>
      </Card>
    );
  const fields: [string, (i: Investigation) => string][] = [
    ["Objective", (i) => i.objective.split(/(?<=\.)\s/)[0] || "not stated"],
    ["Fuel / sample", (i) => FUEL[i.fuel]],
    ["Fire-safety pillar", (i) => i.pillars.map((p) => PILLAR_LABEL[p]).join(", ")],
    ["Hardware", hardwareGroup],
    ["Platform", (i) => i.platform || "not stated"],
    ["Oxygen tested", oxygenText],
    ["Pressure (as stated)", (i) => quotes(i, "pressure")],
    ["Flow speed (as stated)", (i) => quotes(i, "flow")],
    ["Measurements", (i) => i.measurements.join(", ") || "not stated"],
    ["Period", (i) => [i.start, i.end].filter(Boolean).join(" – ") || "not stated"],
    ["Publications", (i) => String(i.publications)],
  ];
  return (
    <Card title="Compare investigations" className="overflow-hidden">
      <div className="overflow-x-auto" data-lenis-prevent>
        <table className="w-full min-w-[40rem] text-sm">
          <thead>
            <tr>
              <th className="w-40 py-2 text-left text-xs font-normal text-muted">Attribute</th>
              {rows.map((r) => (
                <th key={r.id} className="py-2 text-left align-top">
                  <span className="font-medium text-ink">{r.acronym}</span>
                  <button type="button" onClick={() => toggle(r.id)} className="ml-2 text-xs text-muted hover:text-ink" aria-label={`Remove ${r.acronym}`}>
                    ✕
                  </button>
                  <span className="block text-xs font-normal text-muted">{r.id}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {fields.map(([label, get]) => {
              const vals = rows.map(get);
              const same = rows.length > 1 && vals.every((v) => v === vals[0]);
              return (
                <tr key={label} className="border-t border-line align-top">
                  <td className="py-2 pr-3 text-xs text-muted">
                    {label}
                    {same && <span className="ml-1 rounded bg-surface-2 px-1 text-[10px]">same</span>}
                  </td>
                  {vals.map((v, k) => (
                    <td key={k} className="py-2 pr-4 text-ink-2">
                      {v}
                    </td>
                  ))}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-3 text-xs text-muted">
        &quot;Same&quot; marks attributes the selected investigations share, for example the
        same apparatus, which makes their results easier to compare directly.
      </p>
    </Card>
  );
}

/* ---------------------------------------------------------------------------------- */

function CatalogList({ compare, toggle }: { compare: string[]; toggle: (id: string) => void }) {
  const [q, setQ] = useState("");
  const [pillar, setPillar] = useState<Pillar | "">("");
  const [fuel, setFuel] = useState<Investigation["fuel"] | "">("");
  const shown = ALL.filter(
    (i) =>
      (!pillar || i.pillars.includes(pillar)) &&
      (!fuel || i.fuel === fuel) &&
      (!q ||
        `${i.acronym} ${i.title} ${i.tags.join(" ")} ${i.objective}`.toLowerCase().includes(q.toLowerCase())),
  );
  return (
    <Card title={`Catalog · ${shown.length} of ${ALL.length}`}>
      <div className="mb-4 flex flex-wrap gap-3">
        <input
          className={`${select} min-w-0 flex-1`}
          placeholder="Search: smoke, PMMA, helium, extinction…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
        />
        <select className={select} value={pillar} onChange={(e) => setPillar(e.target.value as Pillar | "")}>
          <option value="">All pillars</option>
          {(Object.keys(PILLAR_LABEL) as Pillar[]).map((p) => (
            <option key={p} value={p}>
              {PILLAR_LABEL[p]}
            </option>
          ))}
        </select>
        <select className={select} value={fuel} onChange={(e) => setFuel(e.target.value as Investigation["fuel"] | "")}>
          <option value="">All fuels</option>
          {(Object.keys(FUEL) as Investigation["fuel"][]).map((f) => (
            <option key={f} value={f}>
              {FUEL[f]}
            </option>
          ))}
        </select>
      </div>
      <ul className="space-y-3">
        {shown.map((i) => (
          <li key={i.id} className="rounded-xl border border-line p-4">
            <div className="flex flex-wrap items-start justify-between gap-2">
              <div className="min-w-0">
                <p className="font-display text-lg text-ink">
                  {i.acronym} <span className="text-sm text-muted">· {i.id}</span>
                </p>
                <p className="text-sm text-ink-2">{i.title}</p>
              </div>
              <div className="flex flex-wrap gap-1.5 text-[11px]">
                {i.pillars.map((p) => (
                  <span key={p} className="rounded-full bg-accent/15 px-2 py-0.5 text-ink">
                    {PILLAR_LABEL[p]}
                  </span>
                ))}
                <span className="rounded-full border border-line px-2 py-0.5 text-ink-2">{FUEL[i.fuel]}</span>
              </div>
            </div>
            <p className="mt-2 line-clamp-3 text-sm text-ink-2">{i.objective || "Objective not stated in PSI."}</p>
            <div className="mt-2 grid gap-x-6 gap-y-1 text-xs text-ink-2 sm:grid-cols-2">
              <span><span className="text-muted">Oxygen:</span> {oxygenText(i)}</span>
              <span><span className="text-muted">Hardware:</span> {hardwareGroup(i)}</span>
              <span><span className="text-muted">Measurements:</span> {i.measurements.join(", ") || "not stated"}</span>
              <span><span className="text-muted">Publications:</span> {i.publications}</span>
            </div>
            {i.in_falmex && (
              <p className="mt-2 text-xs" style={{ color: "var(--good)" }}>
                In Falmex: {i.in_falmex}
              </p>
            )}
            <details className="mt-2 text-sm">
              <summary className="cursor-pointer text-xs text-accent">Details, conditions and sources</summary>
              <div className="mt-2 space-y-2 text-ink-2">
                {i.hypothesis && <p><b className="text-ink">Hypothesis.</b> {i.hypothesis}</p>}
                {i.approach && <p className="whitespace-pre-line"><b className="text-ink">Approach.</b> {i.approach}</p>}
                {(["oxygen", "pressure", "flow"] as const).map((k) =>
                  i.conditions[k]?.length ? (
                    <div key={k}>
                      <p className="text-xs font-medium text-ink capitalize">{k} as NASA states it</p>
                      <ul className="list-disc pl-5 text-xs">
                        {i.conditions[k]!.map((qq, n) => (
                          <li key={n}>&ldquo;{qq.quote}&rdquo;</li>
                        ))}
                      </ul>
                    </div>
                  ) : null,
                )}
                {i.oxygen_source && <p className="text-xs text-muted">Oxygen range source: {i.oxygen_source}.</p>}
                {i.apparatus_oxygen && <p className="text-xs text-muted">Apparatus: {i.apparatus_oxygen}.</p>}
                {i.impacts && <p><b className="text-ink">Research impacts.</b> {i.impacts}</p>}
                <p className="text-xs text-muted">
                  Classification: {i.classification_basis} Keywords: {i.tags.join(", ")}.
                </p>
              </div>
            </details>
            <div className="mt-2 flex flex-wrap gap-3 text-xs">
              <a className="text-accent underline" href={i.psi_url} target="_blank" rel="noreferrer">
                Open in NASA PSI ↗
              </a>
              {i.doi && (
                <a className="text-accent underline" href={`https://doi.org/${i.doi}`} target="_blank" rel="noreferrer">
                  DOI {i.doi}
                </a>
              )}
              <button type="button" className="text-accent underline" onClick={() => toggle(i.id)}>
                {compare.includes(i.id) ? "Remove from compare" : "Add to compare"}
              </button>
            </div>
          </li>
        ))}
      </ul>
    </Card>
  );
}
