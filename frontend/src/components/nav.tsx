"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useWorkspace } from "@/lib/workspace";
import { Skeleton } from "./loading";
import { BrandLogo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const icon = (d: string) => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden
    className="h-5 w-5"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

const LINKS = [
  {
    href: "/explorer",
    label: "Explore",
    icon: icon("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3"),
  },
  {
    href: "/compare",
    label: "Compare",
    icon: icon("M9 4v16M15 4v16M4 8h5M15 16h5"),
  },
  {
    href: "/relationships",
    label: "Discover",
    icon: icon(
      "M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 1.5 1.5 2.5 3 3 0-3-1-5.5 0-8z",
    ),
  },
  {
    href: "/findings",
    label: "Findings",
    icon: icon("M4 20V10M10 20V4M16 20v-7M22 20H2"),
  },
  {
    href: "/insights",
    label: "Insights",
    icon: icon(
      "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.5 1 .5 1.6V16h6v-.5c0-.6 0-1.2.5-1.6A6 6 0 0 0 12 3z",
    ),
  },
  {
    href: "/innovation",
    label: "Innovate",
    icon: icon(
      "M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4zM19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9z",
    ),
  },
  {
    href: "/data",
    label: "Data",
    icon: icon(
      "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
    ),
  },
];

function DatasetPicker({ className = "" }: { className?: string }) {
  const { datasets, dataset, selectDataset, loading } = useWorkspace();
  if (loading)
    return <Skeleton className={`h-8 w-44 max-w-full ${className}`} />;
  return (
    <div className={`flex min-w-0 items-center gap-2 text-sm ${className}`}>
      <label htmlFor="dataset" className="hidden text-muted sm:inline">
        Dataset
      </label>
      <select
        id="dataset"
        aria-label="Dataset"
        value={dataset?.dataset_id ?? ""}
        onChange={(e) => selectDataset(e.target.value)}
        className="w-full min-w-0 max-w-56 truncate rounded-md border border-line bg-surface px-2 py-1.5 text-ink"
      >
        {datasets.length === 0 && <option value="">none</option>}
        {[
          {
            label: "NASA / real data",
            list: datasets.filter((d) => !d.synthetic),
          },
          {
            label: "Synthetic test data (not NASA)",
            list: datasets.filter((d) => d.synthetic),
          },
        ]
          .filter((g) => g.list.length)
          .map((g) => (
            <optgroup key={g.label} label={g.label}>
              {g.list.map((d) => (
                <option key={d.dataset_id} value={d.dataset_id}>
                  {d.synthetic ? "[TEST] " : ""}
                  {d.name}
                </option>
              ))}
            </optgroup>
          ))}
      </select>
    </div>
  );
}

function CompareCount() {
  const { compareIds } = useWorkspace();
  if (!compareIds.length) return null;
  return (
    <span className="ml-1 rounded-full bg-accent px-1.5 text-[10px] font-semibold text-accent-ink">
      {compareIds.length}
    </span>
  );
}

const Logo = () => (
  <Link
    href="/"
    className="flex shrink-0 items-center gap-2 font-display text-xl font-medium tracking-tight"
  >
    <BrandLogo size={30} />
    Falmex
  </Link>
);

/**
 * Desktop: one top bar with links + dataset picker.
 * Mobile: compact top bar (logo + dataset) and a bottom tab bar, so every section is one
 * thumb-tap away. (A hamburger menu was tried too; it hid the sections behind an extra tap.)
 */
export function Nav() {
  const pathname = usePathname();
  const isActive = (href: string) => pathname.startsWith(href);

  return (
    <>
      <nav className="sticky top-0 z-30 border-b border-line bg-surface/90 shadow-bar backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-4 py-3">
          <Logo />
          <div className="hidden gap-1 text-sm md:flex">
            {LINKS.map((l) => (
              <Link
                key={l.href}
                href={l.href}
                className={`rounded-md px-2.5 py-1.5 ${isActive(l.href) ? "bg-surface-2 font-medium text-ink" : "text-ink-2 hover:text-ink"}`}
              >
                {l.label}
                {l.href === "/compare" && <CompareCount />}
              </Link>
            ))}
          </div>
          <DatasetPicker className="ml-auto" />
          <ThemeToggle />
        </div>
      </nav>

      <nav
        aria-label="Sections"
        className="fixed inset-x-0 bottom-0 z-30 border-t border-line bg-surface/95 pb-[env(safe-area-inset-bottom)] backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-7">
          {LINKS.map((l) => {
            const active = isActive(l.href);
            return (
              <li key={l.href}>
                <Link
                  href={l.href}
                  aria-current={active ? "page" : undefined}
                  className={`relative flex flex-col items-center gap-0.5 py-2 text-[11px] ${active ? "font-medium text-accent" : "text-ink-2"}`}
                >
                  {l.icon}
                  {l.label}
                  {l.href === "/compare" && (
                    <span className="absolute right-3 top-1">
                      <CompareCount />
                    </span>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}
