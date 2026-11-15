"use client";

import Link from "next/link";
import type { Status } from "@/lib/types";
import { useWorkspace } from "@/lib/workspace";
import { ListSkeleton, Skeleton } from "./loading";

export function Card({
  title,
  children,
  action,
  className = "",
}: {
  title?: React.ReactNode;
  children: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <section
      className={`rounded-xl border border-line bg-surface p-5 ${className}`}
    >
      {(title || action) && (
        <div className="mb-4 flex items-center justify-between gap-3">
          {title && <h2 className="text-sm font-semibold text-ink">{title}</h2>}
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

export function PageHeader({
  eyebrow,
  title,
  children,
}: {
  eyebrow?: string;
  title: string;
  children?: React.ReactNode;
}) {
  return (
    <header className="mb-6">
      {eyebrow && (
        <p className="mb-1 text-xs font-medium uppercase tracking-wider text-accent">
          {eyebrow}
        </p>
      )}
      <h1 className="font-display text-3xl font-medium tracking-tight text-ink sm:text-4xl">
        {title}
      </h1>
      {children && (
        <div className="mt-2 max-w-3xl text-sm text-ink-2">{children}</div>
      )}
    </header>
  );
}

export function Button({
  children,
  variant = "primary",
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "ghost";
}) {
  const styles =
    variant === "primary"
      ? "bg-accent text-accent-ink hover:opacity-90"
      : "border border-line text-ink hover:bg-surface-2";
  return (
    <button
      {...props}
      className={`inline-flex items-center gap-2 rounded-lg px-3.5 py-2 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${styles} ${props.className ?? ""}`}
    >
      {children}
    </button>
  );
}

const STATUS: Record<
  Status,
  { label: string; icon: string; color: string; hint: string }
> = {
  validated: {
    label: "Validated",
    icon: "✓",
    color: "var(--good)",
    hint: "Significant, replicated on held-out experiments and beat random shuffles.",
  },
  candidate: {
    label: "Candidate",
    icon: "?",
    color: "var(--warning)",
    hint: "Significant in discovery data, but validation was inconclusive.",
  },
  rejected: {
    label: "Rejected",
    icon: "✕",
    color: "var(--critical)",
    hint: "Looked significant, but failed validation — likely a chance pattern.",
  },
  not_significant: {
    label: "No evidence",
    icon: "–",
    color: "var(--muted)",
    hint: "No statistically significant relationship found.",
  },
};

export function StatusBadge({ status }: { status: Status }) {
  const s = STATUS[status];
  return (
    <span
      title={s.hint}
      className="inline-flex items-center gap-1.5 rounded-full border border-line bg-surface-2 px-2 py-0.5 text-xs font-medium text-ink"
    >
      <span
        aria-hidden
        className="grid h-3.5 w-3.5 place-items-center rounded-full text-[9px] font-bold text-white"
        style={{ background: s.color }}
      >
        {s.icon}
      </span>
      {s.label}
    </span>
  );
}

export const statusHint = (s: Status) => STATUS[s].hint;

export function SyntheticBanner() {
  return (
    <div
      role="note"
      className="mb-5 rounded-lg border border-line bg-surface-2 px-4 py-2.5 text-sm text-ink-2"
    >
      <strong className="text-ink">Synthetic test data.</strong> This dataset is
      fake and only exercises the engine. Nothing shown here is a scientific
      result.
    </div>
  );
}

export function ErrorNote({ message }: { message: string }) {
  return (
    <div
      role="alert"
      className="rounded-lg border border-line bg-surface px-4 py-3 text-sm text-ink-2"
    >
      <span className="mr-1 font-semibold" style={{ color: "var(--critical)" }}>
        ⚠ Error:
      </span>
      {message}
    </div>
  );
}

/** Skeleton of a page header + card, shown while the workspace is still loading. */
export function PageSkeleton() {
  return (
    <div aria-busy="true">
      <div className="mb-6 space-y-2.5">
        <Skeleton className="h-3 w-20" />
        <Skeleton className="h-7 w-72 max-w-full" />
        <Skeleton className="h-4 w-full max-w-xl" />
      </div>
      <Card>
        <ListSkeleton rows={4} />
      </Card>
    </div>
  );
}

export function NoDataset() {
  const { loading } = useWorkspace();
  if (loading) return <PageSkeleton />;
  return (
    <Card>
      <p className="text-sm text-ink-2">
        No dataset loaded yet.{" "}
        <Link
          href="/data"
          className="font-medium text-accent underline underline-offset-2"
        >
          Upload NASA data or generate a synthetic test set
        </Link>
        .
      </p>
    </Card>
  );
}

export function Stat({
  label,
  value,
  hint,
}: {
  label: string;
  value: React.ReactNode;
  hint?: string;
}) {
  return (
    <div title={hint}>
      <p className="text-xs text-muted">{label}</p>
      <p className="mt-0.5 text-lg font-semibold tabular-nums text-ink">
        {value}
      </p>
    </div>
  );
}
