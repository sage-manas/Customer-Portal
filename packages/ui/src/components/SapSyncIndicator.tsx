import { CircleAlert, Loader2 } from "lucide-react";

import { cn } from "../lib/cn";
import { relativeTime } from "../lib/relative-time";

/**
 * Data-freshness indicator (docs/05-UI-UX-DESIGN.md §3.2, §6.1).
 *
 * `live` / `cached` / `stale` come straight off `SapRead.freshness` from the
 * SAP adapter — the screen never decides its own freshness. `pending`
 * covers a queued write awaiting SAP confirmation (docs/02 §4.3).
 *
 * Status is never colour-only (docs/05 §9): each state carries a label, and
 * the two states that matter carry an icon too.
 */
export type SyncState = "live" | "cached" | "stale" | "pending";

export interface SapSyncIndicatorProps {
  state: SyncState;
  /** ISO timestamp of the underlying read; required for `cached`. */
  syncedAt?: string;
  /** Fixed clock, for deterministic stories/tests. */
  now?: Date;
  className?: string;
}

const DOT_CLASS: Record<SyncState, string> = {
  live: "bg-success",
  cached: "bg-border-strong",
  stale: "bg-warning",
  pending: "bg-info",
};

const TOOLTIP: Record<SyncState, string> = {
  live: "Read from SAP in real time.",
  cached: "Last synced from SAP at the time shown. Not a live read.",
  stale: "SAP is unreachable. Showing the last data we synced; live updates are paused.",
  pending: "Queued for SAP. This will confirm once the write is posted.",
};

export function SapSyncIndicator({ state, syncedAt, now, className }: SapSyncIndicatorProps) {
  const label =
    state === "live"
      ? "Live"
      : state === "pending"
        ? "Pending sync"
        : state === "stale"
          ? "Stale — SAP unreachable"
          : syncedAt
            ? `Synced ${relativeTime(syncedAt, now)}`
            : "Synced";

  // A native `title` rather than the Radix tooltip on purpose: this renders
  // in page headers of server components, and a hover-only hint isn't worth
  // pushing every screen across the client boundary.
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 text-[11px] font-medium text-text-dim",
        state === "stale" && "text-warning",
        className,
      )}
      role="status"
      title={TOOLTIP[state]}
    >
      {state === "pending" ? (
        <Loader2 aria-hidden className="size-3 animate-spin text-info" />
      ) : state === "stale" ? (
        <CircleAlert aria-hidden className="size-3" />
      ) : (
        <span aria-hidden className={cn("size-2 rounded-pill", DOT_CLASS[state])} />
      )}
      {label}
    </span>
  );
}

/**
 * Page-level banner for the SAP-outage case (docs/05 §6.1): "Showing last
 * synced data from 09:42. Live updates paused."
 */
export interface StaleDataBannerProps {
  syncedAt: string;
  onRetry?: () => void;
  className?: string;
}

export function StaleDataBanner({ syncedAt, onRetry, className }: StaleDataBannerProps) {
  const time = new Date(syncedAt).toLocaleTimeString("en-IN", {
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });

  return (
    <div
      role="alert"
      className={cn(
        "flex items-center gap-2 rounded-md border border-warning-border bg-warning-subtle px-4 py-2.5 text-[12.5px] text-warning",
        className,
      )}
    >
      <CircleAlert aria-hidden className="size-4 shrink-0" />
      <span>Showing last synced data from {time}. Live updates paused.</span>
      {onRetry ? (
        <button
          type="button"
          onClick={onRetry}
          className="ml-auto rounded-sm px-2 py-1 font-medium underline underline-offset-2 hover:bg-warning-border/40"
        >
          Retry
        </button>
      ) : null}
    </div>
  );
}
