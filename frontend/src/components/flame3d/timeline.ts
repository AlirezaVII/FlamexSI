import tests from "@/lib/flight/flex_tests.json";
import type { FrameState, Fuel } from "./engine";

export interface FlexTest {
  n: number;
  id: string;
  date: string;
  fuel: Fuel;
  p: number | null; // mmHg
  o2: number;
  n2: number;
  co2: number;
  he: number;
  d0: number; // mm
  dext: number | null; // mm, measured visible-flame extinction diameter
  k: number; // mm^2/s, measured burning rate
  tb: number; // s, measured burn time
  end: "Extinction" | "Completion" | "Disruption";
}

export const TESTS = tests as FlexTest[];
export const byN = new Map(TESTS.map((t) => [t.n, t]));

export const PRE = 0.9; // s shown before ignition (igniters approach and glow)
export const COOL_HOLD = 3; // s the illustrative cool flame stays after visible extinction
export const kPa = (mmHg: number | null) => (mmHg == null ? null : mmHg * 0.133322);

/** d²-law with the measured burning rate: d(t)² = d0² − K·t. */
export const dAt = (x: FlexTest, t: number) =>
  Math.sqrt(Math.max(x.d0 * x.d0 - x.k * Math.max(t, 0), 0));

export const endOf = (x: FlexTest, cool: boolean) =>
  x.tb + (x.end === "Extinction" && cool && x.fuel === "Heptane" ? COOL_HOLD + 1.2 : 1.4);

export interface Moment {
  state: Omit<FrameState, "gravity" | "soot">;
  phase: string;
}

export function momentAt(x: FlexTest, t: number, cool: boolean): Moment {
  const ease = (v: number) => Math.min(Math.max(v, 0), 1);
  let d = dAt(x, Math.min(t, x.tb));
  let flame = 0;
  let coolI = 0;
  let disrupt = 0;
  let phase = "";
  const igniter = t < 0 ? ease((t + PRE) / (PRE * 0.6)) : -ease(t / 0.7);

  if (t < 0) phase = "Igniters heating";
  else if (t < x.tb) {
    flame = ease(t / 0.25);
    phase = t < 0.25 ? "Ignition" : "Burning (d² law, measured K)";
  } else {
    const s = t - x.tb;
    if (x.end === "Disruption") {
      disrupt = ease(s / 0.9) || 0.0001;
      flame = 1 - ease(s / 0.15);
      phase = "Droplet disrupted (test end)";
    } else if (x.end === "Completion") {
      d = d * (1 - ease(s / 0.35));
      flame = 1 - ease(s / 0.35);
      phase = "Fuel fully burned";
    } else {
      flame = 1 - ease(s / 0.3);
      phase = "Visible flame out";
      if (cool && x.fuel === "Heptane") {
        coolI = ease((s - 0.2) / 0.5) * (1 - ease((s - COOL_HOLD) / 1));
        if (coolI > 0.05) phase = "Cool flame (illustrative)";
      }
    }
  }
  return {
    state: { t, d, flame, cool: coolI, disrupt, fuel: x.fuel, o2: x.o2, igniter },
    phase,
  };
}

export function diluent(x: FlexTest) {
  const parts = [`O₂ ${(x.o2 * 100).toFixed(0)}%`];
  if (x.n2 > 0.005) parts.push(`N₂ ${(x.n2 * 100).toFixed(0)}%`);
  if (x.co2 > 0.005) parts.push(`CO₂ ${(x.co2 * 100).toFixed(0)}%`);
  if (x.he > 0.005) parts.push(`He ${(x.he * 100).toFixed(0)}%`);
  return parts.join(" · ");
}

export const label = (x: FlexTest) =>
  `#${x.n} ${x.id} · ${x.fuel} · ${diluent(x)} · ${
    kPa(x.p) != null ? `${kPa(x.p)!.toFixed(0)} kPa` : "p n/a"
  } · d₀ ${x.d0.toFixed(2)} mm · ${x.end}`;

/** Pairs of real tests that differ mainly in one thing, for the presets. */
function pair(
  a: (x: FlexTest) => boolean,
  b: (x: FlexTest) => boolean,
): [number, number] | null {
  let best: [number, number] | null = null;
  let bestCost = Infinity;
  for (const x of TESTS.filter(a))
    for (const y of TESTS.filter(b)) {
      if (x.n === y.n || x.p == null || y.p == null) continue;
      const cost =
        Math.abs(x.d0 - y.d0) * 2 + Math.abs(x.p - y.p) / 100 + (x.end === y.end ? 0 : 0.3);
      if (cost < bestCost) {
        bestCost = cost;
        best = [x.n, y.n];
      }
    }
  return best;
}
const air = (x: FlexTest) => x.co2 < 0.01 && x.he < 0.01;
const atm = (x: FlexTest) => x.p != null && Math.abs(x.p - 760) < 40;

export const PRESETS: { name: string; why: string; pair: [number, number] | null }[] = [
  {
    name: "More oxygen",
    why: "Heptane in 21% vs 30%+ oxygen at 1 atm: same fuel, similar droplet size.",
    pair: pair((x) => x.fuel === "Heptane" && air(x) && atm(x) && Math.abs(x.o2 - 0.21) < 0.011,
      (x) => x.fuel === "Heptane" && air(x) && atm(x) && x.o2 >= 0.3),
  },
  {
    name: "Heptane vs methanol",
    why: "Sooty heptane against clean-burning methanol in the same air at 1 atm.",
    pair: pair((x) => x.fuel === "Heptane" && air(x) && atm(x) && Math.abs(x.o2 - 0.21) < 0.011,
      (x) => x.fuel === "Methanol" && air(x) && atm(x) && Math.abs(x.o2 - 0.21) < 0.011),
  },
  {
    name: "CO₂ suppressant",
    why: "Same fuel with and without carbon dioxide in the atmosphere.",
    pair: pair((x) => x.fuel === "Heptane" && air(x),
      (x) => x.fuel === "Heptane" && x.co2 >= 0.15),
  },
  {
    name: "Helium diluent",
    why: "Helium replacing part of the nitrogen: same fuel.",
    pair: pair((x) => x.fuel === "Methanol" && air(x),
      (x) => x.fuel === "Methanol" && x.he >= 0.1),
  },
  {
    name: "Extinction vs completion",
    why: "A flame that went out before the fuel was gone, and one that burned it all.",
    pair: pair((x) => x.fuel === "Heptane" && x.end === "Extinction",
      (x) => x.fuel === "Heptane" && x.end === "Completion"),
  },
].filter((p) => p.pair);
