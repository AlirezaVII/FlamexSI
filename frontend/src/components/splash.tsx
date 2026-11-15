"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { FLAME_FRAGMENT } from "@/components/flame-shader";
import { createQuad } from "@/components/gl-quad";
import { TEXTURES } from "@/components/landing/planets";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";
import "./splash.css";

/*
 * "Drop 01" loading screen.
 *
 * The wait is staged as a real microgravity experiment: a capsule is released down NASA
 * Glenn's Zero Gravity Research Facility (a 132 m drop, about 5.18 s of freefall). The moment
 * it is released the capsule is in freefall, gravity inside reads 0.00 g, and the flame in the
 * window collapses from a buoyant teardrop into a dim blue sphere. The capsule's depth is the
 * loading progress: it falls on a freefall curve but holds just above the bottom until the app
 * is really ready (engine reachable, workspace loaded, planet maps cached on the landing page).
 */

const DROP_M = 132;
const DROP_S = 5.18;
const ARM = 900; // ms of "armed, 1 g" before release
const FALL = 2300; // ms the visual fall takes at the earliest
const MAX_WAIT = 12000; // never trap anyone if something is down
const EXIT = 900;

type Engine = "connecting" | "ready" | "offline";

function lift() {
  const root = document.documentElement;
  if (root.dataset.splash === "leaving" || root.dataset.splash === "gone") return;
  root.dataset.splash = "leaving";
  window.setTimeout(() => (root.dataset.splash = "gone"), EXIT);
}

export function Splash() {
  const pathname = usePathname();
  const { loading } = useWorkspace();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const capsuleRef = useRef<HTMLDivElement>(null);
  const readRef = useRef<{ g: HTMLElement | null; t: HTMLElement | null; h: HTMLElement | null; v: HTMLElement | null }>({ g: null, t: null, h: null, v: null });
  const [engine, setEngine] = useState<Engine>("connecting");
  const [maps, setMaps] = useState(0);
  const [phase, setPhase] = useState<"armed" | "falling" | "landed">("armed");
  const [timedOut, setTimedOut] = useState(false);
  const needMaps = pathname === "/";
  const readyRef = useRef(false);

  const mapsDone = !needMaps || maps >= TEXTURES.length;
  const ready = (engine !== "connecting" && !loading && mapsDone) || timedOut;
  useEffect(() => {
    readyRef.current = ready;
  }, [ready]);

  // engine link, planet maps, give-up timer
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.splash === "gone") return;
    root.dataset.splash = "active";
    api
      .health()
      .then(() => setEngine("ready"))
      .catch(() => setEngine("offline"));
    if (needMaps) {
      for (const src of TEXTURES) {
        const img = new Image();
        img.onload = img.onerror = () => setMaps((m) => m + 1);
        img.src = src;
      }
    }
    const give = window.setTimeout(() => setTimedOut(true), MAX_WAIT);
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && lift();
    window.addEventListener("keydown", onKey);
    return () => {
      clearTimeout(give);
      window.removeEventListener("keydown", onKey);
    };
    // the splash runs once per document load
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // the drop: capsule, telemetry and flame share one clock
  useEffect(() => {
    const root = document.documentElement;
    if (root.dataset.splash === "gone") return;
    const canvas = canvasRef.current;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

    const quad = canvas ? createQuad(canvas, FLAME_FRAGMENT, true) : null;

    const start = performance.now();
    let depth = 0; // 0..1 of the shaft
    let gNow = 1;
    let raf = 0;
    let landedAt = 0;
    let lastPhase = "armed";
    const setP = (p: typeof lastPhase) => {
      if (p !== lastPhase) {
        lastPhase = p;
        setPhase(p as "armed" | "falling" | "landed");
      }
    };

    const frame = (now: number) => {
      const el = now - start;
      // freefall curve (depth ~ t^2) for the visual fall; hold at 94% until really ready
      const f = reduce ? 1 : Math.min(1, Math.max(0, (el - ARM) / FALL));
      let target = f * f;
      if (!readyRef.current) target = Math.min(target, 0.94);
      depth += (target - depth) * (reduce ? 1 : 0.18);
      const released = el > ARM || reduce;
      if (!released) setP("armed");
      else if (depth < 0.999) setP("falling");
      // inside a freely falling capsule the measured gravity drops to ~0 almost instantly
      const gTarget = released ? 0 : 1;
      gNow += (gTarget - gNow) * (reduce ? 1 : 0.12);

      // physical readouts derived from the capsule's depth in the real tower
      const h = depth * DROP_M;
      const t = Math.sqrt((2 * h) / 9.80665);
      const r = readRef.current;
      if (r.g) r.g.textContent = gNow.toFixed(2);
      if (r.t) r.t.textContent = Math.min(t, DROP_S).toFixed(2);
      if (r.h) r.h.textContent = h.toFixed(1);
      if (r.v) r.v.textContent = (9.80665 * Math.min(t, DROP_S)).toFixed(1);
      if (capsuleRef.current) capsuleRef.current.style.setProperty("--depth", String(depth));

      quad?.draw({ g: gNow, time: reduce ? 2 : el / 1000, mode: 1, bg: 1, zoom: 1.75 });

      if (depth >= 0.999 && readyRef.current) {
        if (!landedAt) {
          landedAt = now;
          setP("landed");
        }
        // a beat to read "drop complete", then the iris closes onto the flame
        if (now - landedAt > (reduce ? 200 : 650)) {
          lift();
          return;
        }
      }
      if (root.dataset.splash === "gone") return;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
    return () => {
      cancelAnimationFrame(raf);
      quad?.dispose();
    };
  }, []);

  const check = (label: string, state: "wait" | "ok" | "warn", value: string) => (
    <li className={`sp-check is-${state}`}>
      <span className="sp-check-label">{label}</span>
      <span className="sp-check-dots" aria-hidden />
      <span className="sp-check-value">{value}</span>
    </li>
  );

  return (
    <div className="splash" onClick={lift} role="presentation" data-phase={phase}>
      <div className="sp-grid" aria-hidden />

      {/* the drop tower shaft, with the capsule falling down it */}
      <div className="sp-shaft" aria-hidden>
        <div className="sp-shaft-scale">
          {Array.from({ length: 12 }, (_, i) => (
            <span key={i} style={{ top: `${(i / 11) * 100}%` }}>
              {Math.round((i / 11) * DROP_M)} m
            </span>
          ))}
        </div>
        <div className="sp-shaft-rail">
          <div className="sp-capsule" ref={capsuleRef}>
            <i />
          </div>
        </div>
      </div>

      <div className="sp-center">
        <div className="sp-window">
          <canvas ref={canvasRef} aria-hidden />
          <div className="sp-reticle" aria-hidden />
          <div className="sp-g" aria-label="Gravity inside the capsule">
            <b ref={(el) => void (readRef.current.g = el)}>1.00</b>
            <small>g</small>
          </div>
        </div>
        <h1 className="sp-title" aria-label="Falmex">
          {"FALMEX".split("").map((c, i) => (
            <span key={i} style={{ animationDelay: `${0.25 + i * 0.06}s` }}>
              {c}
            </span>
          ))}
        </h1>
        <p className="sp-tag">AI insights from NASA microgravity combustion</p>
      </div>

      <aside className="sp-telemetry" aria-live="polite">
        <p className="sp-kicker">
          <span className="sp-rec" /> DROP 01 ·{" "}
          {phase === "armed" ? "ARMED" : phase === "falling" ? "FREEFALL" : "DROP COMPLETE"}
        </p>
        <p className="sp-facility">
          NASA Glenn · Zero Gravity Research Facility
          <br />
          {DROP_M} m drop · {DROP_S} s of freefall
        </p>
        <dl className="sp-read">
          <div>
            <dt>t</dt>
            <dd>
              <b ref={(el) => void (readRef.current.t = el)}>0.00</b> s
            </dd>
          </div>
          <div>
            <dt>depth</dt>
            <dd>
              <b ref={(el) => void (readRef.current.h = el)}>0.0</b> m
            </dd>
          </div>
          <div>
            <dt>speed</dt>
            <dd>
              <b ref={(el) => void (readRef.current.v = el)}>0.0</b> m/s
            </dd>
          </div>
        </dl>
        <ul className="sp-checks">
          {check(
            "Analysis engine",
            engine === "connecting" ? "wait" : engine === "ready" ? "ok" : "warn",
            engine === "connecting" ? "linking" : engine === "ready" ? "linked" : "offline",
          )}
          {check("Workspace", loading ? "wait" : "ok", loading ? "loading" : "loaded")}
          {needMaps &&
            check(
              "Planet maps",
              mapsDone ? "ok" : "wait",
              `${Math.min(maps, TEXTURES.length)}/${TEXTURES.length}`,
            )}
        </ul>
        <p className="sp-cap">
          {phase === "armed"
            ? "On the ground, hot gas rises: the flame is a tall teardrop."
            : "Falling freely, nothing rises: the flame closes into a sphere."}
        </p>
      </aside>

      <button type="button" className="sp-skip" onClick={lift}>
        Skip
      </button>
    </div>
  );
}
