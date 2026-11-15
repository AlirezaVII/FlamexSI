"use client";

import Link from "next/link";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import beyond from "@/lib/flight/beyond.json";
import saffire from "@/lib/flight/saffire.json";
import saffire12 from "@/lib/flight/saffire12.json";
import showcase from "@/lib/flight/showcase.json";
import smoke from "@/lib/flight/smoke.json";
import review from "@/lib/bass-review.json";

/* Moon, Mars and Earth: what the orbital (0 g) flight data can and cannot say about partial
 * gravity, and where the same results matter on the ground. Every number on this page comes
 * from a NASA file processed by FlamexSI, or from one stated physics formula. */

const G = 9.81;
const WORLDS = [
  { id: "iss", name: "ISS (orbit)", g: 0 },
  { id: "moon", name: "Moon", g: 0.165 },
  { id: "mars", name: "Mars", g: 0.378 },
  { id: "earth", name: "Earth", g: 1 },
] as const;
// hot flame gas ~2000 K in ~300 K air: density deficit 1 - T_air/T_flame ≈ 0.85
const DEFICIT = 0.85;
const buoyantSpeed = (g: number, cm: number) => Math.sqrt(g * G * (cm / 100) * DEFICIT) * 100; // cm/s

const burned12 = saffire12.flights.flatMap((f) => f.samples.filter((s) => s.burned));
const forced = Math.round(burned12.reduce((a, s) => a + s.before.air_speed_cm_s, 0) / burned12.length);
const nSamples = saffire12.flights.reduce((a, f) => a + f.samples.length, 0);
const kapton = smoke.materials.find((m) => m.material === "Kapton")!;
const silicone = smoke.materials.find((m) => m.material === "Silicone")!;
const big = saffire.samples.find((s) => s.burn_s && s.burn_s > 60)!;
const radFirst = (big.pairs["radiometers 1+3"] as { first_s?: number }).first_s;
const smokeFirst = (big.detectors.CDH_F2PCM_SMK_DET_SCAT_SENS_P as { first_s?: number }).first_s;
const cv = review.summary.find((r) => r.model === "OpenCV" && r.reference === "A")!;
const hep = beyond.fuels.Heptane;
const meth = beyond.fuels.Methanol;

export default function BeyondPage() {
  const [cm, setCm] = useState(2);
  const speeds = WORLDS.map((w) => ({ ...w, u: buoyantSpeed(w.g, cm) }));
  const max = Math.max(buoyantSpeed(1, cm), forced) * 1.1;

  return (
    <>
      <PageHeader eyebrow="Beyond the ISS" title="Moon, Mars and Earth">
        The NASA flight data behind FlamexSI was recorded in orbit, at almost zero gravity.
        This page shows what that data can say about fires in Moon and Mars habitats, where it
        stops, and where the same results already matter on Earth.
      </PageHeader>

      <div className="space-y-6">
        <Card title="Partial gravity: where Moon and Mars sit between orbit and Earth">
          <p className="max-w-3xl text-sm text-ink-2">
            On Earth, hot flame gas rises and pulls in fresh air: that buoyant flow feeds the
            fire. In orbit it is gone, which is why FLEX droplet flames burn as spheres. On the
            Moon and Mars it is weaker than on Earth but not zero. No combustion experiment in
            NASA&apos;s PSI archive has run at lunar or Martian gravity yet, so FlamexSI does not
            invent results for it. It uses one standard physics estimate instead:{" "}
            <b className="text-ink">buoyant speed ≈ √(g · L · 0.85)</b>, for a flame of size L
            (0.85 is how much lighter ~2000 K flame gas is than room air).
          </p>
          <label className="mt-4 block max-w-md text-sm">
            <span className="text-xs text-muted">Flame size L: {cm} cm</span>
            <input type="range" min={0.5} max={20} step={0.5} value={cm}
              onChange={(e) => setCm(Number(e.target.value))} className="mt-1 w-full accent-[var(--accent)]" />
          </label>
          <div className="mt-4 space-y-2" role="img" aria-label="Buoyant air speed by world, compared with Saffire's air flow">
            {speeds.map((w) => (
              <div key={w.id} className="grid grid-cols-[7rem_1fr_5rem] items-center gap-3 text-sm">
                <span className="text-ink">{w.name} <span className="text-xs text-muted">{w.g} g</span></span>
                <div className="relative h-3 rounded-full bg-surface-2">
                  <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${(w.u / max) * 100}%` }} />
                  <span className="absolute top-[-4px] h-5 w-0.5 bg-serious" style={{ left: `${(forced / max) * 100}%` }} />
                </div>
                <span className="text-right tabular-nums text-ink-2">{w.u.toFixed(1)} cm/s</span>
              </div>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">
            <span className="text-serious">│</span> Saffire&apos;s air flow, {forced} cm/s: the gentle
            fan-driven flow in which {burned12.length} of {nSamples} Saffire-I/II samples kept
            burning in orbit (<Link href="/flight-evidence#saffire12" className="text-accent">data</Link>).
          </p>
          <div className="mt-4 rounded-lg border-l-4 border-accent bg-surface-2 p-3 text-sm text-ink-2">
            <b className="text-ink">What it suggests:</b> for a flame a few centimetres across,
            the Moon&apos;s and Mars&apos;s natural buoyant flow is about the size of the air flow in
            the Saffire experiments. So the Saffire flight data (orbit, plus a gentle fan) is the
            closest real data we have to a small fire in a lunar or Martian habitat, closer than
            a fire on Earth. This is a physics estimate to be tested, not a measured result.
          </div>
          <div className="mt-4 grid gap-3 md:grid-cols-2">
            <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
              <p className="text-xs uppercase tracking-wider text-muted">Habitat air, measured in flight</p>
              <p className="mt-1 text-ink-2">
                NASA recommends {Math.round(beyond.habitat_atmosphere.oxygen * 100)}% oxygen at{" "}
                {beyond.habitat_atmosphere.pressure_kpa} kPa for exploration habitats
                ({beyond.habitat_atmosphere.reference}). FLEX already burned droplets at 30–40%
                oxygen, about {hep.enriched.median_pressure_kpa} kPa. There the median burning
                rate was <b className="text-ink">{hep.change_pct}% higher for heptane</b> and{" "}
                <b className="text-ink">{meth.change_pct}% higher for methanol</b> than in
                air-like oxygen ({hep.enriched.n + meth.enriched.n} vs{" "}
                {hep.air.n + meth.air.n} tests).
              </p>
              <p className="mt-1 text-xs text-muted">
                Pressure differs between the groups too; with pressure held fixed, the oxygen
                link is the validated finding (Spearman ρ {showcase.unseen_effect.toFixed(2)} on
                unseen tests).
              </p>
            </div>
            <div className="rounded-xl border border-line bg-surface-2 p-3 text-sm">
              <p className="text-xs uppercase tracking-wider text-muted">What would make this real</p>
              <ul className="mt-1 list-disc space-y-1 pl-4 text-ink-2">
                <li>Burn the Saffire materials at 0.165 g and 0.378 g (centrifuge on the ISS, or on the lunar surface).</li>
                <li>Repeat FLEX droplets in a 34% O₂, 56.5 kPa atmosphere at those gravities.</li>
                <li>Feed those results into FlamexSI: the pipeline already reads them the same way.</li>
              </ul>
            </div>
          </div>
        </Card>

        <Card title="On Earth: where these flight results already matter">
          <p className="mb-4 max-w-3xl text-sm text-ink-2">
            Each card links a FlamexSI result from NASA flight data to a place on Earth with the
            same problem. They are directions to test, not proven fixes.
          </p>
          <div className="grid gap-3 md:grid-cols-2">
            <Application
              title="Smoke from wire insulation is hard to see"
              where="Aircraft, trains, data centres and ships wired with polyimide (Kapton) insulation"
              evidence={`In SAME and SAME-R, Kapton smoke had the smallest particles (${kapton.fresh_diameter_um} µm) and the ISS light-scattering detector read it at ${kapton.detector_median_v} V, against ${silicone.detector_median_v} V for silicone.`}
              use="Pair light-scattering detectors with obscuration or gas sensors where fine-particle smoke is likely."
              href="/flight-evidence#smoke"
            />
            <Application
              title="See the flame before the smoke arrives"
              where="Submarines, aircraft cargo holds, mines: closed spaces with weak air flow"
              evidence={`In Saffire-III, radiometers next to the sample saw the flame ${radFirst} s after ignition; the cabin smoke detector crossed its threshold at ${smokeFirst} s.`}
              use="Optical flame sensors near likely fire sources can buy minutes where smoke drifts slowly."
              href="/flight-evidence#saffire"
            />
            <Application
              title="Which materials keep burning in gentle air flow"
              where="Material choice for vehicles, shelters and enclosed equipment"
              evidence={`In Saffire-I and II, the same igniter in about ${forced} cm/s of air lit only ${burned12.length} of ${nSamples} samples; the others went out once the igniter stopped.`}
              use="Screen materials in low, realistic air speeds, not only in still air or strong drafts."
              href="/flight-evidence#saffire12"
            />
            <Application
              title="Oxygen-rich rooms burn fuel faster"
              where="Hospitals with oxygen therapy, hyperbaric chambers, industrial oxygen lines"
              evidence={`Across ${showcase.n_experiments} FLEX tests, higher oxygen went with a higher burning rate (Spearman ρ ${showcase.discovery_effect.toFixed(2)}), and the link held on unseen tests (${showcase.unseen_effect.toFixed(2)}).`}
              use="Treat every extra percent of oxygen as faster burning when setting fire limits for enriched rooms."
              href="/findings"
            />
            <Application
              title="Measure a fire from an ordinary video"
              where="Fire-safety labs and test facilities with standard cameras"
              evidence={`FlamexSI's OpenCV method, with no training, overlapped a reviewer's flame outline on BASS-II video by ${Math.round(cv.iou * 100)}%, more than two people agreed with each other (26%).`}
              use="Turn existing test footage into flame size, growth rate and colour, frame by frame."
              href="/footage"
            />
          </div>
        </Card>
      </div>
    </>
  );
}

function Application({ title, where, evidence, use, href }: {
  title: string; where: string; evidence: string; use: string; href: string;
}) {
  return (
    <div className="rounded-xl border border-line bg-surface-2 p-4 text-sm">
      <p className="font-display text-lg text-ink">{title}</p>
      <p className="mt-1 text-xs text-muted">{where}</p>
      <p className="mt-2 text-ink-2"><span className="text-xs uppercase tracking-wider text-accent">Flight evidence </span>{evidence}</p>
      <p className="mt-2 text-ink-2"><span className="text-xs uppercase tracking-wider text-good">On Earth </span>{use}</p>
      <Link href={href} className="mt-2 inline-block text-xs font-medium text-accent">See the data →</Link>
    </div>
  );
}
