"use client";

import { useEffect, useRef, useState } from "react";
import { api } from "@/lib/api";
import { useWorkspace } from "@/lib/workspace";

/*
 * "Flame in freefall" loading screen, shown on every page load.
 *
 * On Earth, buoyancy pulls hot gas upward and a flame stretches into a yellow teardrop.
 * Take gravity away, as in NASA's droplet-combustion experiments on the ISS, and the flame
 * becomes a dim-centred blue sphere around the fuel droplet. The screen plays that
 * transition while a gravity readout falls from 1.00 g to 0.00 g, then waits until the app
 * is ready (analysis engine reachable, workspace loaded) before it lifts.
 */

const MIN_SHOW = 3300; // let the story reach the title and tagline before lifting
const MAX_WAIT = 12000; // never trap the user if the engine is down; the app shows the error
const EXIT = 500;

// deterministic starfield
const STARS = Array.from({ length: 70 }, (_, i) => ({
  x: (i * 7919) % 100,
  y: (i * 104729) % 100,
  r: ((i * 31) % 3) * 0.35 + 0.5,
  d: ((i * 13) % 20) / 10,
}));
// soot rising on Earth, then drifting outward in all directions in orbit
const RISE = Array.from({ length: 9 }, (_, i) => ({
  x: 88 + ((i * 37) % 26),
  d: i * 0.11,
}));
const DRIFT = Array.from({ length: 14 }, (_, i) => {
  const a = (i / 14) * Math.PI * 2;
  return {
    dx: Math.cos(a) * 70,
    dy: Math.sin(a) * 70,
    d: 1.55 + (i % 4) * 0.06,
  };
});
const TITLE = "FALMEX".split("");

type Engine = "connecting" | "ready" | "offline";


function skip() {
  const root = document.documentElement;
  if (root.dataset.splash === "leaving" || root.dataset.splash === "gone")
    return;
  root.dataset.splash = "leaving";
  window.setTimeout(() => (root.dataset.splash = "gone"), EXIT);
}

export function Splash() {
  const gRef = useRef<HTMLSpanElement>(null);
  const { loading } = useWorkspace();
  const [engine, setEngine] = useState<Engine>("connecting");
  const [minDone, setMinDone] = useState(false);
  const [timedOut, setTimedOut] = useState(false);

  // mark the screen as driven by JS (disables the CSS-only fallback), run the counter
  useEffect(() => {
    const root = document.documentElement;
    // skipped by the boot script, or already lifted: a remount must never replay it
    if (root.dataset.splash === "gone") return;
    root.dataset.splash = "active";
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;
    let frame = 0;

    // gravity readout 1.00 g -> 0.00 g, read off the flame animation's own clock so the
    // number falls exactly while the teardrop collapses (0.55s -> 1.6s of the scene)
    const earth = document.querySelector(".splash-earth");
    const tick = (now: number) => {
      const clock = earth?.getAnimations()[0]?.currentTime;
      const elapsed = typeof clock === "number" ? clock : now;
      const t = Math.min(1, Math.max(0, (elapsed - 550) / 1050));
      const eased = t * t * (3 - 2 * t);
      if (gRef.current) gRef.current.textContent = (1 - eased).toFixed(2);
      if (t < 1) frame = requestAnimationFrame(tick);
    };
    if (reduce) {
      if (gRef.current) gRef.current.textContent = "0.00";
    } else {
      frame = requestAnimationFrame(tick);
    }

    const since = performance.now();
    const minTimer = window.setTimeout(
      () => setMinDone(true),
      Math.max(0, (reduce ? 700 : MIN_SHOW) - since),
    );
    const maxTimer = window.setTimeout(() => setTimedOut(true), MAX_WAIT);

    api
      .health()
      .then(() => setEngine("ready"))
      .catch(() => setEngine("offline"));

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(minTimer);
      clearTimeout(maxTimer);
    };
  }, []);

  const ready = engine !== "connecting" && !loading;

  // lift once the story has played and the app is ready (or we gave up waiting)
  useEffect(() => {
    if (!((minDone && ready) || timedOut)) return;
    const root = document.documentElement;
    if (root.dataset.splash !== "active") return; // skipped, already lifted, or never shown
    // give an "engine offline" message a moment to be read
    const delay = engine === "offline" && !timedOut ? 1200 : 0;
    const t1 = window.setTimeout(
      () => (root.dataset.splash = "leaving"),
      delay,
    );
    const t2 = window.setTimeout(
      () => (root.dataset.splash = "gone"),
      delay + EXIT,
    );
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [minDone, ready, timedOut, engine]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") skip();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const status =
    engine === "offline"
      ? "Analysis engine unreachable — opening anyway"
      : ready
        ? "Ready for launch"
        : engine === "ready"
          ? "Loading experiment datasets…"
          : "Connecting to the analysis engine…";

  return (
    <div className="splash" onClick={skip} role="presentation">
      <svg
        className="splash-stars"
        aria-hidden
        viewBox="0 0 100 100"
        preserveAspectRatio="none"
      >
        {STARS.map((s, i) => (
          <circle
            key={i}
            cx={s.x}
            cy={s.y}
            r={s.r * 0.12}
            style={{ animationDelay: `${s.d}s` }}
          />
        ))}
      </svg>

      <div className="splash-stage" aria-hidden>
        <svg viewBox="0 0 200 200" className="splash-flame">
          <defs>
            <radialGradient id="sp-earth" cx="50%" cy="72%" r="60%">
              <stop offset="0%" stopColor="#fff7d6" />
              <stop offset="28%" stopColor="#ffd35a" />
              <stop offset="58%" stopColor="#ff8a1f" />
              <stop offset="85%" stopColor="#e2441b" stopOpacity="0.55" />
              <stop offset="100%" stopColor="#e2441b" stopOpacity="0" />
            </radialGradient>
            <radialGradient id="sp-orbit" cx="50%" cy="50%" r="50%">
              <stop offset="0%" stopColor="#0a1633" stopOpacity="0" />
              <stop offset="52%" stopColor="#10306e" stopOpacity="0.35" />
              <stop offset="74%" stopColor="#3f8dff" />
              <stop offset="84%" stopColor="#9fd0ff" />
              <stop offset="92%" stopColor="#2f6bff" stopOpacity="0.6" />
              <stop offset="100%" stopColor="#2f6bff" stopOpacity="0" />
            </radialGradient>
            <filter id="sp-glow" x="-50%" y="-50%" width="200%" height="200%">
              <feGaussianBlur stdDeviation="6" />
            </filter>
          </defs>

          {/* orbit path */}
          <g className="splash-orbit">
            <ellipse
              cx="100"
              cy="100"
              rx="86"
              ry="30"
              fill="none"
              stroke="#6f8cc7"
              strokeOpacity="0.35"
              strokeDasharray="2 5"
            />
            <circle
              className="splash-sat"
              cx="0"
              cy="0"
              r="2.2"
              fill="#cfe0ff"
            />
          </g>

          {/* Earth flame: buoyancy stretches it upward */}
          <g className="splash-earth">
            <path
              d="M100 118 C 78 110 76 82 100 30 C 124 82 122 110 100 118 Z"
              fill="url(#sp-earth)"
              filter="url(#sp-glow)"
              opacity="0.7"
            />
            <path
              d="M100 118 C 80 110 79 84 100 36 C 121 84 120 110 100 118 Z"
              fill="url(#sp-earth)"
            />
            {RISE.map((p, i) => (
              <circle
                key={i}
                className="splash-rise"
                cx={p.x}
                cy={70}
                r={1.4}
                style={{ animationDelay: `${p.d}s` }}
              />
            ))}
          </g>

          {/* microgravity flame: a blue sphere around the droplet */}
          <g className="splash-sphere">
            <circle
              cx="100"
              cy="100"
              r="46"
              fill="#3f8dff"
              opacity="0.35"
              filter="url(#sp-glow)"
            />
            <circle cx="100" cy="100" r="40" fill="url(#sp-orbit)" />
            {DRIFT.map((p, i) => (
              <circle
                key={i}
                className="splash-drift"
                cx={100}
                cy={100}
                r={1.3}
                style={
                  {
                    "--dx": `${p.dx}px`,
                    "--dy": `${p.dy}px`,
                    animationDelay: `${p.d}s`,
                  } as React.CSSProperties
                }
              />
            ))}
          </g>

          {/* fuel droplet */}
          <circle
            cx="100"
            cy="100"
            r="5"
            fill="#1b2233"
            stroke="#8aa4d6"
            strokeOpacity="0.6"
          />
          <circle cx="98.4" cy="98.4" r="1.4" fill="#dfe8ff" opacity="0.8" />
        </svg>

        <div className="splash-readout">
          <span className="splash-readout-label">gravity</span>
          <span className="splash-readout-value">
            <span ref={gRef}>1.00</span> g
          </span>
        </div>

        <div className="splash-captions">
          <p className="splash-cap splash-cap-1">
            On Earth, hot gas rises and flames stretch upward.
          </p>
          <p className="splash-cap splash-cap-2">
            In orbit there is no “up”, so a flame becomes a sphere.
          </p>
        </div>

        <h1 className="splash-title" aria-label="Falmex">
          {TITLE.map((c, i) => (
            <span key={i} style={{ animationDelay: `${1.95 + i * 0.07}s` }}>
              {c}
            </span>
          ))}
        </h1>
        <p className="splash-tagline">
          AI insights from NASA microgravity combustion
        </p>
        <p
          className={`splash-status ${ready ? "is-ready" : ""} ${engine === "offline" ? "is-offline" : ""}`}
          role="status"
        >
          <span className="splash-status-dot" aria-hidden />
          {status}
        </p>
      </div>

      <button type="button" className="splash-skip" onClick={skip}>
        Skip
      </button>
    </div>
  );
}
