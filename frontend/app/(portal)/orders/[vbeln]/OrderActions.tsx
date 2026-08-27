"use client";

import { Button, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * Order actions (docs/05 §7.4): Request Change · Cancel · Track Delivery.
 *
 * Cancel is offered only while the order is fully open, and the button being
 * absent is presentation — `cancelOrder` re-reads the status from SAP and
 * refuses anyway, because this screen may be minutes old (docs/05 §4.3).
 *
 * Request Change is ticket-backed (doc 05: "creates ticket-backed change
 * request"), and Support arrives in a later phase. It is rendered disabled
 * with a plain explanation rather than hidden: the customer's question is
 * "can I change this?", and the honest answer is "not through here yet".
 */

export function OrderActions({
  vbeln,
  cancellable,
  canCancel,
  hasDeliveries,
}: {
  vbeln: string;
  cancellable: boolean;
  canCancel: boolean;
  hasDeliveries: boolean;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  async function cancel() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await demoFetch(`/api/orders/${vbeln}/cancel`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "We couldn't cancel this order. Try again in a moment.");
        return;
      }
      setConfirming(false);
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button variant="secondary" disabled title="Change requests arrive with the support module.">
        Request change
      </Button>

      {hasDeliveries ? (
        <Button variant="secondary" disabled title="Delivery tracking arrives in a later phase.">
          Track delivery
        </Button>
      ) : null}

      {canCancel && cancellable ? (
        <Button variant="destructive" onClick={() => setConfirming(true)}>
          Cancel order
        </Button>
      ) : null}

      <ConfirmDialog
        open={confirming}
        tone="destructive"
        title="Cancel this order?"
        consequence={`This rejects every item on order ${vbeln} in SAP. It can't be undone — you'd need to place a new order, and availability may have changed by then.`}
        confirmLabel="Cancel order"
        cancelLabel="Keep it"
        busy={busy}
        error={error}
        onConfirm={() => void cancel()}
        onCancel={() => setConfirming(false)}
      >
        <label className="block">
          <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
            Reason (optional)
          </span>
          <Textarea
            value={reason}
            rows={2}
            placeholder="Ordered in error"
            onChange={(event) => setReason(event.target.value)}
          />
        </label>
      </ConfirmDialog>
    </div>
  );
}
