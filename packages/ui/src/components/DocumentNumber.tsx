"use client";

import { Copy } from "lucide-react";
import * as React from "react";

import { cn } from "../lib/cn";

export interface DocumentNumberProps {
  /** SAP doc number, e.g. VBAK-VBELN, without leading zeros (docs/05 §11). */
  value: string;
  /** Deep link to the document detail screen. */
  href?: string;
  onClick?: () => void;
  className?: string;
}

/**
 * Renders an SAP document number (SO/DEL/INV/...) as the primary
 * cross-document navigation affordance (docs/05 §4.2). Mono, primary-
 * colored, clickable, with copy-on-hover.
 */
export function DocumentNumber({ value, href, onClick, className }: DocumentNumberProps) {
  const [copied, setCopied] = React.useState(false);

  async function handleCopy(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    await navigator.clipboard.writeText(value);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  const content = (
    <span
      className={cn(
        "group inline-flex items-center gap-1 font-mono text-[12.5px] text-primary",
        className,
      )}
    >
      <span className="underline-offset-2 group-hover:underline">{value}</span>
      <button
        type="button"
        onClick={handleCopy}
        aria-label={copied ? "Copied" : `Copy ${value}`}
        className="opacity-0 transition-opacity duration-micro group-hover:opacity-100 focus-visible:opacity-100"
      >
        <Copy size={12} strokeWidth={1.75} />
      </button>
    </span>
  );

  if (href) {
    return (
      <a href={href} onClick={onClick} className="inline-flex">
        {content}
      </a>
    );
  }

  return (
    <button type="button" onClick={onClick} className="inline-flex text-left">
      {content}
    </button>
  );
}
