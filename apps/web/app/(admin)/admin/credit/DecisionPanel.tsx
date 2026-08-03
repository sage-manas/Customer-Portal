"use client";

import { Button, Input, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Approve / decline, with a counter-offer (docs/05 §8, `DecisionGate`
 * semantics).
 *
 * The amount box defaults to what the customer asked for, so agreeing in full
 * is one click; changing it is how the desk counter-offers. A decline needs a
 * note in practice and the field says so, but the schema does not require one
 * — a desk that must type a sentence to decline an obvious no ends up typing
 * "no", which is worse than an empty field for the customer reading it.
 */

interface FieldIssue {
  field: string;
  message: string;
}

export function DecisionPanel({
  requestId,
  requestedLimit,
}: {
  requestId: string;
  requestedLimit: number;
}) {
  const router = useRouter();

  const [approvedLimit, setApprovedLimit] = useState(String(requestedLimit));
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [issues, setIssues] = useState<FieldIssue[]>([]);

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  async function decide(decision: "approved" | "rejected") {
    setBusy(true);
    setError(null);
    setIssues([]);

    try {
      const response = await fetch(`/api/admin/credit/requests/${requestId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision,
          // A decline carries no figure: there is nothing being agreed to.
          approvedLimit: decision === "approved" ? Number(approvedLimit) : undefined,
          note: note.trim() === "" ? undefined : note,
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        id?: string;
        error?: string;
        issues?: FieldIssue[];
      } | null;

      if (!response.ok || !body?.id) {
        setError(body?.error ?? "We couldn't record that decision.");
        setIssues(body?.issues ?? []);
        return;
      }

      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-4 flex flex-col gap-3 border-t border-border pt-3">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-3 py-2 text-[12px] text-danger"
        >
          {error}
        </p>
      ) : null}

      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
            Approve up to (₹)
          </span>
          <Input
            type="number"
            min={1}
            // See the customer's form: a round `step` against `min={1}` marks
            // ordinary amounts invalid.
            step="any"
            value={approvedLimit}
            onChange={(e) => setApprovedLimit(e.target.value)}
            className="max-w-[12rem] font-mono"
          />
          {issueFor("approvedLimit") ? (
            <span className="text-[11px] text-danger">{issueFor("approvedLimit")}</span>
          ) : null}
        </label>

        <div className="flex items-center gap-2">
          <Button type="button" disabled={busy} onClick={() => void decide("approved")}>
            {busy ? "Recording…" : "Approve"}
          </Button>
          <Button
            type="button"
            variant="ghost"
            disabled={busy}
            onClick={() => void decide("rejected")}
          >
            Decline
          </Button>
        </div>
      </div>

      <label className="flex flex-col gap-1">
        <span className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
          Note to the customer <span className="font-normal normal-case">(optional)</span>
        </span>
        <Textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          rows={2}
          maxLength={1000}
          placeholder="Approved to 60 lakh pending the Q3 accounts."
        />
      </label>
    </div>
  );
}
