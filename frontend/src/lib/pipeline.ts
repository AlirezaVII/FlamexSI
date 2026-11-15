/**
 * The FlamexSI pipeline, in order. The navigation is built from it, and page transitions
 * use it for direction: moving to a later step animates forward, to an earlier step back,
 * and between two pages of the same stage sideways.
 */
export const STAGE_PAGES: { stage: number; name: string; hrefs: string[] }[] = [
  { stage: 0, name: "Overview", hrefs: ["/overview"] },
  { stage: 1, name: "Data", hrefs: ["/investigations", "/data", "/bass-review", "/footage"] },
  { stage: 2, name: "Explore", hrefs: ["/explorer", "/compare"] },
  {
    stage: 3,
    name: "Discover",
    hrefs: ["/relationships", "/findings", "/review"],
  },
  {
    stage: 4,
    name: "Understand",
    hrefs: ["/assistant", "/insights", "/flight-evidence", "/flame-lab", "/simulator"],
  },
  { stage: 5, name: "Build", hrefs: ["/innovation"] },
];

/** (stage, step) of a path; detail pages sit just after their list page. */
export function position(path: string): [number, number] {
  const clean = path.split(/[?#]/)[0];
  for (const s of STAGE_PAGES) {
    for (const [i, href] of s.hrefs.entries()) {
      if (clean === href) return [s.stage, i];
      if (clean.startsWith(`${href}/`)) return [s.stage, i + 0.5];
    }
  }
  return [0, 0];
}

export type NavType = "nav-forward" | "nav-back" | "nav-lateral";

export function navType(from: string, to: string): NavType {
  const [fs, fi] = position(from);
  const [ts, ti] = position(to);
  if (fs === ts && Math.floor(fi) !== Math.floor(ti)) return "nav-lateral";
  if (ts > fs || (ts === fs && ti > fi)) return "nav-forward";
  return "nav-back";
}
