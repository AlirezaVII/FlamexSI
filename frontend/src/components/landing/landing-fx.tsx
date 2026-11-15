"use client";

import { useEffect, useRef } from "react";
import { along, DESKTOP_PATH, MOBILE_PATH, PLANETS, STAGES } from "./planets";
import { createSpace, type PlanetPose } from "./space";

type Key = keyof typeof PLANETS;

/** Light page? Explicit choice wins, otherwise the system setting. */
function isLight() {
  const t = document.documentElement.dataset.theme;
  if (t === "light" || t === "dark") return t === "light";
  return !window.matchMedia("(prefers-color-scheme: dark)").matches;
}
const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
const easeOut = (t: number) => 1 - Math.pow(1 - t, 3);

/**
 * Everything that moves on the landing page, driven by scroll position (so it follows the
 * reader exactly) plus the hero Earth, which turns with the cursor and can be dragged.
 */
export function LandingFX() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    const root = canvas?.closest(".landing");
    if (!canvas || !root) return;
    // planets stay hidden until every map has arrived, then make a cinematic entrance
    let ready = false;
    let introStart = 0;
    const space = createSpace(
      canvas,
      () => render(),
      () => {
        ready = true;
        canvas.classList.add("ready");
        maybeIntro();
      },
    );
    // the entrance waits for the loading screen to lift
    function maybeIntro() {
      if (!ready || introStart) return;
      const splash = document.documentElement.dataset.splash;
      if (splash && splash !== "gone" && splash !== "leaving") return;
      introStart = performance.now();
      wake();
    }
    const splashWatch = new MutationObserver(maybeIntro);
    splashWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-splash"],
    });
    const reduce = window.matchMedia(
      "(prefers-reduced-motion: reduce)",
    ).matches;

    const $ = <T extends Element>(sel: string) => root.querySelector<T>(sel);
    const topbar = $<HTMLElement>(".topbar");
    const progress = $<HTMLElement>(".progress");
    const gval = $<HTMLElement>("[data-gravity]");
    const stages = [...root.querySelectorAll<HTMLElement>(".journey li")];
    const layers = [...root.querySelectorAll<SVGElement>(".sky svg")];
    const heroCopy = $<HTMLElement>("[data-hero-copy]");
    const grab = $<HTMLElement>("[data-grab]");
    const hint = $<HTMLElement>("[data-grab-hint]");
    const reveals = [...root.querySelectorAll<HTMLElement>("[data-reveal]")];

    reveals.forEach((el) => {
      const siblings = [...(el.parentElement?.children ?? [])].filter((c) =>
        c.hasAttribute("data-reveal"),
      );
      el.dataset.lag = String(siblings.indexOf(el) * 60);
    });

    // ---- theme: the WebGL halos adapt to a light or dark page ---------------------------
    const syncTheme = () => space?.setTheme(isLight());
    syncTheme();
    const themeWatch = new MutationObserver(syncTheme);
    themeWatch.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["data-theme"],
    });
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    media.addEventListener("change", syncTheme);

    // ---- Earth rotation from the cursor ------------------------------------------------
    let yaw = 0; // turns added by dragging / idle spin
    let vel = 0; // turns per frame (inertia)
    let hover = 0; // gentle follow of the cursor (turns)
    let hoverTarget = 0;
    let dragging = false;
    let lastX = 0;
    let lastT = 0;

    let tiltX = 0; // whole scene leans towards the pointer (radians)
    let tiltY = 0;
    let tiltTX = 0;
    let tiltTY = 0;
    let spinBoost = 0; // fast scrolling flings the planets round a little
    let lastScroll = window.scrollY;

    const onMove = (e: PointerEvent) => {
      hoverTarget = (e.clientX / window.innerWidth - 0.5) * 0.07;
      tiltTY = (e.clientX / window.innerWidth - 0.5) * 0.22;
      tiltTX = (e.clientY / window.innerHeight - 0.5) * 0.16;
      if (!dragging) return;
      const dx = e.clientX - lastX;
      const now = performance.now();
      const earthR = currentEarthRadius();
      const turns = dx / (2 * Math.PI * Math.max(earthR, 80));
      yaw -= turns;
      vel = clamp(-turns / Math.max(1, (now - lastT) / 16.7), -0.006, 0.006);
      lastX = e.clientX;
      lastT = now;
      wake();
    };
    const onDown = (e: PointerEvent) => {
      if ((e.target as Element).closest("a,button")) return;
      dragging = true;
      lastX = e.clientX;
      lastT = performance.now();
      vel = 0;
      grab?.setPointerCapture(e.pointerId);
      if (hint) hint.style.opacity = "0";
      wake();
    };
    const onUp = () => {
      dragging = false;
    };
    window.addEventListener("pointermove", onMove, { passive: true });
    grab?.addEventListener("pointerdown", onDown);
    window.addEventListener("pointerup", onUp);
    window.addEventListener("pointercancel", onUp);

    let earthR = 300;
    function currentEarthRadius() {
      return earthR;
    }

    // ---- frame ---------------------------------------------------------------------------
    let lastG = "";
    function render() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      const max = Math.max(1, document.documentElement.scrollHeight - H);
      const y = window.scrollY;
      const p = clamp(y / max);
      const mobile = W < 900;
      const paths = mobile ? MOBILE_PATH : DESKTOP_PATH;
      const scale = mobile ? W : clamp(W / 1440, 0.7, 1.3);

      // navbar, progress, journey + gravity
      topbar?.classList.toggle("scrolled", y > 16);
      if (progress) progress.style.width = `${p * 100}%`;
      let stage = STAGES[0];
      for (const s of STAGES) if (p >= s[0]) stage = s;
      stages.forEach((li, i) => li.classList.toggle("on", i === stage[1]));
      if (gval) gval.textContent = `${stage[2]} g`;
      // tell the rest of the page the current reference gravity (the flame demo follows
      // it, and cards drift weightlessly in orbit)
      if (stage[2] !== lastG) {
        lastG = stage[2];
        root!.classList.toggle("zero-g", stage[2] === "0.00");
        root!.dispatchEvent(
          new CustomEvent("falmex:gravity", { detail: parseFloat(stage[2]) }),
        );
      }

      // parallax: star layers and hero copy
      layers.forEach((l) => {
        l.style.transform = `translate3d(0,${-y * parseFloat(l.dataset.speed ?? "0")}px,0)`;
      });
      const h = clamp(y / H);
      if (heroCopy && !reduce) {
        heroCopy.style.transform = `translate3d(0,${y * 0.18}px,0)`;
        heroCopy.style.opacity = String(1 - h * 1.1);
      }
      if (hint) hint.style.display = p > 0.05 ? "none" : "";

      // sections rise in as they enter the viewport
      reveals.forEach((el) => {
        if (reduce) return;
        const r = el.getBoundingClientRect();
        const t = easeOut(
          clamp(
            (H - r.top - parseFloat(el.dataset.lag ?? "0") - 40) / (H * 0.32),
          ),
        );
        el.style.opacity = String(t);
        el.style.transform = `translate3d(0,${(1 - t) * 46}px,0) scale(${0.97 + 0.03 * t})`;
      });

      // trust card: the bars fill as it enters; the "oxygen held fixed" bar then shrinks from
      // the uncontrolled effect to its controlled value. The numbers next to the bars are
      // always the final, computed values — only the bar widths animate.
      const card = root!.querySelector<HTMLElement>("[data-trust-card]");
      if (card?.dataset.found) {
        const F = parseFloat(card.dataset.found) * 100;
        const O = parseFloat(card.dataset.oxygen ?? "0") * 100;
        const Pr = parseFloat(card.dataset.pressure ?? "0") * 100;
        const cr = card.getBoundingClientRect();
        const fill = reduce
          ? 1
          : easeOut(clamp((H - cr.top - 120) / (H * 0.3)));
        const drop = reduce
          ? 1
          : easeOut(clamp((H * 0.62 - cr.top) / (H * 0.28)));
        const set = (k: string, w: number) => {
          const el = card.querySelector<HTMLElement>(`[data-bar='${k}']`);
          if (el) el.style.width = `${w}%`;
        };
        set("found", F * fill);
        set("pressure", Pr * fill);
        set("oxygen", (F * (1 - drop) + O * drop) * fill);
      }

      // planets (real 3D spheres in WebGL)
      const now = performance.now();
      // entrance: Earth rushes in from far away while spinning down (expo ease-out)
      const t = introStart ? clamp((now - introStart) / 2600) : 0;
      const intro = reduce ? 1 : t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const poses = {} as Record<Key, PlanetPose>;
      for (const k of Object.keys(paths) as Key[]) {
        const [, xv, yv, rv, spin] = along(paths[k], p);
        let r = rv * scale;
        let x = xv * W;
        let yy = yv * H;
        let extra = 0;
        if (k === "earth") {
          earthR = r;
          r *= 0.18 + 0.82 * intro;
          x += (1 - intro) * W * 0.12;
          yy -= (1 - intro) * H * 0.18;
          extra = yaw + hover - (1 - intro) * 1.4 + spinBoost;
        } else {
          // Moon and Mars keep turning slowly on their own
          extra = now / 240000 + spinBoost * 0.6;
        }
        poses[k] = { x, y: yy, r, spin: spin + extra };
      }
      space?.render(poses, {
        time: now,
        sun: -p * 2.4,
        tiltX,
        tiltY,
        iss: clamp(1 - p / 0.16) * clamp((intro - 0.6) / 0.4),
      });
    }

    // ---- animation loop: planets turn and clouds drift while the tab is visible -----------
    let raf = 0;
    let running = false;
    function tick() {
      if (!dragging) {
        yaw += vel;
        vel *= 0.9;
        if (!reduce) yaw += 0.00045; // slow idle rotation
      }
      hover += (hoverTarget - hover) * 0.06;
      tiltX += (tiltTX - tiltX) * 0.05;
      tiltY += (tiltTY - tiltY) * 0.05;
      const sy = window.scrollY;
      spinBoost += clamp((sy - lastScroll) / 9000, -0.02, 0.02);
      lastScroll = sy;
      render();
      if (!document.hidden && !reduce) {
        raf = requestAnimationFrame(tick);
      } else {
        running = false;
      }
    }
    function wake() {
      if (running) return;
      running = true;
      raf = requestAnimationFrame(tick);
    }
    const onScroll = () => {
      if (running) return; // the loop renders the new position on its next frame
      render();
    };
    window.addEventListener("scroll", onScroll, { passive: true });

    // ---- in-page links glide like a reader scrolling, instead of jumping --------------
    let glide = 0;
    const stopGlide = () => {
      if (glide) cancelAnimationFrame(glide);
      glide = 0;
    };
    const easeInOut = (t: number) =>
      t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
    function glideTo(targetY: number) {
      stopGlide();
      const startY = window.scrollY;
      const maxY = document.documentElement.scrollHeight - window.innerHeight;
      const endY = clamp(targetY, 0, maxY);
      const dist = Math.abs(endY - startY);
      if (dist < 2) return;
      if (reduce) {
        window.scrollTo(0, endY);
        return;
      }
      // longer trips take longer, like a real scroll: ~0.7 s to ~1.8 s
      const duration = clamp(500 + dist * 0.45, 700, 1800);
      // a virtual clock that advances at most ~2 frames per step: if the page stalls for a
      // moment the glide pauses and resumes instead of jumping ahead
      let elapsed = 0;
      let last = performance.now();
      const step = (now: number) => {
        elapsed += Math.min(now - last, 34);
        last = now;
        const t = clamp(elapsed / duration);
        window.scrollTo(0, startY + (endY - startY) * easeInOut(t));
        glide = t < 1 ? requestAnimationFrame(step) : 0;
      };
      glide = requestAnimationFrame(step);
    }
    const onLinkClick = (e: MouseEvent) => {
      if (
        e.defaultPrevented ||
        e.button !== 0 ||
        e.metaKey ||
        e.ctrlKey ||
        e.shiftKey ||
        e.altKey
      )
        return;
      const a = (e.target as Element).closest<HTMLAnchorElement>("a[href]");
      if (!a || !root.contains(a)) return;
      const href = a.getAttribute("href") ?? "";
      if (href === "/" && window.location.pathname === "/") {
        e.preventDefault();
        glideTo(0);
        history.replaceState(null, "", "/");
        return;
      }
      if (!href.startsWith("#")) return;
      const target =
        href.length > 1 ? root.querySelector<HTMLElement>(href) : null;
      if (!target) return;
      e.preventDefault();
      const margin = parseFloat(getComputedStyle(target).scrollMarginTop) || 0;
      glideTo(target.getBoundingClientRect().top + window.scrollY - margin);
      history.replaceState(null, "", href);
    };
    // the reader takes over: stop gliding immediately
    const interrupt = () => stopGlide();
    const onKey = (e: KeyboardEvent) => {
      if (
        [
          "ArrowUp",
          "ArrowDown",
          "PageUp",
          "PageDown",
          "Home",
          "End",
          " ",
        ].includes(e.key)
      )
        stopGlide();
    };
    root.addEventListener("click", onLinkClick as EventListener);
    window.addEventListener("wheel", interrupt, { passive: true });
    window.addEventListener("touchstart", interrupt, { passive: true });
    window.addEventListener("keydown", onKey);
    window.addEventListener("resize", render);
    document.addEventListener("visibilitychange", wake);
    render();
    wake();

    return () => {
      cancelAnimationFrame(raf);
      themeWatch.disconnect();
      splashWatch.disconnect();
      media.removeEventListener("change", syncTheme);
      space?.dispose();
      window.removeEventListener("pointermove", onMove);
      grab?.removeEventListener("pointerdown", onDown);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      window.removeEventListener("scroll", onScroll);
      stopGlide();
      root.removeEventListener("click", onLinkClick as EventListener);
      window.removeEventListener("wheel", interrupt);
      window.removeEventListener("touchstart", interrupt);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", render);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  return <canvas ref={canvasRef} className="space" aria-hidden />;
}
