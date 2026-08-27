"use client";

import type { QuotationAcceptBlock, ShipToAddress } from "@cc/domain";
import { Button, Input, Select, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

import { ConfirmDialog } from "@/components/ConfirmDialog";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * What a customer can do with a quotation (docs/05 §7.3): accept and convert
 * it to an order, or ask for a revision — which, once it has expired, is the
 * "Request revalidation" the same doc asks for.
 *
 * Which of those is offered is decided on the server from
 * `quotationAcceptBlock` and `canRequestQuotationRevision`; this component
 * renders the answer. It cannot offer a move the API would refuse, because it
 * is not the thing deciding — and the API re-derives both from SAP's own
 * document anyway, so a page left open past the expiry cannot push one
 * through.
 */

export interface QuotationActionsProps {
  vbeln: string;
  shipTos: ShipToAddress[];
  /** Null when the quotation may still be accepted; the reason when it can't. */
  acceptBlock: QuotationAcceptBlock | null;
  revisable: boolean;
  canAccept: boolean;
  canRequestRevision: boolean;
  /** VBAK-VDATU from the inquiry, pre-filled as the requested delivery date. */
  defaultRequestedDate?: string;
}

interface ApiIssue {
  field: string;
  message: string;
}

export function QuotationActions({
  vbeln,
  shipTos,
  acceptBlock,
  revisable,
  canAccept,
  canRequestRevision,
  defaultRequestedDate,
}: QuotationActionsProps) {
  const router = useRouter();

  const [shipTo, setShipTo] = React.useState(shipTos[0]?.kunnr ?? "");
  const [customerPoRef, setCustomerPoRef] = React.useState("");
  const [requestedDeliveryDate, setRequestedDeliveryDate] = React.useState(
    defaultRequestedDate ?? "",
  );
  const [comment, setComment] = React.useState("");

  const [confirming, setConfirming] = React.useState(false);
  const [busy, setBusy] = React.useState<"accept" | "revision" | null>(null);
  const [error, setError] = React.useState<string>();
  const [issues, setIssues] = React.useState<ApiIssue[]>([]);
  const [notice, setNotice] = React.useState<string>();

  const issueFor = (field: string) => issues.find((issue) => issue.field === field)?.message;

  const shipToOptions = React.useMemo(() => {
    const byKunnr = new Map<string, string[]>();
    for (const address of shipTos) {
      const labels = byKunnr.get(address.kunnr) ?? [];
      labels.push(`${address.label} — ${address.address.city}`);
      byKunnr.set(address.kunnr, labels);
    }
    return [...byKunnr].map(([value, labels]) => ({ value, label: labels.join(" / ") }));
  }, [shipTos]);

  async function accept() {
    setBusy("accept");
    setError(undefined);
    setIssues([]);
    try {
      const response = await demoFetch(`/api/quotations/${vbeln}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          shipTo,
          customerPoRef: customerPoRef.trim() || undefined,
          requestedDeliveryDate: requestedDeliveryDate || undefined,
        }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          issues?: ApiIssue[];
        };
        setError(body.error ?? "That didn't work. Try again in a moment.");
        setIssues(body.issues ?? []);
        setConfirming(false);
        return;
      }
      const { order } = (await response.json()) as { order: { vbeln: string } };
      // Straight to the order: the credit gate and the confirmed schedule
      // lines are there, and "and then?" is the customer's next question.
      router.push(`/orders/${order.vbeln}`);
    } finally {
      setBusy(null);
    }
  }

  async function requestRevision() {
    setBusy("revision");
    setError(undefined);
    setIssues([]);
    try {
      const response = await demoFetch(`/api/quotations/${vbeln}/revision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ comment }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as {
          error?: string;
          issues?: ApiIssue[];
        };
        setError(body.error ?? "That didn't work. Try again in a moment.");
        setIssues(body.issues ?? []);
        return;
      }
      setComment("");
      setNotice("Sent. Our sales team will come back to you.");
      router.refresh();
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {notice ? (
        <p
          role="status"
          className="rounded-md border border-success-border bg-success-subtle px-4 py-2.5 text-[12.5px] text-success"
        >
          {notice}
        </p>
      ) : null}

      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          {error}
        </p>
      ) : null}

      {canAccept && acceptBlock === null ? (
        <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-3 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
            Accept this quotation
          </h2>

          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
                Deliver to<span className="ml-0.5 text-danger">*</span>
              </span>
              <Select
                value={shipTo}
                onChange={(event) => setShipTo(event.target.value)}
                options={shipToOptions}
              />
              {issueFor("shipTo") ? (
                <span className="mt-1 block text-[11px] text-danger">{issueFor("shipTo")}</span>
              ) : null}
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
                Your PO reference
              </span>
              <Input
                value={customerPoRef}
                maxLength={20}
                placeholder="PO-2026-0142"
                onChange={(event) => setCustomerPoRef(event.target.value)}
              />
              {issueFor("customerPoRef") ? (
                <span className="mt-1 block text-[11px] text-danger">
                  {issueFor("customerPoRef")}
                </span>
              ) : (
                <span className="mt-1 block text-[11px] text-text-dim">
                  Printed on the confirmation
                </span>
              )}
            </label>

            <label className="block">
              <span className="mb-1 block text-[11px] font-semibold uppercase tracking-wide text-text-dim">
                Requested delivery date
              </span>
              <Input
                type="date"
                value={requestedDeliveryDate}
                onChange={(event) => setRequestedDeliveryDate(event.target.value)}
              />
            </label>
          </div>

          <div className="mt-4 flex justify-end">
            <Button onClick={() => setConfirming(true)} disabled={!shipTo}>
              Accept &amp; convert to order
            </Button>
          </div>
        </section>
      ) : null}

      {canRequestRevision && revisable ? (
        <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
          <h2 className="mb-1 text-[11.5px] font-bold uppercase tracking-[0.8px] text-text-mid">
            {acceptBlock === "expired" ? "Request revalidation" : "Request a revision"}
          </h2>
          <p className="mb-3 text-[12px] text-text-dim">
            {acceptBlock === "expired"
              ? "This price has lapsed. Tell our sales team and they'll issue a fresh quotation."
              : "Ask our sales team to rework the price, the quantities or the terms."}
          </p>

          <Textarea
            value={comment}
            rows={3}
            maxLength={2000}
            placeholder="What needs to change?"
            onChange={(event) => setComment(event.target.value)}
          />
          {issueFor("comment") ? (
            <p className="mt-1 text-[11px] text-danger">{issueFor("comment")}</p>
          ) : null}

          <div className="mt-3 flex justify-end">
            <Button
              variant="secondary"
              onClick={() => void requestRevision()}
              loading={busy === "revision"}
              disabled={comment.trim().length < 10}
            >
              Send request
            </Button>
          </div>
        </section>
      ) : null}

      <ConfirmDialog
        open={confirming}
        title="Accept this quotation?"
        consequence="This creates a sales order in SAP immediately, at the prices quoted here. You'll get an order number straight away."
        confirmLabel="Accept & convert"
        busy={busy === "accept"}
        onConfirm={() => void accept()}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
