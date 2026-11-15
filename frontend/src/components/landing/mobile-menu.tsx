"use client";

import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { ThemeToggle } from "@/components/theme-toggle";

/* The landing menu below 1280px (the section links move here): a burger with a flame orbiting it, opening into a
 * full-screen "mission panel" that grows as a circle from the button. Links fly in one by
 * one, each on its own little orbit; Escape, the backdrop or any link closes it. */

const LINKS: [string, string, string][] = [
  ["#pillars", "Fire safety", "Prevention · detection · suppression"],
  ["#ask", "Ask FlamexSI", "The research assistant that draws and cites"],
  ["#trust", "Why trust it", "Every finding tested on data it never saw"],
  ["#freefall", "Fire in freefall", "Why flames turn into spheres in orbit"],
  ["#team", "Team", "The crew behind FlamexSI"],
];
const WORLDS: [string, string][] = [["Earth", "1.00 g"], ["Orbit", "0 g"], ["Moon", "0.17 g"], ["Mars", "0.38 g"]];

export function MobileMenu() {
  const [open, setOpen] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const [host, setHost] = useState<HTMLElement | null>(null);

  // the panel lives at the landing root, outside the header: a blurred header would
  // otherwise trap a fixed panel inside its own box
  useEffect(() => {
    const id = requestAnimationFrame(() =>
      setHost(button.current?.closest<HTMLElement>(".landing") ?? document.body));
    return () => cancelAnimationFrame(id);
  }, []);

  const close = useCallback((refocus = true) => {
    setOpen(false);
    if (refocus) button.current?.focus();
  }, []);

  // the circle grows from the burger: tell the CSS where it is
  const toggle = () => {
    const r = button.current?.getBoundingClientRect();
    if (r && panel.current) {
      panel.current.style.setProperty("--ox", `${r.left + r.width / 2}px`);
      panel.current.style.setProperty("--oy", `${r.top + r.height / 2}px`);
    }
    setOpen((o) => !o);
  };

  useEffect(() => {
    if (!open) return;
    const root = document.documentElement;
    root.classList.add("menu-open"); // stops the page (and smooth scroll) behind the panel
    const first = panel.current?.querySelector<HTMLElement>("a, button");
    const id = window.setTimeout(() => first?.focus(), 120);
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
      if (e.key === "Tab" && panel.current) { // keep focus inside the open panel
        const items = [...panel.current.querySelectorAll<HTMLElement>("a, button")];
        const i = items.indexOf(document.activeElement as HTMLElement);
        if (e.shiftKey && i <= 0) { e.preventDefault(); items[items.length - 1]?.focus(); }
        else if (!e.shiftKey && i === items.length - 1) { e.preventDefault(); button.current?.focus(); }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.clearTimeout(id);
      root.classList.remove("menu-open");
      window.removeEventListener("keydown", key);
    };
  }, [open, close]);

  // a phone turned to landscape or a resized window must not keep a hidden menu open
  useEffect(() => {
    const mq = window.matchMedia("(min-width: 1280px)"); // the burger hides from here
    const on = () => mq.matches && setOpen(false);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  return (
    <>
      <button
        ref={button}
        type="button"
        className={`burger${open ? " is-open" : ""}`}
        aria-label={open ? "Close the menu" : "Open the menu"}
        aria-expanded={open}
        aria-controls="msheet-panel"
        onClick={toggle}
      >
        <span className="burger-orbit" aria-hidden><i /></span>
        <span className="burger-lines" aria-hidden><b /><b /></span>
      </button>

      {host && createPortal(
      <div
        ref={panel}
        id="msheet-panel"
        className={`msheet${open ? " is-open" : ""}`}
        role="dialog"
        aria-modal="true"
        aria-label="Menu"
        aria-hidden={!open}
        data-lenis-prevent
        onClick={(e) => { if (e.target === e.currentTarget) close(); }}
      >
        <div className="msheet-stars" aria-hidden />
        <div className="msheet-inner">
          <p className="msheet-eyebrow">Mission menu</p>
          <ol className="msheet-links">
            {LINKS.map(([href, label, sub], i) => (
              <li key={href} style={{ ["--i" as string]: i }}>
                <a href={href} tabIndex={open ? 0 : -1} onClick={() => close(false)}>
                  <span className="msheet-dot" aria-hidden><i /></span>
                  <span>
                    <b className="serif">{label}</b>
                    <small>{sub}</small>
                  </span>
                  <em aria-hidden>0{i + 1}</em>
                </a>
              </li>
            ))}
          </ol>
          <div className="msheet-worlds" style={{ ["--i" as string]: LINKS.length }}>
            {WORLDS.map(([w, g]) => (
              <span key={w}><b>{w}</b>{g}</span>
            ))}
          </div>
          <div className="msheet-actions" style={{ ["--i" as string]: LINKS.length + 1 }}>
            <Link className="btn primary" href="/assistant" tabIndex={open ? 0 : -1}>Ask FlamexSI →</Link>
            <Link className="btn ghost" href="/overview" tabIndex={open ? 0 : -1}>Open the app</Link>
            <span className="msheet-theme"><ThemeToggle /></span>
          </div>
        </div>
      </div>, host)}
    </>
  );
}
