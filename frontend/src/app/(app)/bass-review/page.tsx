"use client";

import Image from "next/image";
import Link from "next/link";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import evidence from "@/lib/bass-review.json";

const labels = {
  Source: "Original frame",
  AB: "Reviewers A and B",
  CVA: "OpenCV vs reviewer A",
  CVB: "OpenCV vs reviewer B",
  CVInitial: "OpenCV vs initial reference",
  A: "Model v6 vs reviewer A",
  B: "Model v6 vs reviewer B",
  Initial: "Model v6 vs initial reference",
};
const refLabels = { A: "Reviewer A", B: "Reviewer B", Initial: "Initial reference" };
const selectStyle = "mt-1 block rounded border border-line bg-surface px-3 py-2 text-ink";

export default function BassReview() {
  const [frame, setFrame] = useState(evidence.frames[0]);
  const [view, setView] = useState("Source");
  const [model, setModel] = useState("OpenCV");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="NASA BASS-II · PSI-25" title="Where does the flame appear?">
        Inspect 24 reserved frames from three videos. Reviewers agreed on flame visibility in seven frames and disagreed in seventeen; even the two people overlap only 26% (pixel IoU). A plain OpenCV method, with no training, overlaps reviewer A by 53% and reviewer B by 38%, against 3% for the earlier learned model (v6, kept below for comparison).
      </PageHeader>
      <Link href="/footage" className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-accent/30 bg-accent/5 px-4 py-3 transition hover:border-accent">
        <span className="text-sm text-ink-2">
          <b className="text-ink">Try it on your own footage.</b> Upload a flame video or image: the same
          OpenCV method finds the flame in every frame and measures its size, growth, shape and colour,
          and you can compare it with the other methods.
        </span>
        <span className="rounded-full bg-accent px-3 py-1.5 text-xs font-medium text-white">Open Footage →</span>
      </Link>
      <Card title="Frame and mask comparison">
        <div className="mb-4 flex flex-wrap gap-4">
          <label>Frame<select className={selectStyle} value={frame} onChange={e => setFrame(e.target.value)}>
            {evidence.frames.map(f => <option key={f}>{f}</option>)}
          </select></label>
          <label>Image layer<select className={selectStyle} value={view} onChange={e => setView(e.target.value)}>
            {Object.entries(labels).map(([key, label]) => <option key={key} value={key}>{label}</option>)}
          </select></label>
        </div>
        <div className="relative max-w-[720px]">
        <Image unoptimized width={720} height={480} className="h-auto w-full max-w-[720px] rounded"
          src={`/bass-review/${frame}-${view === "AB" ? "Source" : view}.webp`} alt={`${frame} — ${labels[view as keyof typeof labels]}`} />
        {view === "AB" && <Image unoptimized width={720} height={480} className="absolute inset-0 h-auto w-full" src={`/bass-review/${frame}-AB.png`} alt="Human annotation overlay" />}
        </div>
        {view === "AB" && <p className="mt-3 text-sm">Green · both reviewers　 Blue · A only　 Red · B only</p>}
        {view !== "Source" && view !== "AB" && <p className="mt-3 text-sm">Green · overlap　 Orange · prediction only　 Blue · reference only</p>}
      </Card>
      <Card title="Pixel overlap across all 24 frames">
        <label>Model<select className={selectStyle} value={model} onChange={e => setModel(e.target.value)}>
          {["OpenCV", "v3", "v4", "v5", "v6"].map(v => <option key={v} value={v}>{v === "OpenCV" ? "OpenCV (no training)" : `Learned model ${v}`}</option>)}
        </select></label>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm tabular-nums">
          <thead><tr>{["Reference", "True positives", "False positives", "Missed pixels", "Micro IoU"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
          <tbody>{evidence.summary.filter(r => r.model === model).map(r => <tr key={r.reference} className="border-t border-line">
            <th className="p-2">{refLabels[r.reference as keyof typeof refLabels]}</th>
            {[r.tp.toLocaleString("en-US"), r.fp.toLocaleString("en-US"), r.fn.toLocaleString("en-US"), r.iou?.toFixed(4)].map((value, i) => <td className="p-2" key={i}>{value}</td>)}
          </tr>)}</tbody>
        </table></div>
        {model === "OpenCV" && <p className="mt-4 text-sm">How OpenCV works: each video&apos;s background is the per-pixel median of its own frames, so handrails, screens and LEDs cancel out. Bright, changed, warm pixels seed the flame and connected dimmer pixels that also changed are added. The settings for each video were chosen on the other two videos only, so every score is on a video the method was not tuned on. Per video vs A: {Object.entries(evidence.opencv.A.per_video).map(([k, v]) => `${k} ${(v as number).toFixed(2)}`).join(" · ")}.</p>}
        <p className="mt-4 text-sm">Micro IoU pools the intersecting and combined flame pixels across frames. Each row uses a separate reference. The initial masks were drawn with AI assistance. In the example reviewed by the team, B includes more of the halo and detached bright spots. The areas measure visible emission; individual spots have no confirmed spark labels.</p>
      </Card>
    </div>
  );
}
