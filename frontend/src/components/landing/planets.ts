// Scroll choreography for the landing-page planets (rendered in WebGL by space.ts).

export const PLANETS = { earth: 0, moon: 1, mars: 2 } as const;

type Key = [p: number, x: number, y: number, r: number, spin: number];

// The journey: scroll progress -> where each planet is (x, y as viewport fractions,
// r in px at 1440 wide), and how far it has turned.
export const DESKTOP_PATH: Record<keyof typeof PLANETS, Key[]> = {
  earth: [
    [0, 0.73, 0.55, 300, 0],
    [0.16, 0.88, 0.08, 210, 0.18],
    [0.3, 1.02, -0.45, 150, 0.3],
  ],
  moon: [
    [0.12, 0.98, 1.35, 110, 0],
    [0.32, 0.84, 0.58, 175, 0.12],
    [0.52, 0.04, -0.32, 230, 0.26],
  ],
  mars: [
    [0.44, 0.5, 1.35, 110, 0],
    [0.66, 0.5, 0.86, 150, 0.1],
    [0.84, 0.5, 1.25, 480, 0.18],
    [1, 0.5, 1.66, 900, 0.24],
  ],
};

// On phones r is a fraction of the viewport width.
export const MOBILE_PATH: Record<keyof typeof PLANETS, Key[]> = {
  earth: [
    [0, 0.5, 0.95, 0.5, 0],
    [0.12, 0.78, 0.18, 0.36, 0.18],
    [0.25, 1.15, -0.4, 0.3, 0.3],
  ],
  moon: [
    [0.15, 1.15, 1.3, 0.25, 0],
    [0.32, 0.78, 0.5, 0.32, 0.12],
    [0.5, -0.15, -0.3, 0.4, 0.26],
  ],
  mars: [
    [0.45, 0.5, 1.4, 0.25, 0],
    [0.66, 0.5, 0.92, 0.34, 0.1],
    [0.85, 0.5, 1.2, 0.9, 0.18],
    [1, 0.5, 1.5, 1.6, 0.24],
  ],
};

// [from progress, stage index, gravity at that stage]
export const STAGES: [number, number, string][] = [
  [0, 0, "1.00"],
  [0.2, 1, "0.00"],
  [0.36, 2, "0.17"],
  [0.62, 3, "0.38"],
];

const smooth = (t: number) => t * t * (3 - 2 * t);

export function along(path: Key[], p: number): Key {
  if (p <= path[0][0]) return path[0];
  const last = path[path.length - 1];
  if (p >= last[0]) return last;
  for (let i = 0; i < path.length - 1; i++) {
    const a = path[i];
    const b = path[i + 1];
    if (p >= a[0] && p <= b[0]) {
      const t = smooth((p - a[0]) / (b[0] - a[0]));
      return a.map((v, j) => v + (b[j] - v) * t) as Key;
    }
  }
  return last;
}
