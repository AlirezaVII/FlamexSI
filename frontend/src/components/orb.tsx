"use client";

/**
 * The thinking orb (thinking-orbs, MIT, Jakub Antalik): a dotted sphere on a plain 2D canvas.
 * It shows WHAT the assistant is doing, not just that it is busy: each real stage the server
 * reports has its own animation, and a change of stage crossfades instead of snapping. The
 * dots are tinted with FlamexSI's flame gradient (blue edge, orange core).
 * Drawn with the library's engine at the exact pixel size, so any size works.
 */

import { useEffect, useRef } from "react";
import { MODE_DRAWS, resolvePreset, type OrbState } from "thinking-orbs/engine";

export type Stage =
  | "idle" | "think" | "plan" | "tool" | "read" | "analyse" | "compose" | "verify" | "error";

export const STAGE_MODE: Record<Stage, OrbState> = {
  idle: "breathing",
  think: "shaping",
  plan: "weaving",
  tool: "working",
  read: "searching",
  analyse: "solving",
  compose: "composing",
  verify: "connecting",
  error: "breathing",
};
const FADE_MS = 450;

function dark() {
  const t = document.documentElement.dataset.theme;
  if (t) return t === "dark";
  return window.matchMedia?.("(prefers-color-scheme: dark)").matches ?? false;
}

export function Orb({
  stage = "idle",
  mode,
  size = 64,
  tint = true,
  label,
  className = "",
}: {
  stage?: Stage;
  mode?: OrbState;
  size?: number;
  tint?: boolean;
  label?: string;
  className?: string;
}) {
  const verb = mode ?? STAGE_MODE[stage];
  const canvas = useRef<HTMLCanvasElement>(null);
  const live = useRef({ verb, prev: null as OrbState | null, changedAt: 0, tint });

  useEffect(() => {
    if (live.current.verb !== verb)
      live.current = { verb, prev: live.current.verb, changedAt: performance.now(), tint };
    live.current.tint = tint;
  }, [verb, tint]);

  useEffect(() => {
    const el = canvas.current;
    const ctx = el?.getContext("2d");
    if (!el || !ctx) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    el.width = size * dpr;
    el.height = size * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const still = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
    const tuned = size <= 28 ? 20 : 64;
    const started = performance.now();
    let raf = 0;
    let warned = false;
    let visible = true;
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting));
    io.observe(el);
    const gradient = (isDark: boolean) => {
      const g = ctx.createRadialGradient(size / 2, size * 0.58, 0, size / 2, size / 2, size / 2);
      // brighter on dark backgrounds, deeper on light ones so the dots stay readable
      const [core, mid, edge, rim] = isDark
        ? ["#ffc061", "#ff8a4c", "#7d97ff", "#5470ff"]
        : ["#f07a00", "#e6532b", "#3b4fe0", "#2433c9"];
      g.addColorStop(0, core);
      g.addColorStop(0.45, mid);
      g.addColorStop(0.75, edge);
      g.addColorStop(1, rim);
      return g;
    };
    const grads = { dark: gradient(true), light: gradient(false) };
    const draw = (v: OrbState, t: number, alpha: number, isDark: boolean) => {
      let r = resolvePreset(v, tuned);
      if (typeof MODE_DRAWS[r?.mode] !== "function") {
        // never let an unexpected value stop the animation loop
        if (!warned) console.warn("Orb: unknown state", v);
        warned = true;
        r = resolvePreset("breathing", tuned);
      }
      ctx.globalAlpha = alpha;
      try {
        MODE_DRAWS[r.mode](ctx, size, still ? 0 : t * r.speed, isDark, r.opts);
      } catch {
        // the library's modules can still be initialising on the very first frames after a
        // page load; skip this frame, the next one draws normally
      }
    };
    const render = (now: number) => {
      raf = requestAnimationFrame(render);
      if (!visible || document.hidden) return;
      const { verb: cur, prev, changedAt, tint: tinted } = live.current;
      const t = (now - started) / 1000;
      const k = prev && !still ? Math.min(1, (now - changedAt) / FADE_MS) : 1;
      const isDark = dark();
      ctx.globalCompositeOperation = "source-over";
      ctx.clearRect(0, 0, size, size);
      if (k < 1 && prev) draw(prev, t, 1 - k, isDark);
      draw(cur, t, k, isDark);
      ctx.globalAlpha = 1;
      if (tinted) {
        ctx.globalCompositeOperation = "source-atop"; // recolour the dots, keep their alpha
        ctx.fillStyle = isDark ? grads.dark : grads.light;
        ctx.fillRect(0, 0, size, size);
        ctx.globalCompositeOperation = "source-over";
      }
      if (still) cancelAnimationFrame(raf);
    };
    raf = requestAnimationFrame(render);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [size]);

  return (
    <canvas
      ref={canvas}
      role="img"
      aria-label={label ?? `Assistant: ${verb}`}
      className={className}
      style={{ width: size, height: size, display: "block" }}
    />
  );
}
