"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState, useSyncExternalStore } from "react";
import { api } from "@/lib/api";
import { SIDEBAR_KEY } from "@/lib/boot-scripts";
import { PipelineLink } from "./pipeline-link";
import { useWorkspace } from "@/lib/workspace";
import { Skeleton } from "./loading";
import { GitHubLink } from "./github-link";
import { BrandLogo } from "./logo";
import { ThemeToggle } from "./theme-toggle";

const icon = (d: string, size = "h-[18px] w-[18px]") => (
  <svg
    viewBox="0 0 24 24"
    aria-hidden
    className={`${size} shrink-0`}
    fill="none"
    stroke="currentColor"
    strokeWidth={1.8}
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d={d} />
  </svg>
);

type Badge = "compare" | "findings" | "insights";

interface Item {
  href: string;
  label: string;
  hint: string;
  icon: React.ReactNode;
  badge?: Badge;
}

interface Stage {
  n: number;
  name: string;
  icon: React.ReactNode;
  items: Item[];
}

/**
 * The navigation *is* the FlamexSI pipeline: five numbered stages, from NASA files to
 * innovation, each holding the pages that belong to it.
 */
const STAGES: Stage[] = [
  {
    n: 1,
    name: "Data",
    icon: icon(
      "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
      "h-5 w-5",
    ),
    items: [
      {
        href: "/investigations",
        label: "Investigations",
        hint: "All PSI combustion investigations: rank, compare, read",
        icon: icon("M4 4h6v6H4zM14 4h6v6h-6zM4 14h6v6H4zM14 17h6M17 14v6"),
      },
      {
        href: "/data",
        label: "Data",
        hint: "Load, standardize, check quality",
        icon: icon(
          "M4 6c0-1.7 3.6-3 8-3s8 1.3 8 3-3.6 3-8 3-8-1.3-8-3zM4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6M4 12c0 1.7 3.6 3 8 3s8-1.3 8-3",
        ),
      },
      {
        href: "/bass-review",
        label: "BASS-II evidence",
        hint: "Inspect frozen flame masks and reviewer agreement",
        icon: icon("M3 5h18v14H3zM6 15l4-4 3 3 2-2 3 3"),
      },
      {
        href: "/footage",
        label: "Footage",
        hint: "Flame video to measurements",
        icon: icon(
          "M4 6h16v12H4zM8 6v12M16 6v12M4 10h4M4 14h4M16 10h4M16 14h4",
        ),
      },
    ],
  },
  {
    n: 2,
    name: "Explore",
    icon: icon(
      "M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3",
      "h-5 w-5",
    ),
    items: [
      {
        href: "/explorer",
        label: "Explore",
        hint: "Find and filter experiments",
        icon: icon("M11 4a7 7 0 1 0 0 14 7 7 0 0 0 0-14zM21 21l-4.3-4.3"),
      },
      {
        href: "/compare",
        label: "Compare",
        hint: "What differs between experiments",
        icon: icon("M9 4v16M15 4v16M4 8h5M15 16h5"),
        badge: "compare",
      },
    ],
  },
  {
    n: 3,
    name: "Discover",
    icon: icon(
      "M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 1.5 1.5 2.5 3 3 0-3-1-5.5 0-8z",
      "h-5 w-5",
    ),
    items: [
      {
        href: "/relationships",
        label: "Discover",
        hint: "Find and validate associations",
        icon: icon(
          "M12 3c3 4 5 6.5 5 10a5 5 0 0 1-10 0c0-2 1-3.5 2-5 .5 1.5 1.5 2.5 3 3 0-3-1-5.5 0-8z",
        ),
      },
      {
        href: "/findings",
        label: "Findings",
        hint: "All statuses, with evidence",
        icon: icon("M4 20V10M10 20V4M16 20v-7M22 20H2"),
        badge: "findings",
      },
      {
        href: "/review",
        label: "Review",
        hint: "FLEX evidence, limitations and artifacts",
        icon: icon("M4 5h16v14H4zM8 9h8M8 13h5M14 16l2 2 4-5"),
      },
    ],
  },
  {
    n: 4,
    name: "Understand",
    icon: icon(
      "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.5 1 .5 1.6V16h6v-.5c0-.6 0-1.2.5-1.6A6 6 0 0 0 12 3z",
      "h-5 w-5",
    ),
    items: [
      {
        href: "/assistant",
        label: "Ask FlamexSI",
        hint: "Research assistant: answers from the NASA results, every number cited",
        icon: icon(
          "M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18zM3.5 9h17M3.5 15h17M12 3c2.5 2.8 2.5 15.2 0 18M12 3c-2.5 2.8-2.5 15.2 0 18",
        ),
      },
      {
        href: "/insights",
        label: "Insights",
        hint: "Reviewed fire-safety insights",
        icon: icon(
          "M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.5.4.5 1 .5 1.6V16h6v-.5c0-.6 0-1.2.5-1.6A6 6 0 0 0 12 3z",
        ),
        badge: "insights",
      },
      {
        href: "/flight-evidence",
        label: "Flight evidence",
        hint: "NASA FLEX and BASS-II: findings, report, mission check",
        icon: icon("M12 2l3 7h7l-5.5 4.5L18 21l-6-4-6 4 1.5-7.5L2 9h7z"),
      },
      {
        href: "/flame-lab",
        label: "Flame lab 3D",
        hint: "Replay a real FLEX droplet burn in 3D",
        icon: icon(
          "M12 3c1.5 3 4.5 4.5 4.5 8.5a4.5 4.5 0 0 1-9 0C7.5 8.5 9.5 7 12 3zM12 14a1.6 1.6 0 1 0 0 3.2 1.6 1.6 0 0 0 0-3.2z",
        ),
      },
      {
        href: "/beyond",
        label: "Moon, Mars & Earth",
        hint: "Partial gravity from flight data, and uses on Earth",
        icon: icon(
          "M12 3a9 9 0 1 0 9 9M12 3a9 9 0 0 1 9 9M3 12h18M16 5.5a3 3 0 1 0 0 .01",
        ),
      },
      {
        href: "/simulator",
        label: "Simulate",
        hint: "Flammability by oxygen and gravity",
        icon: icon("M4 20V4M4 20h16M7 16c3-1 4-7 7-8s4 2 6 1"),
      },
    ],
  },
  {
    n: 5,
    name: "Build",
    icon: icon(
      "M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4zM19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9z",
      "h-5 w-5",
    ),
    items: [
      {
        href: "/innovation",
        label: "Innovate",
        hint: "What an insight makes possible",
        icon: icon(
          "M12 2l2.4 5.6L20 10l-5.6 2.4L12 18l-2.4-5.6L4 10l5.6-2.4zM19 17l.9 2.1L22 20l-2.1.9L19 23l-.9-2.1L16 20l2.1-.9z",
        ),
      },
    ],
  },
];

const OVERVIEW = icon("M4 4h7v7H4zM13 4h7v4h-7zM13 10h7v10h-7zM4 13h7v7H4z");

// ---- state ------------------------------------------------------------------------------

function subscribeSidebar(onChange: () => void) {
  const obs = new MutationObserver(onChange);
  obs.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ["data-sidebar"],
  });
  return () => obs.disconnect();
}

function useCollapsed() {
  const collapsed = useSyncExternalStore(
    subscribeSidebar,
    () => document.documentElement.dataset.sidebar === "collapsed",
    () => false,
  );
  const toggle = () => {
    const next = !collapsed;
    if (next) document.documentElement.dataset.sidebar = "collapsed";
    else delete document.documentElement.dataset.sidebar;
    try {
      localStorage.setItem(SIDEBAR_KEY, next ? "collapsed" : "open");
    } catch {}
  };
  return [collapsed, toggle] as const;
}

/** Live counts shown next to pages: compare selection, validated findings, insights. */
function useBadges(): Record<Badge, number> {
  const { dataset, compareIds } = useWorkspace();
  const pathname = usePathname();
  const [counts, setCounts] = useState({ findings: 0, insights: 0 });
  const datasetId = dataset?.dataset_id;

  useEffect(() => {
    let live = true;
    Promise.all([
      datasetId
        ? api
            .findings({ dataset_id: datasetId, status: "validated" })
            .catch(() => [])
        : Promise.resolve([]),
      api.insights().catch(() => []),
    ]).then(
      ([f, i]) => live && setCounts({ findings: f.length, insights: i.length }),
    );
    return () => {
      live = false;
    };
    // pathname: refresh after a discovery run or a new insight
  }, [datasetId, pathname]);

  return { compare: compareIds.length, ...counts };
}

// ---- pieces -------------------------------------------------------------------------------

function DatasetPicker({
  className = "",
  pill = false,
}: {
  className?: string;
  pill?: boolean;
}) {
  const { datasets, dataset, selectDataset, loading } = useWorkspace();
  if (loading) return <Skeleton className={`h-8 w-full ${className}`} />;
  return (
    <select
      aria-label="Dataset"
      value={dataset?.dataset_id ?? ""}
      onChange={(e) => selectDataset(e.target.value)}
      className={`w-full min-w-0 truncate text-ink ${pill ? "rounded-full bg-surface-2 px-3 py-1.5 text-xs" : "rounded-md border border-line bg-surface px-2 py-1.5 text-[13px]"} ${className}`}
    >
      {datasets.length === 0 && <option value="">No dataset yet</option>}
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
  );
}

function Count({ n, className = "" }: { n: number; className?: string }) {
  if (!n) return null;
  return (
    <span
      className={`min-w-[1.25rem] rounded-full bg-surface-2 px-1.5 text-center text-[11px] font-semibold tabular-nums text-ink-2 ${className}`}
    >
      {n}
    </span>
  );
}

const SELECTED =
  "bg-[color-mix(in_srgb,var(--accent)_14%,transparent)] text-ink";

// ---- desktop sidebar ------------------------------------------------------------------------

function Sidebar({ badges }: { badges: Record<Badge, number> }) {
  const pathname = usePathname();
  const [collapsed, toggle] = useCollapsed();
  const isActive = (href: string) => pathname.startsWith(href);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "\\") {
        e.preventDefault();
        toggle();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const row = (active: boolean) =>
    `sidebar-row group relative flex h-8 items-center gap-2.5 rounded-md px-2 text-[13px] transition-colors ${active ? SELECTED : "text-ink-2 hover:bg-surface-2 hover:text-ink"}`;

  return (
    <aside
      aria-label="Sections"
      style={{ viewTransitionName: "sidebar" }}
      className="sidebar fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-line bg-surface/75 backdrop-blur-2xl backdrop-saturate-150 lg:flex"
    >
      <div className="flex h-14 shrink-0 items-center gap-2.5 px-4">
        <Link
          href="/"
          className="flex min-w-0 items-center gap-2.5"
          title="FlamexSI home"
        >
          <BrandLogo size={26} />
          <span className="sidebar-label font-display text-lg font-medium tracking-tight text-ink">
            FlamexSI
          </span>
        </Link>
      </div>

      <div className="sidebar-label shrink-0 px-3 pb-3">
        <p className="mb-1 px-1 text-[11px] font-semibold text-muted">
          Dataset
        </p>
        <DatasetPicker />
      </div>

      <nav className="min-h-0 flex-1 overflow-y-auto overflow-x-hidden px-3 pb-3">
        <PipelineLink
          href="/overview"
          className={row(isActive("/overview"))}
          title={collapsed ? "Overview" : undefined}
          aria-current={isActive("/overview") ? "page" : undefined}
        >
          <span className={isActive("/overview") ? "text-accent" : ""}>
            {OVERVIEW}
          </span>
          <span className="sidebar-label truncate">Overview</span>
        </PipelineLink>

        <ol className="relative mt-3">
          {/* the pipeline line connecting the five stages */}
          <span
            aria-hidden
            className="sidebar-label absolute bottom-6 left-[0.95rem] top-3 w-px bg-line"
          />
          {STAGES.map((stage) => {
            const stageActive = stage.items.some((i) => isActive(i.href));
            return (
              <li key={stage.n} className="relative mb-2.5">
                <p className="sidebar-step mb-0.5 flex h-6 items-center gap-2 px-1 text-[11px] font-semibold text-muted">
                  <span
                    className={`relative z-10 grid h-[1.1rem] w-[1.1rem] shrink-0 place-items-center rounded-full text-[10px] tabular-nums ring-2 ring-[var(--surface)] ${stageActive ? "bg-accent text-accent-ink" : "bg-surface-2 text-ink-2"}`}
                  >
                    {stage.n}
                  </span>
                  <span className="sidebar-label">{stage.name}</span>
                </p>
                <ul>
                  {stage.items.map((item) => {
                    const active = isActive(item.href);
                    const n = item.badge ? badges[item.badge] : 0;
                    return (
                      <li key={item.href}>
                        <PipelineLink
                          href={item.href}
                          className={`${row(active)} ml-0`}
                          title={
                            collapsed
                              ? `${item.label}: ${item.hint}`
                              : item.hint
                          }
                          aria-current={active ? "page" : undefined}
                        >
                          <span className={active ? "text-accent" : ""}>
                            {item.icon}
                          </span>
                          <span className="sidebar-label min-w-0 flex-1 truncate">
                            {item.label}
                          </span>
                          {collapsed ? (
                            n > 0 && (
                              <span className="absolute right-1 top-1 h-1.5 w-1.5 rounded-full bg-accent" />
                            )
                          ) : (
                            <Count n={n} className="sidebar-label" />
                          )}
                        </PipelineLink>
                      </li>
                    );
                  })}
                </ul>
              </li>
            );
          })}
        </ol>
      </nav>

      <div className="sidebar-footer flex shrink-0 items-center gap-2 border-t border-line px-3 py-3">
        <ThemeToggle />
        <button
          type="button"
          onClick={toggle}
          title={`${collapsed ? "Expand" : "Collapse"} sidebar (⌘\\)`}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
          aria-expanded={!collapsed}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-line text-ink-2 hover:text-ink"
        >
          {icon(
            collapsed
              ? "M4 4h16v16H4zM9 4v16M13 9l3 3-3 3"
              : "M4 4h16v16H4zM9 4v16M16 9l-3 3 3 3",
          )}
        </button>
        <GitHubLink label className="sidebar-gh ml-auto" />
      </div>
    </aside>
  );
}

// ---- mobile: compact header + floating pipeline tab bar -------------------------------------

// the page last visited in each stage, so a stage tab returns where the user left off
const lastInStage: Record<number, string> = {};

function MobileNav({ badges }: { badges: Record<Badge, number> }) {
  const pathname = usePathname();
  const isActive = (href: string) => pathname.startsWith(href);
  const current = STAGES.findIndex((s) =>
    s.items.some((i) => isActive(i.href)),
  );
  const stage = current >= 0 ? STAGES[current] : null;
  const sub = stage ? stage.items.findIndex((i) => isActive(i.href)) : -1;

  useEffect(() => {
    if (stage && sub >= 0) lastInStage[current] = stage.items[sub].href;
  }, [stage, sub, current]);

  return (
    <>
      <header
        style={{ viewTransitionName: "m-header" }}
        className="sticky top-0 z-30 border-b border-line/70 bg-surface/80 backdrop-blur-xl lg:hidden"
      >
        <div className="flex items-center gap-2.5 px-4 pb-2 pt-[calc(0.5rem+env(safe-area-inset-top))]">
          <PipelineLink
            href="/overview"
            className="flex shrink-0 items-center gap-2"
            aria-label="Overview"
          >
            <BrandLogo size={28} />
            <span className="font-display text-lg font-medium tracking-tight">
              FlamexSI
            </span>
          </PipelineLink>
          <DatasetPicker pill className="ml-auto max-w-[11rem]" />
          <GitHubLink />
          <ThemeToggle />
        </div>
        {stage && stage.items.length > 1 && (
          // the pages of the current stage, as an iOS-style segmented control
          <div
            style={{ viewTransitionName: "m-segment" }}
            className="px-4 pb-2.5"
          >
            <div
              className="relative grid rounded-[0.7rem] bg-surface-2 p-0.5"
              style={{
                gridTemplateColumns: `repeat(${stage.items.length}, minmax(0, 1fr))`,
              }}
            >
              <span
                aria-hidden
                className="absolute bottom-0.5 left-0.5 top-0.5 rounded-[0.6rem] bg-surface shadow-[0_1px_3px_rgb(0_0_0/0.12),0_0_0_0.5px_rgb(0_0_0/0.04)] transition-transform duration-300 ease-[cubic-bezier(0.32,0.72,0,1)]"
                style={{
                  width: `calc((100% - 0.25rem) / ${stage.items.length})`,
                  transform: `translateX(${Math.max(sub, 0) * 100}%)`,
                }}
              />
              {stage.items.map((item, k) => {
                const n = item.badge ? badges[item.badge] : 0;
                return (
                  <PipelineLink
                    key={item.href}
                    href={item.href}
                    aria-current={k === sub ? "page" : undefined}
                    className={`relative z-10 flex min-h-11 items-center justify-center gap-1.5 px-1 py-1.5 text-[13px] ${k === sub ? "font-semibold text-ink" : "text-ink-2"}`}
                  >
                    {item.label}
                    <Count n={n} />
                  </PipelineLink>
                );
              })}
            </div>
          </div>
        )}
      </header>

      <nav
        aria-label="Pipeline"
        style={{ viewTransitionName: "m-tabbar" }}
        className="fixed inset-x-3 bottom-[calc(0.6rem+env(safe-area-inset-bottom))] z-30 rounded-[1.6rem] border border-line/70 bg-surface/80 shadow-[0_10px_40px_-8px_rgb(0_0_0/0.28)] backdrop-blur-xl backdrop-saturate-150 lg:hidden"
      >
        <ul className="relative grid grid-cols-5 p-1">
          {/* sliding highlight under the current stage */}
          <span
            aria-hidden
            className={`absolute bottom-1 left-1 top-1 w-[calc((100%-0.5rem)/5)] rounded-[1.3rem] bg-[color-mix(in_srgb,var(--accent)_13%,transparent)] transition-[transform,opacity] duration-500 ease-[cubic-bezier(0.32,0.72,0,1)] ${current < 0 ? "opacity-0" : ""}`}
            style={{ transform: `translateX(${Math.max(current, 0) * 100}%)` }}
          />
          {STAGES.map((st, k) => {
            const active = k === current;
            const n = st.items.reduce(
              (sum, i) => sum + (i.badge ? badges[i.badge] : 0),
              0,
            );
            return (
              <li key={st.n} className="relative">
                <PipelineLink
                  href={lastInStage[k] ?? st.items[0].href}
                  aria-current={active ? "page" : undefined}
                  className={`flex flex-col items-center gap-0.5 rounded-[1.3rem] py-2 transition-colors ${active ? "text-accent" : "text-ink-2 active:text-ink"}`}
                >
                  <span
                    className={`relative transition-transform duration-300 ${active ? "-translate-y-px scale-110" : ""}`}
                  >
                    {st.icon}
                    {n > 0 && (
                      <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-accent ring-2 ring-[var(--surface)]" />
                    )}
                  </span>
                  <span
                    className={`text-[10.5px] leading-tight ${active ? "font-semibold" : ""}`}
                  >
                    {st.name}
                  </span>
                </PipelineLink>
              </li>
            );
          })}
        </ul>
      </nav>
    </>
  );
}

/**
 * Desktop: a macOS-style sidebar organised as the five pipeline stages; collapses to an icon
 * rail (⌘\). Mobile: a top bar (logo, dataset, theme) and a five-stage tab bar; a stage with
 * multiple pages opens a segmented menu above the bar, so every page fits at any width.
 */
export function Nav() {
  const badges = useBadges();
  return (
    <>
      <Sidebar badges={badges} />
      <MobileNav badges={badges} />
    </>
  );
}
