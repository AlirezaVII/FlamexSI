"use client";

import Lenis from "lenis";
import { useEffect, useRef } from "react";
import { along, DESKTOP_PATH, MOBILE_PATH, PLANETS, STAGES } from "./planets";
import { create2DSpace } from "./planets2d";
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
    const onReady = () => {
      ready = true;
      canvas?.classList.add("ready");
      maybeIntro();
    };
    // real 3D when the browser has WebGL2; otherwise the 2D projection, so a planet always shows
    // (createSpace probes WebGL2 on a scratch canvas, so this canvas is still free for 2D)
    const space = createSpace(canvas, () => render(), onReady) ?? create2DSpace(canvas, onReady);
    // the entrance waits for the loading screen to lift
    function maybeIntro() {
      if (!ready || introStart) return;
      const splash = document.documentElement.dataset.splash;
      if (splash && splash !== "gone" && splash !== "leaving") return;
      introStart = performance.now();
      root!.classList.add("planets-live"); // crossfade: still image out, live globe in
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
    const mission = $<SVGSVGElement>(".mission");
    const route = $<SVGPathElement>("[data-route]");
    const routeBg = $<SVGPathElement>("[data-route-bg]");
    const craft = $<SVGGElement>("[data-craft]");
    const gtag = $<HTMLElement>("[data-gtag]");
    const gflame = $<SVGPathElement>("[data-gflame]");
    const gname = $<HTMLElement>("[data-gname]");
    const gval2 = $<HTMLElement>("[data-gtag] [data-gval]");
    let gShown = 1;
    let gTarget = 1;
    let warp = 0;
    let lastY = window.scrollY;

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

      // trust card: the bars fill as it enters. The numbers next to the bars are always the
      // final, computed values — only the bar widths animate (each bar carries data-w, in %).
      const card = root!.querySelector<HTMLElement>("[data-trust-card]");
      if (card) {
        const cr = card.getBoundingClientRect();
        const fill = reduce
          ? 1
          : easeOut(clamp((H - cr.top - 120) / (H * 0.3)));
        card.querySelectorAll<HTMLElement>("[data-w]").forEach((el) => {
          el.style.width = `${parseFloat(el.dataset.w ?? "0") * fill}%`;
        });
      }

      // planets (real 3D spheres in WebGL)
      const now = performance.now();
      // entrance: Earth rushes in from far away while spinning down (expo ease-out)
      const t = introStart ? clamp((now - introStart) / 2600) : 0;
      const intro = reduce ? 1 : t === 1 ? 1 : 1 - Math.pow(2, -10 * t);
      const poses = {} as Record<Key, PlanetPose>;
      // at the top of the page Earth sits in the hero's own globe box (it scrolls with the
      // hero), then hands over to the journey path
      const box = grab?.getBoundingClientRect();
      for (const k of Object.keys(paths) as Key[]) {
        let path = paths[k];
        if (k === "earth" && box && box.width > 0) {
          const rBox = (Math.min(box.width, box.height) / 2) * 0.96;
          path = [
            [0, (box.left + box.width / 2) / W, (box.top + box.height / 2) / H, rBox / scale, 0],
            ...path.slice(1),
          ];
        }
        const [, xv, yv, rv, spin] = along(path, p);
        const r = rv * scale;
        const x = xv * W;
        const yy = yv * H;
        let extra = 0;
        if (k === "earth") {
          earthR = r;
          // the still image is already in place, so the live globe simply takes over
          extra = yaw + hover + spinBoost;
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

      // ---- the mission: Earth -> Moon -> Mars, drawn as you travel ----
      const E = poses.earth;
      const M = poses.moon;
      const R = poses.mars;
      if (route && routeBg && craft) {
        // leave each world from its limb, arc between them like a transfer orbit
        const d =
          `M ${E.x} ${E.y} ` +
          `Q ${(E.x + M.x) / 2 + W * 0.18} ${Math.min(E.y, M.y) - H * 0.25} ${M.x} ${M.y} ` +
          `Q ${(M.x + R.x) / 2 - W * 0.22} ${(M.y + R.y) / 2 + H * 0.05} ${R.x} ${R.y}`;
        route.setAttribute("d", d);
        routeBg.setAttribute("d", d);
        const prog = reduce ? 1 : clamp((p - 0.08) / 0.74);
        route.style.strokeDasharray = `${prog} 1`;
        const len = route.getTotalLength();
        const at = route.getPointAtLength(len * prog);
        const ahead = route.getPointAtLength(Math.min(len, len * prog + 2));
        const ang = (Math.atan2(ahead.y - at.y, ahead.x - at.x) * 180) / Math.PI;
        const show = prog > 0.01 && prog < 0.995 ? 1 : 0;
        craft.setAttribute("transform", `translate(${at.x} ${at.y}) rotate(${ang})`);
        craft.style.opacity = String(show);
        mission?.classList.toggle("on", intro > 0.95);
      }

      // ---- gravity tag on the world you are visiting: its flame shape follows its g ----
      if (gtag && gflame) {
        const focus: Key = stage[1] === 3 ? "mars" : stage[1] === 2 ? "moon" : "earth";
        const f = poses[focus];
        const gv = parseFloat(stage[2]);
        gTarget = gv;
        gShown += (gTarget - gShown) * (reduce ? 1 : 0.08);
        const sg = Math.sqrt(Math.max(0, gShown));
        const top = -(9 + 27 * sg);
        const w = 9.5 - 2.5 * sg;
        gflame.setAttribute(
          "d",
          `M 0 ${top} C ${w * 1.2} ${-6 * sg - 4} ${w} 9 0 9 C ${-w} 9 ${-w * 1.2} ${-6 * sg - 4} 0 ${top} Z`,
        );
        gtag.style.setProperty("--gf-core", sg > 0.35 ? "#ffc24a" : "#9fc0ff");
        gtag.style.setProperty("--gf-edge", sg > 0.35 ? "#ff6a1f" : "#3b6bff");
        const name =
          stage[1] === 1 ? "Low Earth orbit" : focus === "earth" ? "Earth" : focus === "moon" ? "Moon" : "Mars";
        if (gname && gname.textContent !== name) gname.textContent = name;
        const shape = gv === 0 ? "spherical flame" : gv < 0.3 ? "rounder, slower flame" : gv < 0.6 ? "shorter flame" : "teardrop flame";
        const label = `${stage[2]} g · ${shape}`;
        if (gval2 && gval2.textContent !== label) gval2.textContent = label;
        const tx = f.x + f.r * 0.62;
        const ty = f.y - f.r * 0.78;
        const onScreen = tx > 0 && tx < W - 40 && ty > 70 && ty < H - 40 && intro > 0.95;
        gtag.style.transform = `translate3d(${Math.min(tx, W - 230)}px, ${ty}px, 0)`;
        gtag.classList.toggle("on", onScreen);
      }

      // ---- warp: fast scrolling stretches the stars into streaks ----
      const v = clamp(Math.abs(y - lastY) / 60, 0, 1);
      lastY = y;
      warp += (v - warp) * 0.2;
      layers.forEach((l, i) => {
        const shift = y * parseFloat(l.dataset.speed ?? "0");
        // stretch around the middle of the screen so stars streak in place
        l.style.transformOrigin = `50% ${shift + H / 2}px`;
        l.style.transform = `translate3d(0,${-shift}px,0) scaleY(${1 + warp * (2 + i * 2.5)})`;
      });
    }

    // ---- animation loop: planets turn and clouds drift while the tab is visible -----------
    let raf = 0;
    let running = false;
    function tick(time: number) {
      lenis?.raf(time);
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

    // ---- smooth scrolling (wheel / trackpad); touch keeps the native feel ----------------
    const lenis = reduce
      ? null
      : new Lenis({ lerp: 0.085, smoothWheel: true, wheelMultiplier: 0.9 });
    function glideTo(targetY: number) {
      if (lenis) {
        const dist = Math.abs(targetY - window.scrollY);
        lenis.scrollTo(targetY, { duration: clamp(0.7 + dist / 2600, 0.8, 1.9) });
      } else window.scrollTo(0, targetY);
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
    root.addEventListener("click", onLinkClick as EventListener);
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
      lenis?.destroy();
      root.removeEventListener("click", onLinkClick as EventListener);
      window.removeEventListener("resize", render);
      document.removeEventListener("visibilitychange", wake);
    };
  }, []);

  return <canvas ref={canvasRef} className="space" aria-hidden />;
}
