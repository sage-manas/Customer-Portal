"use client";

import { Button } from "@cc/ui";
import { AlertTriangle } from "lucide-react";
import * as React from "react";

/**
 * Confirmation for an irreversible action (docs/05 §6.2: "Destructive/
 * irreversible actions (Submit order, Cancel order, Approve & Create in SAP)
 * → confirmation dialog stating the SAP consequence").
 *
 * `consequence` is the point of the component: the dialog must say what will
 * happen in the system of record — "This creates a sales order in SAP
 * immediately" — not merely "Are you sure?". A dialog that only asks for
 * confirmation trains people to dismiss it.
 */

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  /** What this does in SAP, in the customer's words. */
  consequence: React.ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  tone?: "primary" | "destructive";
  busy?: boolean;
  error?: string;
  onConfirm: () => void;
  onCancel: () => void;
  children?: React.ReactNode;
}

export function ConfirmDialog({
  open,
  title,
  consequence,
  confirmLabel,
  cancelLabel = "Go back",
  tone = "primary",
  busy = false,
  error,
  onConfirm,
  onCancel,
  children,
}: ConfirmDialogProps) {
  const panelRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!open) return;
    const onKeyDown = (event: KeyboardEvent) => {
      // Esc closes layers (docs/05 §9) — but never while the write is in
      // flight, when dismissing would hide the outcome of a real action.
      if (event.key === "Escape" && !busy) onCancel();
    };
    document.addEventListener("keydown", onKeyDown);
    panelRef.current?.focus();
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [open, busy, onCancel]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
      <div
        aria-hidden
        className="absolute inset-0 bg-black/40"
        onClick={busy ? undefined : onCancel}
      />

      <div
        ref={panelRef}
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        className="relative w-full max-w-md rounded-md border border-border bg-surface p-5 shadow-lg focus:outline-none"
      >
        <h2 className="flex items-center gap-2 text-[15px] font-bold text-text">
          <AlertTriangle
            aria-hidden
            className={tone === "destructive" ? "size-4 text-danger" : "size-4 text-warning"}
          />
          {title}
        </h2>

        <p className="mt-2 text-[12.5px] text-text-mid">{consequence}</p>

        {children ? <div className="mt-3">{children}</div> : null}

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-[12px] text-danger"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5 flex justify-end gap-2">
          <Button variant="secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </Button>
          <Button variant={tone} onClick={onConfirm} loading={busy}>
            {confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  );
}
