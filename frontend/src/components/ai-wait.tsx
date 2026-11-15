"use client";

import { useEffect, useState } from "react";
import { Orb } from "./orb";

/** While Gemini works on a one-shot answer: the orb, what is happening, seconds so far and
 * how long it usually takes, so a 15-second wait never looks like a stuck loader. */
export function AiWait({ what = "Gemini is reading the evidence and writing", usual = "10–20 s" }: {
  what?: string;
  usual?: string;
}) {
  const [secs, setSecs] = useState(0);
  useEffect(() => {
    const start = Date.now();
    const t = window.setInterval(() => setSecs(Math.floor((Date.now() - start) / 1000)), 500);
    return () => window.clearInterval(t);
  }, []);
  return (
    <div role="status" aria-live="polite" className="flex items-center gap-3 rounded-xl border border-line bg-surface-2 px-3 py-2.5">
      <Orb mode={secs < 4 ? "searching" : secs < 10 ? "solving" : "composing"} size={28} label={what} />
      <div className="min-w-0 text-sm">
        <p className="think-sheen font-medium">{what}</p>
        <p className="text-xs tabular-nums text-muted">
          {secs} s · usually {usual}{secs > 30 && " · still working, the model is busy"}
        </p>
      </div>
    </div>
  );
}
