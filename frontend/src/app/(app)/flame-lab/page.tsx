"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Button, Card, PageHeader } from "@/components/ui";
import {
  createFlameEngine,
  hasWebGL2,
  STANDOFF,
  type FlameEngine,
} from "@/components/flame3d/engine";
import {
  byN,
  dAt,
  diluent,
  endOf,
  kPa,
  label,
  momentAt,
  PRE,
  PRESETS,
  TESTS,
  type FlexTest,
} from "@/components/flame3d/timeline";

const COLORS = ["#4f7cff", "#ff8a3d"];
const select =
  "w-full rounded-lg border border-line bg-surface px-2.5 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-accent/40";

export default function FlameLab() {
  const first = PRESETS[0]?.pair ?? [TESTS[0].n, TESTS[1].n];
  const [a, setA] = useState(first[0]);
  const [b, setB] = useState(first[1]);
  const [compare, setCompare] = useState(true);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(1);
  const [earth, setEarth] = useState(false);
  const [soot, setSoot] = useState(true);
  const [cool, setCool] = useState(true);
  const [quality, setQuality] = useState<"high" | "low">("high");
  const [webgl, setWebgl] = useState(true);
  const [fuelFilter, setFuelFilter] = useState<"all" | "Heptane" | "Methanol">("all");

  const tests = useMemo(
    () => [byN.get(a)!, ...(compare ? [byN.get(b)!] : [])],
    [a, b, compare],
  );
  const tEnd = Math.max(...tests.map((x) => endOf(x, cool)));
  const tMaxBurn = Math.max(...tests.map((x) => x.tb));

  const canvases = [useRef<HTMLCanvasElement>(null), useRef<HTMLCanvasElement>(null)];
  const huds = [useRef<HTMLDivElement>(null), useRef<HTMLDivElement>(null)];
  const engines = useRef<(FlameEngine | null)[]>([null, null]);
  const t = useRef(-PRE);
  const g = useRef(0);
  const scrub = useRef<HTMLInputElement>(null);
  const cursor = useRef<SVGLineElement>(null);
  const timeLabel = useRef<HTMLSpanElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const live = useRef({ playing, speed, earth, soot, cool, tests, tEnd });
  const tMaxBurnRef = useRef(tMaxBurn);
  useEffect(() => {
    live.current = { playing, speed, earth, soot, cool, tests, tEnd };
    tMaxBurnRef.current = tMaxBurn;
  });

  // phones and small GPUs start in the lighter mode (after mount: the server cannot know)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      if (window.innerWidth < 700 || (navigator.hardwareConcurrency ?? 8) <= 4) setQuality("low");
      if (!hasWebGL2()) setWebgl(false);
    });
    return () => cancelAnimationFrame(id);
  }, []);

  // one engine per visible viewport; camera moves are mirrored between them
  useEffect(() => {
    if (!webgl) return;
    const made: (FlameEngine | null)[] = [null, null];
    canvases.forEach((ref, i) => {
      if (i === 1 && !compare) return;
      const c = ref.current;
      if (!c) return;
      made[i] = createFlameEngine(c, quality, () => setWebgl(false));
      if (!made[i]) setWebgl(false);
    });
    made[0]?.onView((q, d) => made[1]?.setView(q, d));
    made[1]?.onView((q, d) => made[0]?.setView(q, d));
    engines.current = made;
    const ro = new ResizeObserver(() => made.forEach((e) => e?.resize()));
    canvases.forEach((r) => r.current && ro.observe(r.current));
    return () => {
      ro.disconnect();
      made.forEach((e) => e?.dispose());
      engines.current = [null, null];
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- canvases are stable refs
  }, [compare, quality, webgl]);

  // same physical scale in both views, so sizes can be compared by eye
  useEffect(() => {
    const flameMm = Math.max(...tests.map((x) => STANDOFF[x.fuel] * x.d0)) * (earth ? 1.9 : 1);
    engines.current.forEach((e) => e?.setScale(flameMm));
  }, [tests, earth, compare, quality, webgl]);

  const [ended, setEnded] = useState(false);
  const restart = () => {
    t.current = -PRE;
    setEnded(false);
    setPlaying(true);
  };

  const drawAll = useCallback((dt: number) => {
    const L = live.current;
    g.current += ((L.earth ? 1 : 0) - g.current) * Math.min(1, dt * 3);
    L.tests.forEach((x, i) => {
      const m = momentAt(x, t.current, L.cool);
      engines.current[i]?.frame({ ...m.state, gravity: g.current, soot: L.soot }, dt);
      if (!engines.current[i] && canvases[i].current) draw2D(canvases[i].current!, x, m.state.d, m.state.flame);
      const h = huds[i].current;
      if (h) {
        const time = Math.max(t.current, 0);
        const set = (sel: string, text: string) => {
          const el = h.querySelector(sel);
          if (el) el.textContent = text;
        };
        set("[data-t]", `${time.toFixed(2)} s`);
        set("[data-d]", `${m.state.d.toFixed(2)} mm`);
        set("[data-r]", ((m.state.d / x.d0) ** 2).toFixed(2));
        set("[data-phase]", m.phase);
      }
    });
    if (scrub.current) scrub.current.value = String(t.current);
    if (timeLabel.current) timeLabel.current.textContent = `${Math.max(t.current, 0).toFixed(2)} s`;
    if (cursor.current) {
      const x = 40 + (Math.max(t.current, 0) / (tMaxBurnRef.current + 0.6)) * 540;
      cursor.current.setAttribute("x1", String(x));
      cursor.current.setAttribute("x2", String(x));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- reads live refs only
  }, []);
  // the animation loop: advances time only while playing; pauses when off screen or hidden
  useEffect(() => {
    let raf = 0;
    let last = performance.now();
    let onScreen = true;
    const io = new IntersectionObserver(([e]) => (onScreen = e.isIntersecting));
    if (box.current) io.observe(box.current);
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      const dt = Math.min((now - last) / 1000, 0.1);
      last = now;
      if (!onScreen || document.hidden) return;
      const L = live.current;
      if (L.playing) {
        t.current += dt * L.speed;
        if (t.current >= L.tEnd) {
          t.current = L.tEnd;
          setPlaying(false);
          setEnded(true);
        }
      }
      drawAll(L.playing ? dt * L.speed : dt * 0.25);
    };
    raf = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(raf);
      io.disconnect();
    };
  }, [drawAll]);

  const options = (keep: number) =>
    TESTS.filter((x) => fuelFilter === "all" || x.fuel === fuelFilter || x.n === keep);

  return (
    <div className="space-y-6">
      <PageHeader eyebrow="NASA FLEX · PSI-69 · 3D" title="Flame lab: replay a real FLEX burn">
        Pick any of {TESTS.length} droplet tests flown on the ISS. The droplet shrinks with the
        burning rate NASA measured for that test, the flame goes out at the measured burn
        time, and the test ends the way it really ended. Put two tests side by side to see
        what oxygen, diluents or the fuel change.
      </PageHeader>

      <Card>
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-xs text-muted">Presets:</span>
          {PRESETS.map((p) => (
            <button
              key={p.name}
              type="button"
              title={p.why}
              onClick={() => {
                setCompare(true);
                setA(p.pair![0]);
                setB(p.pair![1]);
                restart();
              }}
              className="rounded-full border border-line bg-surface px-3 py-1 text-xs text-ink-2 hover:border-accent hover:text-ink"
            >
              {p.name}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-[10rem_1fr_1fr]">
          <label className="text-xs text-muted">
            Fuel
            <select
              className={`${select} mt-1`}
              value={fuelFilter}
              onChange={(e) => setFuelFilter(e.target.value as typeof fuelFilter)}
            >
              <option value="all">Both fuels</option>
              <option value="Heptane">Heptane</option>
              <option value="Methanol">Methanol</option>
            </select>
          </label>
          <label className="text-xs text-muted">
            <span style={{ color: COLORS[0] }}>●</span> Test A
            <select className={`${select} mt-1`} value={a} onChange={(e) => { setA(Number(e.target.value)); restart(); }}>
              {options(a).map((x) => (
                <option key={x.n} value={x.n}>{label(x)}</option>
              ))}
            </select>
          </label>
          <label className="text-xs text-muted">
            <span style={{ color: COLORS[1] }}>●</span> Test B{" "}
            <input
              type="checkbox"
              className="ml-1 align-middle accent-[var(--accent)]"
              checked={compare}
              onChange={(e) => { setCompare(e.target.checked); restart(); }}
              aria-label="Compare with a second test"
            />
            <select
              className={`${select} mt-1`}
              value={b}
              disabled={!compare}
              onChange={(e) => { setB(Number(e.target.value)); restart(); }}
            >
              {options(b).map((x) => (
                <option key={x.n} value={x.n}>{label(x)}</option>
              ))}
            </select>
          </label>
        </div>
      </Card>

      <div ref={box} className={`grid gap-4 ${compare ? "md:grid-cols-2" : ""}`}>
        {tests.map((x, i) => (
          <div
            key={`${i}-${compare}`}
            className="relative h-[340px] overflow-hidden rounded-2xl border border-line bg-[#04060c] md:h-[460px]"
            data-lenis-prevent
          >
            <canvas
              ref={canvases[i]}
              className="block touch-none"
              style={{ width: "100%", height: "100%" }}
              aria-label={`3D replay of FLEX test ${x.n} (${x.fuel})`}
            />
            <div ref={huds[i]} className="pointer-events-none absolute inset-0">
            <div className="absolute inset-x-3 top-3 flex flex-wrap items-start justify-between gap-2 text-[11px] text-white/85">
              <div className="rounded-lg bg-black/55 px-2.5 py-1.5 backdrop-blur">
                <div className="font-medium" style={{ color: COLORS[i] }}>
                  {i ? "B" : "A"} · FLEX #{x.n} {x.id}
                </div>
                <div>{x.fuel} · {diluent(x)}</div>
                <div>
                  {kPa(x.p) != null ? `${kPa(x.p)!.toFixed(0)} kPa` : "pressure n/a"} · {x.date}
                </div>
              </div>
              <div className="rounded-lg bg-black/55 px-2.5 py-1.5 text-right tabular-nums backdrop-blur">
                <div>t <b data-t>0.00 s</b></div>
                <div>d <b data-d>{x.d0.toFixed(2)} mm</b></div>
                <div>(d/d₀)² <b data-r>1.00</b></div>
              </div>
            </div>
            <div className="absolute inset-x-3 bottom-3 flex items-end justify-between text-[11px] text-white/80">
              <span data-phase className="rounded bg-black/55 px-2 py-1" />
              <span className="rounded bg-black/55 px-2 py-1">grid = 1 mm · drag to orbit</span>
            </div>
            </div>
          </div>
        ))}
      </div>
      {!webgl && (
        <p className="text-xs text-muted">
          Your browser has no WebGL2, so a flat 2D view is shown. The numbers and the chart are
          the same.
        </p>
      )}

      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <Button onClick={() => (ended ? restart() : setPlaying(!playing))}>
            {playing ? "Pause" : ended ? "Replay" : "Play"}
          </Button>
          <Button variant="ghost" onClick={restart}>
            Restart
          </Button>
          <input
            ref={scrub}
            type="range"
            min={-PRE}
            max={tEnd}
            step={0.01}
            defaultValue={-PRE}
            onChange={(e) => {
              setPlaying(false);
              setEnded(false);
              t.current = Number(e.target.value);
            }}
            aria-label="Time"
            className="min-w-40 flex-1 accent-[var(--accent)]"
          />
          <span ref={timeLabel} className="w-16 text-right text-xs tabular-nums text-ink-2">
            0.00 s
          </span>
          <label className="flex items-center gap-1.5 text-xs text-ink-2">
            Speed
            <select
              className="rounded-md border border-line bg-surface px-1.5 py-1 text-xs"
              value={speed}
              onChange={(e) => setSpeed(Number(e.target.value))}
            >
              {[0.25, 0.5, 1, 2, 4].map((s) => (
                <option key={s} value={s}>{s}×</option>
              ))}
            </select>
          </label>
        </div>
        <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-xs text-ink-2">
          {(
            [
              [earth, setEarth, "Same flame on Earth (illustrative)"],
              [soot, setSoot, "Soot particles"],
              [cool, setCool, "Cool flame after extinction (heptane, illustrative)"],
            ] as const
          ).map(([v, set, text]) => (
            <label key={text} className="flex items-center gap-1.5">
              <input
                type="checkbox"
                checked={v}
                onChange={(e) => set(e.target.checked)}
                className="accent-[var(--accent)]"
              />
              {text}
            </label>
          ))}
          <label className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={quality === "high"}
              onChange={(e) => setQuality(e.target.checked ? "high" : "low")}
              className="accent-[var(--accent)]"
            />
            High quality (glow)
          </label>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1.4fr_1fr]">
        <Card title="Droplet surface over time: (d/d₀)² from the measured burning rate">
          <Chart tests={tests} tMax={tMaxBurn + 0.6} cursor={cursor} />
          <p className="mt-2 text-xs text-muted">
            A straight line is the classic d² law, d² = d₀² − K·t, using each test&apos;s
            measured K. The marker is the measured burn time; the ring is the diameter NASA
            measured when the visible flame went out.
          </p>
        </Card>
        <Card title="Measured in this test">
          <div className="space-y-4 text-sm">
            {tests.map((x, i) => {
              const model = dAt(x, x.tb);
              return (
                <div key={x.n}>
                  <p className="text-xs font-medium" style={{ color: COLORS[i] }}>
                    {i ? "B" : "A"} · FLEX #{x.n}
                  </p>
                  <dl className="mt-1 grid grid-cols-2 gap-x-3 gap-y-0.5 text-xs text-ink-2">
                    <dt>Starting diameter</dt><dd className="tabular-nums text-ink">{x.d0.toFixed(2)} mm</dd>
                    <dt>Burning rate K</dt><dd className="tabular-nums text-ink">{x.k.toFixed(3)} mm²/s</dd>
                    <dt>Burn time</dt><dd className="tabular-nums text-ink">{x.tb.toFixed(2)} s</dd>
                    <dt>Test ended by</dt><dd className="text-ink">{x.end}</dd>
                    <dt>Extinction diameter</dt>
                    <dd className="tabular-nums text-ink">
                      {x.dext != null ? `${x.dext.toFixed(2)} mm measured` : "not measured"}
                    </dd>
                    <dt>d² law at burn time</dt>
                    <dd className="tabular-nums text-ink">
                      {model.toFixed(2)} mm
                      {x.dext != null && x.end === "Extinction" &&
                        ` (${(((model - x.dext) / x.dext) * 100).toFixed(0)}% vs measured)`}
                    </dd>
                  </dl>
                </div>
              );
            })}
          </div>
        </Card>
      </div>

      <Card title="What is NASA data and what is illustration">
        <div className="grid gap-4 text-sm text-ink-2 md:grid-cols-2">
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-accent">From the FLEX table</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Fuel, oxygen, nitrogen, CO₂, helium and pressure of each test</li>
              <li>Starting droplet diameter, drawn to scale on the 1 mm grid</li>
              <li>Shrinking with the measured burning rate K (d² law)</li>
              <li>Flame out at the measured burn time; the test&apos;s real ending (extinction, burned to completion, or droplet disruption)</li>
              <li>Measured extinction diameter, in the chart and table</li>
            </ul>
          </div>
          <div>
            <p className="text-xs font-medium uppercase tracking-wider text-accent">Illustrative (not in the table)</p>
            <ul className="mt-2 list-disc space-y-1 pl-5">
              <li>Flame size relative to the droplet ({STANDOFF.Heptane}× heptane, {STANDOFF.Methanol}× methanol), colour and brightness; brighter with more oxygen</li>
              <li>Soot particles and the yellow soot band (heptane soots, methanol barely)</li>
              <li>The cool flame: FLEX found heptane droplets that kept reacting without a visible flame; the table does not say which tests</li>
              <li>The Earth shape: buoyancy makes a teardrop flame; FLEX ran only in orbit</li>
              <li>Igniter wires and the first 0.25 s of ignition</li>
            </ul>
          </div>
        </div>
      </Card>
    </div>
  );
}

function Chart({
  tests,
  tMax,
  cursor,
}: {
  tests: FlexTest[];
  tMax: number;
  cursor: React.RefObject<SVGLineElement | null>;
}) {
  const X = (t: number) => 40 + (t / tMax) * 540;
  const Y = (v: number) => 190 - v * 170;
  return (
    <svg viewBox="0 0 600 220" className="w-full" role="img" aria-label="(d/d0) squared against time for the selected tests">
      {[0, 0.25, 0.5, 0.75, 1].map((v) => (
        <g key={v}>
          <line x1={40} x2={580} y1={Y(v)} y2={Y(v)} stroke="var(--line)" />
          <text x={34} y={Y(v) + 3} fontSize={10} textAnchor="end" fill="var(--muted)">{v}</text>
        </g>
      ))}
      {Array.from({ length: Math.floor(tMax) + 1 }, (_, s) => (
        <text key={s} x={X(s)} y={206} fontSize={10} textAnchor="middle" fill="var(--muted)">{s}s</text>
      ))}
      {tests.map((x, i) => {
        const pts = Array.from({ length: 41 }, (_, k) => {
          const tt = (x.tb * k) / 40;
          return `${X(tt).toFixed(1)},${Y((dAt(x, tt) / x.d0) ** 2).toFixed(1)}`;
        }).join(" ");
        const end = (dAt(x, x.tb) / x.d0) ** 2;
        return (
          <g key={`${x.n}-${i}`}>
            <polyline points={pts} fill="none" stroke={COLORS[i]} strokeWidth={2.5} />
            <line x1={X(x.tb)} x2={X(x.tb)} y1={Y(end) - 8} y2={Y(end) + 8} stroke={COLORS[i]} strokeWidth={2} />
            {x.dext != null && (
              <circle cx={X(x.tb)} cy={Y((x.dext / x.d0) ** 2)} r={5} fill="none" stroke={COLORS[i]} strokeWidth={2} />
            )}
          </g>
        );
      })}
      <line ref={cursor} x1={40} x2={40} y1={14} y2={190} stroke="var(--ink)" strokeOpacity={0.5} strokeDasharray="3 3" />
    </svg>
  );
}

/** No-WebGL fallback: the same droplet and flame, flat. */
function draw2D(c: HTMLCanvasElement, x: FlexTest, d: number, flame: number) {
  const ctx = c.getContext("2d");
  if (!ctx) return;
  const w = (c.width = c.clientWidth * Math.min(devicePixelRatio, 2));
  const h = (c.height = c.clientHeight * Math.min(devicePixelRatio, 2));
  ctx.fillStyle = "#04060c";
  ctx.fillRect(0, 0, w, h);
  const px = (Math.min(w, h) * 0.42) / ((STANDOFF[x.fuel] * x.d0) / 2);
  const rf = (STANDOFF[x.fuel] * d * px) / 2;
  if (flame > 0 && rf > 1) {
    const grad = ctx.createRadialGradient(w / 2, h / 2, rf * 0.4, w / 2, h / 2, rf * 1.1);
    grad.addColorStop(0, "rgba(0,0,0,0)");
    if (x.fuel === "Heptane") grad.addColorStop(0.55, `rgba(255,140,40,${0.55 * flame})`);
    grad.addColorStop(0.85, `rgba(70,120,255,${0.8 * flame})`);
    grad.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = grad;
    ctx.beginPath();
    ctx.arc(w / 2, h / 2, rf * 1.1, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = "#dfe8ff";
  ctx.beginPath();
  ctx.arc(w / 2, h / 2, Math.max((d * px) / 2, 0), 0, Math.PI * 2);
  ctx.fill();
}
