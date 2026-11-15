// Real planets for the landing page: NASA equirectangular surface maps projected onto a
// lit sphere in a <canvas>. The projection is precomputed once per size, so spinning a
// planet each frame is only a table lookup per pixel.

export interface PlanetOptions {
  tilt: number; // axial tilt shown on screen (radians)
  ambient: number; // night-side brightness
  tint: [number, number, number];
  atmo: string | null; // atmosphere glow colour
}

export interface Planet {
  canvas: HTMLCanvasElement;
  draw: (spin: number) => void;
}

const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));

// sunlight from the upper left, slightly towards the viewer
const SUN = (() => {
  const v = [-0.62, -0.38, 0.68];
  const n = Math.hypot(...v);
  return v.map((x) => x / n);
})();

export function makePlanet(
  img: HTMLImageElement,
  o: PlanetOptions,
  S: number,
): Planet {
  const tc = document.createElement("canvas");
  tc.width = img.naturalWidth;
  tc.height = img.naturalHeight;
  const tx = tc.getContext("2d", { willReadFrequently: true })!;
  tx.drawImage(img, 0, 0);
  const T = tx.getImageData(0, 0, tc.width, tc.height).data;
  const TW = tc.width;
  const TH = tc.height;

  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = S;
  const cx = canvas.getContext("2d")!;
  const out = cx.createImageData(S, S);
  const D = out.data;

  const n = S * S;
  const u = new Float32Array(n);
  const row = new Int32Array(n);
  const shade = new Float32Array(n);
  const inside = new Uint8Array(n);
  const ct = Math.cos(o.tilt);
  const st = Math.sin(o.tilt);

  for (let j = 0; j < S; j++) {
    for (let i = 0; i < S; i++) {
      const x = ((i + 0.5) / S) * 2 - 1;
      const y = ((j + 0.5) / S) * 2 - 1;
      const r2 = x * x + y * y;
      if (r2 > 1) continue;
      const k = j * S + i;
      inside[k] = 1;
      const z = Math.sqrt(1 - r2);
      const light = x * SUN[0] + y * SUN[1] + z * SUN[2];
      const day = Math.pow(clamp(light * 1.7 + 0.04), 0.85); // day/night terminator
      const limb = 0.55 + 0.45 * Math.pow(z, 0.6); // limb darkening
      shade[k] = (o.ambient + (1 - o.ambient) * day) * limb;
      const xr = x * ct + y * st;
      const yr = -x * st + y * ct;
      const lat = Math.asin(clamp(-yr, -1, 1));
      const lon = Math.atan2(xr, Math.sqrt(Math.max(0, 1 - xr * xr - yr * yr)));
      u[k] = lon / (2 * Math.PI) + 0.5;
      row[k] = Math.min(TH - 1, Math.floor((0.5 - lat / Math.PI) * TH)) * TW;
    }
  }

  return {
    canvas,
    draw(spin: number) {
      const off = (spin % 1) + 1;
      for (let k = 0; k < n; k++) {
        const p = k * 4;
        if (!inside[k]) {
          D[p + 3] = 0;
          continue;
        }
        let uu = u[k] + off;
        uu -= Math.floor(uu);
        const t = (row[k] + Math.floor(uu * TW)) * 4;
        const s = shade[k];
        D[p] = T[t] * s * o.tint[0];
        D[p + 1] = T[t + 1] * s * o.tint[1];
        D[p + 2] = T[t + 2] * s * o.tint[2];
        D[p + 3] = 255;
      }
      cx.putImageData(out, 0, 0);
    },
  };
}

export const PLANETS: Record<
  "earth" | "moon" | "mars",
  PlanetOptions & { src: string; spin0: number }
> = {
  earth: {
    src: "/textures/earth.jpg",
    tilt: 0.41,
    ambient: 0.025,
    tint: [1.25, 1.25, 1.32],
    atmo: "#5aa2ff",
    spin0: 0.04,
  },
  moon: {
    src: "/textures/moon.jpg",
    tilt: 0.03,
    ambient: 0.03,
    tint: [1, 1, 1],
    atmo: null,
    spin0: 0.5,
  },
  mars: {
    src: "/textures/mars.jpg",
    tilt: 0.44,
    ambient: 0.03,
    tint: [1.12, 1.02, 0.96],
    atmo: "#ff9a6a",
    spin0: 0.12,
  },
};

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
