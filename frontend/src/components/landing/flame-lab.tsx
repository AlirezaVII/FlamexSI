"use client";

import { useEffect, useRef, useState } from "react";
import { FLAME_FRAGMENT } from "@/components/flame-shader";
import { createQuad } from "@/components/gl-quad";

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
    const quad = createQuad(canvas, FLAME_FRAGMENT);
    if (!quad) return;
    const u = { g: 1, mode: 0 };
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
      // ease the flame towards the chosen gravity, so changes read as a transformation
      const k = reduce ? 1 : 1 - Math.pow(0.02, dt);
      u.g += (target.current.g - u.g) * k;
      u.mode += (target.current.mode - u.mode) * (reduce ? 1 : Math.min(1, dt * 8));
      if (Math.abs(u.mode - target.current.mode) < 0.02) u.mode = target.current.mode;
      quad.draw({ g: u.g, mode: u.mode, time: sim, bg: 0, zoom: 1 });
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
      quad.dispose();
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
