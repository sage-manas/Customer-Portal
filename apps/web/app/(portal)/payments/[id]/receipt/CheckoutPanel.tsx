"use client";

import type { PaymentStatus } from "@cc/domain";
import { Button } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * The gateway hand-off, and the Pending polling banner (docs/05 §7.7 step 3
 * and return states).
 *
 * On the mock gateway there is no real bank to redirect to, so this renders
 * the "complete your payment" step in-page. It does **not** mark anything
 * paid: it asks the server to have the mock driver mint a properly signed
 * webhook and deliver it through the same handler the real gateway will use.
 * The dev flow therefore exercises signature verification, deduplication and
 * the SAP posting — a shortcut here would leave all three untested until the
 * first real gateway (see `completeMockCheckout`).
 *
 * While a payment is `captured` the page polls, because the SAP posting
 * happens server-side and nothing pushes to the browser. Polling stops as
 * soon as the payment reaches a state the customer can act on.
 */

const POLL_INTERVAL_MS = 3000;
const POLL_LIMIT = 20;

export function CheckoutPanel({
  paymentId,
  status,
  canPay,
  gatewayReference,
}: {
  paymentId: string;
  status: PaymentStatus;
  canPay: boolean;
  gatewayReference?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  const settled = status === "posted" || status === "failed" || status === "cancelled";

  // Poll while the payment is still moving — a captured payment is waiting on
  // a SAP posting the browser can't observe any other way.
  React.useEffect(() => {
    if (settled) return;

    let polls = 0;
    const timer = setInterval(() => {
      polls += 1;
      if (polls > POLL_LIMIT) {
        clearInterval(timer);
        return;
      }
      router.refresh();
    }, POLL_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [settled, router]);

  async function complete() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/payments/${paymentId}/complete-mock`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "We couldn't complete this payment. You have not been charged.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  if (settled || !canPay || !gatewayReference) return null;

  return (
    <section className="rounded-md border border-primary bg-primary-subtle p-4 shadow-sm print:hidden">
      <h2 className="text-[13.5px] font-bold text-text">Complete your payment</h2>
      <p className="mt-1 max-w-2xl text-[12.5px] text-text-mid">
        Your bank or UPI app would normally take over here. This environment is running against the
        simulated gateway, so you can complete the payment below — it goes through the same signed
        confirmation and accounting posting a real payment does.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button disabled={busy} onClick={() => void complete()}>
          {busy ? "Completing…" : "Complete payment"}
        </Button>
        <span className="font-mono text-[11px] text-text-dim">{gatewayReference}</span>
      </div>

      {error ? (
        <p role="alert" className="mt-2 text-[12px] font-medium text-danger">
          {error}
        </p>
      ) : null}
    </section>
  );
}
