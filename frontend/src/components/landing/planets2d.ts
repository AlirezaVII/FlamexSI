// 2D fallback for the landing-page planets, for browsers without WebGL2 (three.js needs it).
// NASA maps projected onto a lit sphere in a plain <canvas>; the projection is precomputed
// once per size, so spinning a planet each frame is only a table lookup per pixel.
import type { PlanetKey, PlanetPose, SceneState, Space } from "./space";

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


const OPTS: Record<PlanetKey, PlanetOptions & { lo: string; hi: string; spin0: number }> = {
  earth: { lo: "/textures/earth-lo.webp", hi: "/textures/earth.webp", tilt: 0.41, ambient: 0.025, tint: [1.25, 1.25, 1.32], atmo: "#5aa2ff", spin0: -0.18 },
  moon: { lo: "/textures/moon-lo.webp", hi: "/textures/moon.webp", tilt: 0.03, ambient: 0.03, tint: [1, 1, 1], atmo: null, spin0: 0.5 },
  mars: { lo: "/textures/mars-lo.webp", hi: "/textures/mars.webp", tilt: 0.44, ambient: 0.03, tint: [1.12, 1.02, 0.96], atmo: "#ff9a6a", spin0: 0.12 },
};

export function create2DSpace(canvas: HTMLCanvasElement, onReady?: () => void): Space | null {
  const g = canvas.getContext("2d");
  if (!g) return null;
  let disposed = false;
  const planets: Partial<Record<PlanetKey, { img: HTMLImageElement; lo: Planet; hi: Planet | null }>> = {};
  for (const key of Object.keys(OPTS) as PlanetKey[]) {
    const o = OPTS[key];
    const lo = new Image();
    lo.onload = () => {
      if (disposed) return;
      planets[key] = { img: lo, lo: makePlanet(lo, o, 360), hi: null };
      if (key === "earth") onReady?.();
      const hi = new Image();
      hi.onload = () => {
        if (disposed) return;
        planets[key] = { img: hi, lo: makePlanet(hi, o, 560), hi: null };
      };
      hi.src = o.hi;
    };
    lo.src = o.lo;
  }
  return {
    render(poses: Record<PlanetKey, PlanetPose>, state: SceneState) {
      void state;
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (canvas.width !== W || canvas.height !== H) {
        canvas.width = W;
        canvas.height = H;
      }
      g.clearRect(0, 0, W, H);
      const order = (Object.keys(poses) as PlanetKey[]).sort((a, b) => poses[a].r - poses[b].r);
      for (const k of order) {
        const pk = planets[k];
        const { x, y, r, spin } = poses[k];
        if (!pk || r < 1) continue;
        if (y - r > H + 40 || y + r < -40 || x - r > W + 40 || x + r < -40) continue;
        let pl = pk.lo;
        if (r > 330) {
          pk.hi ??= makePlanet(pk.img, OPTS[k], 1100);
          pl = pk.hi;
        }
        const atmo = OPTS[k].atmo;
        if (atmo) {
          const gr = g.createRadialGradient(x, y, r * 0.92, x, y, r * 1.16);
          gr.addColorStop(0, `${atmo}cc`);
          gr.addColorStop(0.35, `${atmo}55`);
          gr.addColorStop(1, `${atmo}00`);
          g.fillStyle = gr;
          g.beginPath();
          g.arc(x, y, r * 1.16, 0, Math.PI * 2);
          g.fill();
        }
        pl.draw(spin + OPTS[k].spin0);
        g.drawImage(pl.canvas, x - r, y - r, 2 * r, 2 * r);
      }
    },
    setTheme() {},
    dispose() {
      disposed = true;
    },
  };
}
