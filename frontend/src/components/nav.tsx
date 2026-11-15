"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/lib/workspace";

const LINKS = [
  { href: "/explorer", label: "Explore" },
  { href: "/compare", label: "Compare" },
  { href: "/relationships", label: "Discover" },
  { href: "/insights", label: "Insights" },
  { href: "/data", label: "Data" },
];

export function Nav() {
  const pathname = usePathname();
  const { datasets, dataset, selectDataset, compareIds } = useWorkspace();

  return (
    <nav className="sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center gap-x-6 gap-y-2 px-4 py-3">
        <Link href="/" className="flex items-center gap-2 font-semibold tracking-tight">
          <span aria-hidden className="text-accent">
            ◆
          </span>
          Falmex
        </Link>
        <div className="flex flex-wrap gap-1 text-sm">
          {LINKS.map((l) => {
            const active = pathname.startsWith(l.href);
            return (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-2.5 py-1.5 ${active ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label}
                {l.href === "/compare" && compareIds.length > 0 && (
                  <span className="ml-1 rounded-full bg-accent px-1.5 text-xs text-accent-ink">
                    {compareIds.length}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
        <div className="ml-auto flex items-center gap-2 text-sm">
          <label htmlFor="dataset" className="text-muted">
            Dataset
          </label>
          <select
            id="dataset"
            value={dataset?.dataset_id ?? ""}
            onChange={(e) => selectDataset(e.target.value)}
            className="max-w-56 rounded-md border border-line bg-surface px-2 py-1.5 text-ink"
          >
            {datasets.length === 0 && <option value="">none</option>}
            {datasets.map((d) => (
              <option key={d.dataset_id} value={d.dataset_id}>
                {d.synthetic ? "[SYNTHETIC] " : ""}
                {d.name}
              </option>
            ))}
          </select>
        </div>
      </div>
    </nav>
  );
}
