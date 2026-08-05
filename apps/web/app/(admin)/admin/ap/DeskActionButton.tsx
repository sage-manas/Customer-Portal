"use client";

import { Button, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

/**
 * The AP and AR desks' one action button (doc 09 §3.4, ADR-059).
 *
 * Three actions — pay a refund, settle a rebate, release a credit block — with
 * one component rather than three, because they differ only in their endpoint
 * and their wording. What they share is the part that matters and must not be
 * re-implemented per screen:
 *
 *  - **A confirmation naming the SAP consequence**, per docs/05 §6.2. These
 *    post real FI and SD documents; "Are you sure?" would be useless, so the
 *    dialog says which transaction runs and what it does.
 *  - **A result the desk reads**, not a silent refresh. A release that SAP
 *    refused comes back 200 with `released: false` and a reason, and that
 *    reason is the whole answer — swallowing it into "done" would be the
 *    dishonesty this desk exists to avoid.
 *  - **One in-flight request.** The button disables itself while posting;
 *    idempotency in SAP is the real guard (the reference is derived from the
 *    document, not the click), and this is the cheap half of it.
 */

export interface DeskActionButtonProps {
  endpoint: string;
  label: string;
  busyLabel: string;
  title: string;
  /** What runs in SAP, in the desk's words — never "are you sure?". */
  consequence: React.ReactNode;
  confirmLabel: string;
  tone?: "primary" | "destructive";
  /** Reads the handler's JSON when the call succeeded but SAP refused. */
  refusal?: (result: Record<string, unknown>) => string | null;
  disabled?: boolean;
  disabledReason?: string;
}

export function DeskActionButton({
  endpoint,
  label,
  busyLabel,
  title,
  consequence,
  confirmLabel,
  tone = "primary",
  refusal,
  disabled = false,
  disabledReason,
}: DeskActionButtonProps) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string | undefined>();
  const [outcome, setOutcome] = React.useState<string | null>(null);
  const [note, setNote] = React.useState("");

  async function run() {
    setBusy(true);
    setError(undefined);

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ note: note.trim() || undefined }),
      });
      const body = (await response.json().catch(() => null)) as Record<string, unknown> | null;

      if (!response.ok) {
        const issues = Array.isArray(body?.issues)
          ? (body.issues as { message?: string }[])
              .map((issue) => issue.message)
              .filter(Boolean)
              .join(" ")
          : "";
        setError(issues || (body?.error as string) || "That didn't go through.");
        return;
      }

      // A refusal SAP reported is a successful call: close the dialog and
      // show what it said, rather than dressing it up as an error.
      const refused = refusal && body ? refusal(body) : null;
      setConfirming(false);
      setOutcome(refused);
      setNote("");
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (disabled) {
    return (
      <span className="text-[11px] text-text-dim" title={disabledReason}>
        {disabledReason ?? "—"}
      </span>
    );
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant={tone === "destructive" ? "destructive" : "secondary"}
        size="sm"
        disabled={busy}
        onClick={() => setConfirming(true)}
      >
        {busy ? busyLabel : label}
      </Button>

      {outcome ? (
        <span className="max-w-xs text-right text-[11px] text-warning">{outcome}</span>
      ) : null}

      <ConfirmDialog
        open={confirming}
        tone={tone}
        title={title}
        consequence={consequence}
        confirmLabel={confirmLabel}
        cancelLabel="Go back"
        busy={busy}
        error={error}
        onConfirm={() => void run()}
        onCancel={() => setConfirming(false)}
      >
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
            Note (optional — carried onto the SAP document)
          </span>
          <Textarea value={note} rows={2} onChange={(event) => setNote(event.target.value)} />
        </label>
      </ConfirmDialog>
    </div>
  );
}
