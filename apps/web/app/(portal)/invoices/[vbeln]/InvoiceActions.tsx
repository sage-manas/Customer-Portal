"use client";

import { Button } from "@cc/ui";
import { Download } from "lucide-react";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Invoice actions (docs/03 Screen 6.1, docs/05 §7.6): Download Invoice PDF ·
 * Download e-Invoice · Raise Dispute · Pay Now.
 *
 * The PDF is fetched through `/api/invoices/[vbeln]/pdf` rather than linked
 * directly: that handler re-checks the session, the permission and the
 * sold-to account before handing over a statutory document, which a bare
 * link to a storage URL would not (the same reasoning as ADR-012).
 *
 * Raise Dispute is ticket-backed and Support arrives in Phase 6. It renders
 * disabled with a plain explanation rather than hidden — the customer's
 * question is "can I query this bill?", and the honest answer is "not
 * through here yet".
 */

export function InvoiceActions({
  vbeln,
  payable,
  canPay,
  canRaiseTicket,
}: {
  vbeln: string;
  payable: boolean;
  canPay: boolean;
  canRaiseTicket: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();

  async function downloadPdf() {
    setBusy(true);
    setError(undefined);
    try {
      const response = await fetch(`/api/invoices/${vbeln}/pdf`);
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "We couldn't fetch that document. Try again in a moment.");
        return;
      }
      const { url } = (await response.json()) as { url: string };
      window.open(url, "_blank", "noopener,noreferrer");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void downloadPdf()}>
          <Download aria-hidden className="size-3.5" />
          {busy ? "Fetching…" : "Invoice PDF"}
        </Button>

        <Button
          variant="secondary"
          disabled
          title={
            canRaiseTicket
              ? "Disputes arrive with the support module."
              : "You don't have permission to raise a dispute."
          }
        >
          Raise dispute
        </Button>

        {canPay && payable ? (
          <Button onClick={() => router.push(`/payments/pay?invoice=${encodeURIComponent(vbeln)}`)}>
            Pay now
          </Button>
        ) : null}
      </div>

      {error ? (
        <p role="alert" className="text-[11.5px] text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
