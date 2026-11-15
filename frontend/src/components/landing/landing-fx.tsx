"use client";

import { useEffect, useRef } from "react";
import {
  along,
  DESKTOP_PATH,
  makePlanet,
  MOBILE_PATH,
  type Planet,
  PLANETS,
  STAGES,
} from "./planets";

type Key = keyof typeof PLANETS;
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
    const g = canvas.getContext("2d")!;
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

    // ---- planets --------------------------------------------------------------------
    const planets: Partial<
      Record<Key, { img: HTMLImageElement; lo: Planet; hi: Planet | null }>
    > = {};
    let disposed = false;
    for (const key of Object.keys(PLANETS) as Key[]) {
      const img = new Image();
      img.decoding = "async";
      img.onload = () => {
        if (disposed) return;
        planets[key] = {
          img,
          lo: makePlanet(img, PLANETS[key], 560),
          hi: null,
        };
        render();
        // Mars is drawn very large near the end: build its sharp version in an idle moment
        // now, so scrolling or a glide never stalls on it
        if (key === "mars") {
          const idle =
            window.requestIdleCallback ??
            ((cb: () => void) => window.setTimeout(cb, 400));
          idle(() => {
            const pk = planets.mars;
            if (!disposed && pk && !pk.hi)
              pk.hi = makePlanet(img, PLANETS.mars, 1200);
          });
        }
      };
      img.src = PLANETS[key].src;
    }

    // ---- Earth rotation from the cursor ------------------------------------------------
    let yaw = 0; // turns added by dragging / idle spin
    let vel = 0; // turns per frame (inertia)
    let hover = 0; // gentle follow of the cursor (turns)
    let hoverTarget = 0;
    let dragging = false;
    let lastX = 0;
    let lastT = 0;

    const onMove = (e: PointerEvent) => {
      hoverTarget = (e.clientX / window.innerWidth - 0.5) * 0.07;
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
    function render() {
      const W = window.innerWidth;
      const H = window.innerHeight;
      if (canvas!.width !== W || canvas!.height !== H) {
        canvas!.width = W;
        canvas!.height = H;
      }
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

      // planets, farthest (smallest) first
      g.clearRect(0, 0, W, H);
      const order = (Object.keys(paths) as Key[])
        .map((k) => [k, along(paths[k], p)] as const)
        .sort((a, b) => a[1][3] - b[1][3]);
      for (const [k, [, xv, yv, rv, spin]] of order) {
        const pk = planets[k];
        const r = rv * scale;
        if (k === "earth") earthR = r;
        if (!pk) continue;
        const x = xv * W;
        const yy = yv * H;
        if (yy - r > H + 40 || yy + r < -40 || x - r > W + 40 || x + r < -40)
          continue;
        let pl = pk.lo;
        if (r > 330) {
          pk.hi ??= makePlanet(pk.img, PLANETS[k], 1200);
          pl = pk.hi;
        }
        const atmo = PLANETS[k].atmo;
        if (atmo) {
          const gr = g.createRadialGradient(x, yy, r * 0.92, x, yy, r * 1.16);
          gr.addColorStop(0, `${atmo}cc`);
          gr.addColorStop(0.35, `${atmo}55`);
          gr.addColorStop(1, `${atmo}00`);
          g.fillStyle = gr;
          g.beginPath();
          g.arc(x, yy, r * 1.16, 0, Math.PI * 2);
          g.fill();
        }
        const extra = k === "earth" ? yaw + hover : 0;
        pl.draw(spin + PLANETS[k].spin0 + extra);
        g.drawImage(pl.canvas, x - r, yy - r, 2 * r, 2 * r);
      }
    }

    // ---- animation loop: only while the hero Earth is on screen and moving -------------
    let raf = 0;
    let running = false;
    function tick() {
      const heroVisible = window.scrollY < window.innerHeight * 1.1;
      if (!dragging) {
        yaw += vel;
        vel *= 0.9;
        if (!reduce) yaw += 0.00045; // slow idle rotation
      }
      hover += (hoverTarget - hover) * 0.06;
      render();
      if (heroVisible && !document.hidden) {
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
      if (window.scrollY < window.innerHeight * 1.1) wake();
      else render();
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
      disposed = true;
      cancelAnimationFrame(raf);
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
