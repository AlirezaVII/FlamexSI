"use client";

import Image from "next/image";
import { useState } from "react";
import { Card, PageHeader } from "@/components/ui";
import evidence from "@/lib/bass-review.json";

const labels = { Source: "Original frame", AB: "Reviewers A and B", Initial: "Initial reference", A: "Reviewer A", B: "Reviewer B" };
const selectStyle = "mt-1 block rounded border border-line bg-surface px-3 py-2 text-ink";

export default function BassReview() {
  const [frame, setFrame] = useState(evidence.frames[0]);
  const [view, setView] = useState("Source");
  const [model, setModel] = useState("v6");
  return (
    <div className="space-y-5">
      <PageHeader eyebrow="NASA BASS-II · PSI-25" title="Where does the flame appear?">
        Inspect 24 reserved frames from three videos. Reviewers agreed on flame visibility in seven frames and disagreed in seventeen. Both human references are retained. Reviewer B marked a larger area in every frame.
      </PageHeader>
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
          {["v3", "v4", "v5", "v6"].map(v => <option key={v}>{v}</option>)}
        </select></label>
        <div className="mt-4 overflow-x-auto"><table className="w-full text-left text-sm tabular-nums">
          <thead><tr>{["Reference", "True positives", "False positives", "Missed pixels", "Micro IoU"].map(h => <th className="p-2" key={h}>{h}</th>)}</tr></thead>
          <tbody>{evidence.summary.filter(r => r.model === model).map(r => <tr key={r.reference} className="border-t border-line">
            <th className="p-2">{labels[r.reference as keyof typeof labels]}</th>
            {[r.tp.toLocaleString("en-US"), r.fp.toLocaleString("en-US"), r.fn.toLocaleString("en-US"), r.iou?.toFixed(4)].map((value, i) => <td className="p-2" key={i}>{value}</td>)}
          </tr>)}</tbody>
        </table></div>
        <p className="mt-4 text-sm">Micro IoU pools the intersecting and combined flame pixels across frames. Each row uses a separate reference. The initial masks were drawn with AI assistance. In the example reviewed by the team, B includes more of the halo and detached bright spots. The areas measure visible emission; individual spots have no confirmed spark labels.</p>
      </Card>
    </div>
  );
}
