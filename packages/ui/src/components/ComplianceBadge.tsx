"use client";

import { BadgeCheck, Copy, ShieldAlert, ShieldQuestion } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

/**
 * Compliance identifiers as trust signals (docs/05-UI-UX-DESIGN.md P5, §3.2):
 * GSTIN with its GSTN-verified tick, IRN (64 chars, truncated + copy), and
 * e-way bill number. Indian B2B buyers actively check these, so they get a
 * component of their own rather than being buried in a details list.
 *
 * A client component: copy-to-clipboard needs state and the browser API.
 * Server pages (the approval screen) can still render it — Next ships it to
 * the client for them.
 *
 * The verification state is *reported*, never inferred: a caller passes what
 * the GSTN/e-invoice adapter actually answered. A badge that showed a tick
 * because the string looked well-formed would be a compliance claim nobody
 * made.
 */

export type ComplianceKind = "gstin" | "irn" | "eway";

export type ComplianceState = "verified" | "unverified" | "failed";

const KIND_LABEL: Record<ComplianceKind, string> = {
  gstin: "GSTIN",
  irn: "IRN",
  eway: "E-Way Bill",
};

export interface ComplianceBadgeProps {
  kind: ComplianceKind;
  value: string;
  state?: ComplianceState;
  /** Extra context under the value, e.g. GSTN's legal name echo. */
  caption?: string;
  /** Truncate long values (IRN is 64 chars). Defaults on for `irn`. */
  truncate?: boolean;
  onCopy?: (value: string) => void;
  className?: string;
}

const STATE_CLASS: Record<ComplianceState, string> = {
  verified: "border-success-border bg-success-subtle text-success",
  unverified: "border-border bg-background text-text-mid",
  failed: "border-danger-border bg-danger-subtle text-danger",
};

const STATE_LABEL: Record<ComplianceState, string> = {
  verified: "Verified",
  unverified: "Not verified",
  failed: "Verification failed",
};

export function ComplianceBadge({
  kind,
  value,
  state = "unverified",
  caption,
  truncate,
  onCopy,
  className,
}: ComplianceBadgeProps) {
  const [copied, setCopied] = React.useState(false);
  const shouldTruncate = truncate ?? kind === "irn";
  const display =
    shouldTruncate && value.length > 20 ? `${value.slice(0, 12)}…${value.slice(-6)}` : value;

  const Icon =
    state === "verified" ? BadgeCheck : state === "failed" ? ShieldAlert : ShieldQuestion;

  async function copy() {
    onCopy?.(value);
    try {
      await navigator.clipboard.writeText(value);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // Clipboard access can be denied; the value is still on screen, and a
      // failed copy is not worth an error state.
    }
  }

  return (
    <div
      className={cn(
        "inline-flex max-w-full items-center gap-2 rounded-md border px-2.5 py-1.5",
        STATE_CLASS[state],
        className,
      )}
    >
      <Icon aria-hidden className="size-4 shrink-0" />
      <div className="min-w-0">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[10.5px] font-bold uppercase tracking-[0.8px] opacity-80">
            {KIND_LABEL[kind]}
          </span>
          <span className="truncate font-mono text-[12px] font-semibold" title={value}>
            {display}
          </span>
        </div>
        <p className="truncate text-[10.5px] opacity-90">{caption ?? STATE_LABEL[state]}</p>
      </div>

      <button
        type="button"
        onClick={copy}
        aria-label={`Copy ${KIND_LABEL[kind]}`}
        className="ml-1 rounded-sm p-1 opacity-70 transition-opacity duration-micro hover:opacity-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
      >
        <Copy aria-hidden className="size-3.5" />
      </button>
      <span role="status" className="sr-only">
        {copied ? `${KIND_LABEL[kind]} copied` : ""}
      </span>
    </div>
  );
}
