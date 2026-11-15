"use client";

import { useEffect, useRef, useState } from "react";
import * as THREE from "three";

// An illustrative (not simulated) flame whose shape follows gravity: with buoyancy hot gas
// rises, so a candle flame is tall, flickering and yellow with soot; in freefall oxygen
// arrives only by diffusion, so the flame closes into a steady, dimmer, bluish sphere.
// "Droplet" mode echoes the FLEX experiments: a fuel droplet on thin fibres that shrinks
// as it burns, inside a spherical flame.

const PRESETS: [string, number][] = [
  ["Earth", 1],
  ["Mars", 0.38],
  ["Moon", 0.17],
  ["Orbit", 0],
];

const fragment = /* glsl */ `
  precision highp float;
  uniform vec2 res;
  uniform float g;
  uniform float time;
  uniform float mode; // 0 candle, 1 droplet

  float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
  float noise(vec2 p) {
    vec2 i = floor(p), f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(mix(hash(i), hash(i + vec2(1, 0)), u.x),
               mix(hash(i + vec2(0, 1)), hash(i + vec2(1, 1)), u.x), u.y);
  }
  float fbm(vec2 p) {
    float v = 0.0, a = 0.5;
    for (int i = 0; i < 4; i++) { v += a * noise(p); p *= 2.03; a *= 0.5; }
    return v;
  }

  void main() {
    vec2 p = (gl_FragCoord.xy - 0.5 * res) / res.y * 2.0;
    float gb = sqrt(clamp(g, 0.0, 1.0));
    float t = time;
    vec3 col = vec3(0.0);

    // fuel source: candle wick, or a droplet that shrinks as it burns (d^2 law, looped)
    float life = fract(t / 9.0);
    float drop = mode > 0.5 ? 0.075 * sqrt(max(1.0 - life, 0.0)) + 0.012 : 0.0;
    vec2 src = mode > 0.5 ? vec2(0.0, -0.05) : vec2(0.0, -0.42);
    float size = mode > 0.5 ? 0.3 + drop * 3.2 : 0.34;

    vec2 q = p - src;
    // a candle flame always sits above its wick; a droplet flame surrounds the droplet
    float up = (mode > 0.5 ? mix(0.0, 0.38, gb) : mix(0.2, 0.38, gb)) * size / 0.34;
    q.y -= up;
    // buoyant flicker grows with height, and only exists with gravity
    float h = max(q.y + up, 0.0);
    q.x += gb * (fbm(vec2(p.y * 3.2 - t * 2.6, t * 0.6)) - 0.5) * 0.26 * h;
    q.y += gb * (fbm(vec2(p.x * 4.0, t * 1.9)) - 0.5) * 0.05;

    vec2 s = q;
    if (s.y > 0.0) {
      s.y /= mix(1.0, 2.4, gb);
      s.x *= 1.0 + s.y * 2.2 * gb;
    } else {
      s.y /= mix(1.0, 0.7, gb);
    }
    float R = mix(size, size * 0.62, gb);
    float d = length(s) / R;

    // thin reaction sheet (blue), bright where we look along it (limb brightening)
    float sheet = exp(-pow((d - 0.96) * 6.5, 2.0));
    float limb = 0.55 + 0.45 * smoothstep(0.6, 1.0, d);
    // soot glow: needs time at high temperature, i.e. the buoyant plume
    float body = smoothstep(1.02, 0.15, d);
    float soot = body * gb * smoothstep(-0.25, 0.25, q.y + 0.08);
    float core = smoothstep(0.55, 0.0, d) * gb;
    // blue base of a candle flame, where fresh air meets the fuel
    float base = gb * exp(-pow(length(vec2(q.x * 1.3, q.y + up - 0.02)) / 0.11, 2.0));
    // microgravity: faint orange shell inside the sphere (soot that cannot escape)
    float shell0 = (1.0 - gb) * exp(-pow((d - 0.7) * 5.0, 2.0)) * 0.22;

    vec3 blue = vec3(0.22, 0.45, 1.0);
    col += blue * sheet * limb * mix(1.05, 0.45, gb);
    col += blue * base * 1.3;
    col += vec3(1.0, 0.55, 0.16) * soot * 1.25;
    col += vec3(1.0, 0.86, 0.55) * core * 0.9;
    col += vec3(1.0, 0.5, 0.2) * shell0;
    // soft glow around everything
    float glow = exp(-d * 2.2) * mix(0.16, 0.3, gb);
    col += mix(blue, vec3(1.0, 0.6, 0.25), gb) * glow;
    // gentle steady breathing in freefall, flicker in gravity
    col *= 0.93 + 0.07 * sin(t * mix(1.3, 9.0, gb) + fbm(vec2(t)) * 3.0);

    // hardware
    if (mode < 0.5) {
      // candle body and wick
      float wax = step(abs(p.x), 0.13) * step(p.y, src.y - 0.05);
      vec3 waxCol = vec3(0.86, 0.82, 0.76) * (0.35 + 0.25 * smoothstep(0.13, -0.13, p.x));
      col = mix(col, waxCol + col * 0.4, wax);
      float wick = step(abs(p.x), 0.012) * step(src.y - 0.06, p.y) * step(p.y, src.y + 0.05);
      col = mix(col, vec3(0.05), wick * 0.9);
    } else {
      // two thin support fibres crossing at the droplet, and the droplet itself
      float fib = smoothstep(0.006, 0.0, abs(p.y - src.y + p.x * 0.18)) +
                  smoothstep(0.006, 0.0, abs(p.y - src.y - p.x * 0.18));
      col += vec3(0.5, 0.55, 0.65) * fib * 0.35;
      float dd = length(p - src);
      float dropMask = smoothstep(drop, drop - 0.006, dd);
      vec3 dropCol = vec3(0.35, 0.22, 0.08) + vec3(0.6, 0.4, 0.2) * smoothstep(drop, 0.0, length(p - src - vec2(-0.3, 0.3) * drop));
      col = mix(col, dropCol, dropMask);
    }

    // chamber vignette and faint scanlines, like experiment video
    col *= 1.0 - 0.35 * smoothstep(0.7, 1.6, length(p * vec2(0.8, 1.0)));
    col += 0.012 * sin(gl_FragCoord.y * 1.6);
    gl_FragColor = vec4(col, 1.0);
  }
`;

export function FlameLab() {
  const wrap = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [g, setG] = useState(1);
  const [mode, setMode] = useState<0 | 1>(0);
  const [follow, setFollow] = useState(true); // follow the page's gravity until touched
  const target = useRef({ g: 1, mode: 0 });
  const [clock, setClock] = useState(0);

  useEffect(() => {
    target.current = { g, mode };
  }, [g, mode]);

  // follow the scroll journey's gravity (Earth -> Orbit -> Moon -> Mars)
  useEffect(() => {
    const root = wrap.current?.closest(".landing");
    if (!root || !follow) return;
    const on = (e: Event) => setG((e as CustomEvent<number>).detail);
    const now = parseFloat(root.querySelector("[data-gravity]")?.textContent ?? "");
    if (Number.isFinite(now)) setG(now);
    root.addEventListener("falmex:gravity", on);
    return () => root.removeEventListener("falmex:gravity", on);
  }, [follow]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: false });
    } catch {
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    const scene = new THREE.Scene();
    const camera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const uniforms = {
      res: { value: new THREE.Vector2(1, 1) },
      g: { value: 1 },
      time: { value: 0 },
      mode: { value: 0 },
    };
    const mat = new THREE.ShaderMaterial({
      fragmentShader: fragment,
      vertexShader: "void main(){gl_Position=vec4(position.xy,0.0,1.0);}",
      uniforms,
    });
    const quad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), mat);
    scene.add(quad);
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    let visible = true;
    const io = new IntersectionObserver(([e]) => {
      visible = e.isIntersecting;
      if (visible) wake();
    });
    io.observe(canvas);

    let raf = 0;
    let running = false;
    let last = performance.now();
    let sim = 0;
    let lastClock = 0;
    const frame = (now: number) => {
      const dt = Math.min(now - last, 50) / 1000;
      last = now;
      sim += reduce ? 0 : dt;
      const w = canvas.clientWidth;
      const h = canvas.clientHeight;
      const pr = renderer.getPixelRatio();
      if (canvas.width !== Math.round(w * pr) || canvas.height !== Math.round(h * pr)) {
        renderer.setSize(w, h, false);
      }
      renderer.getDrawingBufferSize(uniforms.res.value);
      // ease the flame towards the chosen gravity, so changes read as a transformation
      const k = reduce ? 1 : 1 - Math.pow(0.02, dt);
      uniforms.g.value += (target.current.g - uniforms.g.value) * k;
      uniforms.mode.value += (target.current.mode - uniforms.mode.value) * (reduce ? 1 : Math.min(1, dt * 8));
      if (Math.abs(uniforms.mode.value - target.current.mode) < 0.02) uniforms.mode.value = target.current.mode;
      uniforms.time.value = sim;
      renderer.render(scene, camera);
      if (sim - lastClock > 0.1) {
        lastClock = sim;
        setClock(sim);
      }
      if (visible && !document.hidden) raf = requestAnimationFrame(frame);
      else running = false;
    };
    function wake() {
      if (running) return;
      running = true;
      last = performance.now();
      raf = requestAnimationFrame(frame);
    }
    document.addEventListener("visibilitychange", wake);
    wake();
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
      document.removeEventListener("visibilitychange", wake);
      renderer.dispose();
      mat.dispose();
      quad.geometry.dispose();
    };
  }, []);

  const choose = (value: number) => {
    setFollow(false);
    setG(value);
  };
  const where =
    PRESETS.find(([, v]) => Math.abs(v - g) < 0.005)?.[0] ?? "Custom";
  const dropletLife = ((clock % 9) / 9) * 100;

  return (
    <div className="flamelab" ref={wrap}>
      <div className="chamber">
        <canvas ref={canvasRef} aria-label={`Illustrated ${mode ? "fuel droplet" : "candle"} flame at ${g.toFixed(2)} g`} role="img" />
        <div className="hud tl">
          <span className="rec" /> {mode ? "DROPLET · FLEX-STYLE" : "CANDLE"} · {where.toUpperCase()}
        </div>
        <div className="hud tr">g = {g.toFixed(2)}</div>
        <div className="hud bl">t = {clock.toFixed(1)} s</div>
        {mode === 1 && (
          <div className="hud br">droplet burn {dropletLife.toFixed(0)}%</div>
        )}
      </div>
      <div className="controls">
        <div className="seg" role="group" aria-label="Fuel">
          <button type="button" aria-pressed={mode === 0} onClick={() => setMode(0)}>
            Candle
          </button>
          <button type="button" aria-pressed={mode === 1} onClick={() => setMode(1)}>
            Fuel droplet
          </button>
        </div>
        <label className="slider">
          <span>Gravity</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={g}
            onChange={(e) => choose(parseFloat(e.target.value))}
            aria-valuetext={`${g.toFixed(2)} g`}
          />
          <b>{g.toFixed(2)} g</b>
        </label>
        <div className="presets" role="group" aria-label="Gravity presets">
          {PRESETS.map(([name, v]) => (
            <button
              key={name}
              type="button"
              aria-pressed={Math.abs(v - g) < 0.005}
              onClick={() => choose(v)}
            >
              {name} <small>{v.toFixed(2)}</small>
            </button>
          ))}
        </div>
        <p className="follow">
          {follow ? (
            "Following the page: scroll and watch gravity change."
          ) : (
            <button type="button" className="link" onClick={() => setFollow(true)}>
              Follow the page&apos;s gravity again
            </button>
          )}
        </p>
      </div>
    </div>
  );
}
