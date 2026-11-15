"use client";

import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { progress } from "@/lib/progress";

const SHOW_DELAY = 150; // quick requests never flash the bar
const TRICKLE = 250;
const NAV_TIMEOUT = 10000; // safety net if a navigation never settles

/**
 * Thin orange bar at the top of the viewport (NProgress-style). Runs while any API
 * request or page navigation is in flight. Drives the DOM directly: no re-renders.
 */
export function ProgressBar() {
  const bar = useRef<HTMLDivElement>(null);
  const pathname = usePathname();
  const navPending = useRef(false);
  const navTimer = useRef<number>(0);

  // animate the bar from the global counter
  useEffect(() => {
    const el = bar.current;
    if (!el) return;
    let phase: "idle" | "waiting" | "running" | "finishing" = "idle";
    let width = 0;
    let showTimer = 0;
    let trickle = 0;
    let hideTimer = 0;

    const set = (w: number, visible: boolean) => {
      width = w;
      el.style.transform = `scaleX(${w / 100})`;
      el.style.opacity = visible ? "1" : "0";
    };

    const run = (from: number) => {
      phase = "running";
      if (from === 0) {
        el.style.transition = "none";
        set(0, true);
        void el.offsetWidth; // restart from zero before animating
        el.style.transition = "";
      }
      set(Math.max(from, 12), true);
      trickle = window.setInterval(() => {
        // slows down as it approaches 90%: it never completes on its own
        set(width + (90 - width) * (0.08 + Math.random() * 0.06), true);
      }, TRICKLE);
    };

    const begin = () => {
      if (phase === "waiting" || phase === "running") return;
      if (phase === "finishing") {
        // new work arrived while fading out: pick up from where the bar is
        clearTimeout(hideTimer);
        run(Math.min(width, 60));
        return;
      }
      phase = "waiting";
      showTimer = window.setTimeout(() => run(0), SHOW_DELAY);
    };

    const end = () => {
      if (phase === "waiting") {
        clearTimeout(showTimer); // finished before it was ever shown
        phase = "idle";
        return;
      }
      if (phase !== "running") return;
      clearInterval(trickle);
      phase = "finishing";
      set(100, true);
      hideTimer = window.setTimeout(() => {
        set(100, false);
        hideTimer = window.setTimeout(() => {
          el.style.transition = "none";
          set(0, false);
          phase = "idle";
        }, 300);
      }, 200);
    };

    const unsubscribe = progress.subscribe((n) => (n > 0 ? begin() : end()));
    return () => {
      unsubscribe();
      clearTimeout(showTimer);
      clearTimeout(hideTimer);
      clearInterval(trickle);
    };
  }, []);

  // navigation start: any click on an internal link to a different page
  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || url.pathname === location.pathname)
        return;
      if (navPending.current) return;
      navPending.current = true;
      progress.start();
      navTimer.current = window.setTimeout(() => {
        if (navPending.current) {
          navPending.current = false;
          progress.done();
        }
      }, NAV_TIMEOUT);
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  // navigation end: the new route has rendered
  useEffect(() => {
    if (!navPending.current) return;
    navPending.current = false;
    clearTimeout(navTimer.current);
    progress.done();
  }, [pathname]);

  return (
    <div
      aria-hidden
      className="pointer-events-none fixed inset-x-0 top-0 z-[90] h-[3px]"
    >
      <div
        ref={bar}
        className="h-full origin-left bg-accent opacity-0 shadow-[0_0_10px_var(--accent),0_0_4px_var(--accent)] transition-[transform,opacity] duration-200 ease-out"
        style={{ transform: "scaleX(0)" }}
      />
    </div>
  );
}
