"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui";
import { api, fmt } from "@/lib/api";
import type { FootageAnalysis, FootageFrame } from "@/lib/types";

type Heat = "none" | "soot" | "blue";

const OVERLAY = {
  contour: "#ffffff",
  bbox: "#ffd166",
  centroid: "#ff4d6d",
  soot: [235, 104, 52],
  blue: [57, 135, 229],
} as const;

/**
 * Plays the analyzed frames with the measurements drawn on top: flame outline, bounding
 * box, centroid, and a coarse map of where the flame looks sooty (yellow-orange) or blue.
 * Everything drawn comes from the stored analysis; nothing is recomputed in the browser.
 */
export function FlameOverlay({
  sourceId,
  analysis,
}: {
  sourceId: string;
  analysis: FootageAnalysis;
}) {
  const shown = analysis.frames.filter((f) => f.image);
  // open on the largest flame: the most informative frame
  const [i, setI] = useState(() =>
    shown.reduce(
      (best, f, k) =>
        (f.radius_px ?? 0) > (shown[best]?.radius_px ?? 0) ? k : best,
      0,
    ),
  );
  const [playing, setPlaying] = useState(false);
  const [heat, setHeat] = useState<Heat>("soot");
  const [layers, setLayers] = useState({
    contour: true,
    bbox: true,
    centroid: true,
  });
  const canvas = useRef<HTMLCanvasElement>(null);
  const img = useRef<HTMLImageElement>(null);
  const frame: FootageFrame | undefined = shown[Math.min(i, shown.length - 1)];

  useEffect(() => {
    if (!playing || shown.length < 2) return;
    const fps = Math.min(24, Math.max(4, analysis.fps ?? 12));
    const t = window.setInterval(
      () => setI((k) => (k + 1) % shown.length),
      1000 / fps,
    );
    return () => window.clearInterval(t);
  }, [playing, shown.length, analysis.fps]);

  const draw = useCallback(() => {
    const c = canvas.current;
    const im = img.current;
    if (!c || !im || !frame) return;
    const w = im.clientWidth;
    const h = im.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    c.width = Math.round(w * dpr);
    c.height = Math.round(h * dpr);
    c.style.width = `${w}px`;
    c.style.height = `${h}px`;
    const ctx = c.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    if (!frame.present) return;
    const k = w / analysis.frame_size[0]; // original pixels -> displayed pixels

    const grid =
      heat === "soot"
        ? frame.heat_soot
        : heat === "blue"
          ? frame.heat_blue
          : null;
    if (grid?.length) {
      const [r, g, b] = heat === "soot" ? OVERLAY.soot : OVERLAY.blue;
      const ch = h / grid.length;
      const cw = w / grid[0].length;
      grid.forEach((row, y) =>
        row.forEach((v, x) => {
          if (v <= 0) return;
          ctx.fillStyle = `rgba(${r},${g},${b},${(0.15 + 0.55 * v).toFixed(3)})`;
          ctx.fillRect(x * cw, y * ch, cw + 0.5, ch + 0.5);
        }),
      );
    }
    if (layers.contour && frame.contour?.length) {
      ctx.beginPath();
      frame.contour.forEach(([x, y], j) =>
        j ? ctx.lineTo(x * k, y * k) : ctx.moveTo(x * k, y * k),
      );
      ctx.closePath();
      ctx.lineWidth = 2;
      ctx.strokeStyle = OVERLAY.contour;
      ctx.shadowColor = "rgba(0,0,0,0.6)";
      ctx.shadowBlur = 3;
      ctx.stroke();
      ctx.shadowBlur = 0;
    }
    if (layers.bbox && frame.bbox) {
      const [x, y, bw, bh] = frame.bbox;
      ctx.setLineDash([5, 4]);
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = OVERLAY.bbox;
      ctx.strokeRect(x * k, y * k, bw * k, bh * k);
      ctx.setLineDash([]);
    }
    if (layers.centroid && frame.centroid) {
      const [x, y] = frame.centroid.map((v) => v * k);
      ctx.strokeStyle = OVERLAY.centroid;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(x - 8, y);
      ctx.lineTo(x + 8, y);
      ctx.moveTo(x, y - 8);
      ctx.lineTo(x, y + 8);
      ctx.stroke();
    }
  }, [frame, heat, layers, analysis.frame_size]);

  useEffect(() => {
    draw();
    const im = img.current;
    if (!im) return;
    const ro = new ResizeObserver(draw);
    ro.observe(im);
    return () => ro.disconnect();
  }, [draw]);

  if (!frame)
    return <p className="text-sm text-muted">No frames were saved.</p>;
  const unit = analysis.summary.length_unit;
  const k = analysis.mm_per_px ?? 1;

  return (
    <div>
      <div className="flex justify-center overflow-hidden rounded-lg bg-black">
        <div className="relative">
          {/* eslint-disable-next-line @next/next/no-img-element -- frames come from the API */}
          <img
            ref={img}
            src={api.mediaFrameUrl(sourceId, frame.image as string)}
            alt={`Frame ${frame.index}${frame.time_s != null ? ` at ${fmt(frame.time_s, 3)} s` : ""}`}
            onLoad={draw}
            className="block h-auto max-h-[28rem] w-auto max-w-full"
          />
          <canvas
            ref={canvas}
            className="pointer-events-none absolute left-0 top-0"
          />
          <div className="absolute left-2 top-2 rounded-md bg-black/60 px-2 py-1 text-xs tabular-nums text-white">
            frame {frame.index}
            {frame.time_s != null && ` · ${fmt(frame.time_s, 3)} s`}
            {frame.present
              ? ` · R ${fmt((frame.radius_px ?? 0) * k, 3)} ${unit} · Ψ ${fmt(frame.circularity, 3)}`
              : " · no flame"}
          </div>
        </div>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-3">
        <Button
          variant="ghost"
          onClick={() => setPlaying((p) => !p)}
          disabled={shown.length < 2}
        >
          {playing ? "Pause" : "Play"}
        </Button>
        <input
          type="range"
          min={0}
          max={shown.length - 1}
          value={Math.min(i, shown.length - 1)}
          onChange={(e) => {
            setPlaying(false);
            setI(Number(e.target.value));
          }}
          aria-label="Frame"
          className="min-w-40 flex-1 accent-[var(--accent)]"
        />
        <span className="text-xs tabular-nums text-muted">
          {Math.min(i, shown.length - 1) + 1} / {shown.length}
        </span>
      </div>

      <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-xs text-ink-2">
        <span className="text-muted">Heat map:</span>
        {(["soot", "blue", "none"] as const).map((h) => (
          <label key={h} className="flex items-center gap-1.5">
            <input
              type="radio"
              name="heat"
              checked={heat === h}
              onChange={() => setHeat(h)}
            />
            {h === "soot"
              ? "Soot-like (yellow-orange)"
              : h === "blue"
                ? "Blue"
                : "Off"}
          </label>
        ))}
        <span className="text-muted">Layers:</span>
        {(
          [
            ["contour", "Outline", OVERLAY.contour],
            ["bbox", "Bounding box", OVERLAY.bbox],
            ["centroid", "Centroid", OVERLAY.centroid],
          ] as const
        ).map(([key, text, color]) => (
          <label key={key} className="flex items-center gap-1.5">
            <input
              type="checkbox"
              checked={layers[key]}
              onChange={() => setLayers({ ...layers, [key]: !layers[key] })}
            />
            <span
              className="inline-block h-0.5 w-4"
              style={{ background: color, outline: "1px solid var(--line)" }}
            />
            {text}
          </label>
        ))}
      </div>
    </div>
  );
}
