"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { Orb, type Stage } from "@/components/orb";
import review from "@/lib/bass-review.json";
import smoke from "@/lib/flight/smoke.json";

/* The landing's Ask FlamexSI section: what it is, how it works, its tools, and a looping
 * replay of real answers (numbers from the shipped result files, answers abridged). */

const TOOLS = [
  ["Correlation + confounding check", "Spearman ρ, bootstrap interval, a variable held fixed"],
  ["Group comparison", "medians and a significance test"],
  ["Regression model", "standardised effects, intervals, R²"],
  ["Distributions", "mean, median, spread, histogram"],
  ["Scatter charts", "any two FLEX variables, by fuel"],
  ["3D flame replays", "real FLEX burns, side by side"],
  ["Extinction map", "where flames go out, by oxygen"],
  ["Smoke detector", "signal by burning material"],
  ["Cabin fire timeline", "Saffire-III on Cygnus"],
  ["Test finder", "FLEX tests matching your conditions"],
  ["Vision scores", "OpenCV vs people on BASS-II video"],
];

const kapton = smoke.materials.find((m) => m.material === "Kapton")!;
const silicone = smoke.materials.find((m) => m.material === "Silicone")!;
const cv = review.summary.find((r) => r.model === "OpenCV" && r.reference === "A")!;
const v6 = review.summary.find((r) => r.model === "v6" && r.reference === "A")!;

const DEMOS = [
  {
    q: "Why does the ISS smoke detector read Kapton smoke weakly?",
    tool: "Running: Bar chart: ISS smoke detector signal per material",
    card: "Reading: SAME and SAME-R smoke results",
    bars: smoke.materials.map((m) => ({ label: m.material, value: m.detector_median_v })),
    max: 6.5,
    unit: "detector signal, V (median)",
    answer: `Kapton smoke has the smallest particles, ${kapton.fresh_diameter_um} µm fresh [S1]. The light-scattering detector reads it at a median ${kapton.detector_median_v} V, against ${silicone.detector_median_v} V for silicone [S2]. Signal goes with particle size at the same smoke mass in both flights [S2] (an association, not a proven cause).`,
  },
  {
    q: "How well does OpenCV find the flame compared with people?",
    tool: "Running: Bar chart: flame-finding scores on BASS-II video",
    card: "Reading: BASS-II computer vision results",
    bars: [
      { label: "OpenCV vs A", value: cv.iou },
      { label: "Human A vs B", value: 0.257 },
      { label: "Learned v6 vs A", value: v6.iou },
    ],
    max: 0.6,
    unit: "pixel overlap (IoU)",
    answer: `OpenCV, with no training, overlaps reviewer A's flame pixels by ${(cv.iou * 100).toFixed(0)}% [S1], more than the two people overlap each other (26%) [S1]. The earlier learned model reached ${(v6.iou * 100).toFixed(0)}% [S1]. Only 24 frames from 3 videos were scored [S2].`,
  },
];

type Phase = { stage: Stage; text: string };
const STEPS = (d: (typeof DEMOS)[number]): Phase[] => [
  { stage: "think", text: "Understanding the question" },
  { stage: "plan", text: "Choosing tools: charts, tables, replays" },
  { stage: "tool", text: d.tool },
  { stage: "read", text: d.card },
  { stage: "analyse", text: "Checking the numbers" },
  { stage: "compose", text: "Writing the answer" },
];

export function AskShowcase() {
  const [demo, setDemo] = useState(0);
  const [tick, setTick] = useState(0);
  useEffect(() => {
    if (window.matchMedia?.("(prefers-reduced-motion: reduce)").matches) {
      const id = requestAnimationFrame(() => setTick(60));
      return () => cancelAnimationFrame(id);
    }
    const t = window.setInterval(() => {
      setTick((n) => {
        if (n >= 100) {
          setDemo((k) => (k + 1) % DEMOS.length);
          return 0;
        }
        return n + 1;
      });
    }, 160);
    return () => window.clearInterval(t);
  }, []);
  const d = DEMOS[demo];
  const steps = STEPS(d);
  const qShown = d.q.slice(0, Math.min(d.q.length, tick * 4));
  const stepIdx = Math.min(steps.length - 1, Math.max(0, Math.floor((tick - 12) / 4)));
  const thinking = tick >= 12 && tick < 36;
  const showBars = tick >= 22;
  const words = d.answer.split(" ");
  const shown = Math.max(0, Math.min(words.length, (tick - 36) * 2));
  const stage: Stage = tick < 12 ? "idle" : thinking ? steps[stepIdx].stage : "compose";

  return (
    <section className="wrap block" id="ask">
      <div className="ask">
        <div>
          <div className="eyebrow">Ask FlamexSI</div>
          <h2 className="serif" data-reveal>Ask the flight data anything.</h2>
          <p className="sub" data-reveal>
            A research assistant that has read every FlamexSI result from NASA&apos;s flight
            experiments: FLEX, FLEX-2, SAME, Saffire-III, BASS-II and 22 investigations. Ask in
            plain words and it answers from that data only, with every number linked to its
            source.
          </p>
          <ol className="ask-how" data-reveal>
            <li><b>It shows its work.</b> The orb changes shape with each real step: understanding, choosing tools, reading the data, writing.</li>
            <li><b>It analyses like a data scientist.</b> Ask &ldquo;does X affect Y?&rdquo; and it runs the statistics on the real data: correlations with a confounder held fixed, group tests, regression models.</li>
            <li><b>It draws.</b> Every analysis comes back as a chart, table or 3D replay next to the answer.</li>
            <li><b>It cites.</b> Every number points to a source card [S1]; if the data cannot answer, it says what is missing.</li>
          </ol>
          <div className="ask-tools" data-reveal>
            {TOOLS.map(([t, s]) => (
              <span key={t} className="ask-tool" title={s}><i aria-hidden />{t}</span>
            ))}
          </div>
          <div className="cta" data-reveal>
            <Link className="btn primary" href="/assistant">Ask FlamexSI →</Link>
            <Link className="btn ghost" href={`/assistant?q=${encodeURIComponent(DEMOS[0].q)}`}>Try this question</Link>
          </div>
        </div>

        <div className="card ask-demo" data-reveal aria-label="Replay of a real Ask FlamexSI answer">
          <div className="ask-demo-head">
            <Orb stage={stage} size={46} label="Ask FlamexSI" />
            <div>
              <b className="serif">Ask FlamexSI</b>
              <span>replay of a real answer, abridged</span>
            </div>
          </div>
          <div className="ask-q">{qShown}<span className="caret" /></div>
          {tick >= 12 && (
            <div className="ask-stage" role="status">
              <Orb stage={stage} size={20} label={steps[stepIdx].text} />
              <span key={thinking ? stepIdx : "w"} className="think-sheen">
                {thinking ? steps[stepIdx].text : "Writing the answer"}
              </span>
            </div>
          )}
          {showBars && (
            <div className="ask-chart">
              {d.bars.map((b, i) => (
                <div key={`${demo}-${b.label}`} className="ask-bar">
                  <span>{b.label}</span>
                  <div><i className="bar-grow" style={{ width: `${(b.value / d.max) * 100}%`, animationDelay: `${i * 90}ms` }} /></div>
                  <em>{b.value.toFixed(2)}</em>
                </div>
              ))}
              <small>{d.unit} · drawn from NASA data by a tool</small>
            </div>
          )}
          {shown > 0 && (
            <p className="ask-a">
              {words.slice(0, shown).map((w, i) => {
                const m = w.match(/^\[S(\d)\]([.,)]?)$/);
                return m ? <span key={i}><sup className="ask-cite">S{m[1]}</sup>{m[2]} </span> : <span key={i}>{w} </span>;
              })}
            </p>
          )}
        </div>
      </div>
    </section>
  );
}
