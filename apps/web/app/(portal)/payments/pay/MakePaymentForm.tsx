"use client";

import { PAYMENT_MODES, type PaymentMode } from "@cc/domain";
import type { PayableItem } from "@cc/service-payment";
import { Button, Input, Money, formatDisplayDate } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Make Payment steps 1–3 (docs/05 §7.7).
 *
 * Two decisions worth stating:
 *
 * - **Amounts are per line, and default to the full balance.** Doc 03 allows
 *   partial payment, so every selected row carries an editable amount rather
 *   than a single total the customer splits — SAP clears item by item, and
 *   an amount that isn't attached to an item can't be posted.
 * - **Submitting does not take money.** It records the intent and returns a
 *   checkout URL; the gateway's signed webhook is what settles anything. So
 *   the button says "Continue to payment", not "Pay" — the customer has not
 *   paid until the gateway says so.
 *
 * The payment modes come from the `PAYMENT_MODES` registry in @cc/domain, so
 * a mode added there appears here without this file changing.
 */

interface Selection {
  selected: boolean;
  amount: string;
}

export function MakePaymentForm({
  items,
  currency,
  preselect,
}: {
  items: PayableItem[];
  currency: string;
  preselect?: string;
}) {
  const router = useRouter();

  const [selections, setSelections] = React.useState<Record<string, Selection>>(() =>
    Object.fromEntries(
      items.map((item) => [
        item.documentNumber,
        {
          selected: preselect === item.documentNumber,
          amount: item.openAmount.toFixed(2),
        },
      ]),
    ),
  );
  const [mode, setMode] = React.useState<PaymentMode>("upi");
  const [busy, setBusy] = React.useState(false);
  const [error, setError] = React.useState<string>();
  const [fieldErrors, setFieldErrors] = React.useState<Record<string, string>>({});

  const chosen = items.filter((item) => selections[item.documentNumber]?.selected);
  const total = chosen.reduce(
    (sum, item) => sum + (Number(selections[item.documentNumber]?.amount) || 0),
    0,
  );

  function update(documentNumber: string, patch: Partial<Selection>) {
    setSelections((current) => ({
      ...current,
      [documentNumber]: { ...current[documentNumber]!, ...patch },
    }));
  }

  /** Client-side mirror of the domain rule; the API enforces it regardless. */
  function localIssue(item: PayableItem): string | undefined {
    const selection = selections[item.documentNumber];
    if (!selection?.selected) return undefined;

    const amount = Number(selection.amount);
    if (!Number.isFinite(amount) || amount <= 0) return "Enter an amount greater than zero";
    if (amount > item.openAmount + 0.005) {
      return `You can pay at most ${item.openAmount.toFixed(2)} against this invoice`;
    }
    return undefined;
  }

  const hasLocalIssues = chosen.some((item) => localIssue(item) !== undefined);
  const canSubmit = chosen.length > 0 && !hasLocalIssues && !busy;

  async function submit() {
    setBusy(true);
    setError(undefined);
    setFieldErrors({});

    try {
      const response = await fetch("/api/payments", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          allocations: chosen.map((item) => ({
            documentNumber: item.documentNumber,
            amount: Number(selections[item.documentNumber]!.amount),
          })),
        }),
      });

      const body = (await response.json().catch(() => null)) as {
        error?: string;
        issues?: Array<{ field: string; message: string }>;
        paymentId?: string;
        checkoutUrl?: string;
      } | null;

      if (!response.ok) {
        setError(body?.error ?? "We couldn't start this payment. You have not been charged.");
        setFieldErrors(
          Object.fromEntries(
            (body?.issues ?? []).map((issue) => [
              issue.field.replace(/^allocations\./, ""),
              issue.message,
            ]),
          ),
        );
        return;
      }

      // Step 3: hand over to the gateway. The portal learns the outcome from
      // the webhook, not from wherever this redirect lands.
      router.push(`/payments/${body!.paymentId}/receipt`);
    } catch {
      setError("We couldn't reach the portal to start this payment. You have not been charged.");
    } finally {
      setBusy(false);
    }
  }

  if (items.length === 0) {
    return (
      <section className="rounded-md border border-border bg-surface p-8 text-center shadow-sm">
        <p className="text-[13px] font-semibold text-text">Nothing outstanding.</p>
        <p className="mt-1 text-[12.5px] text-text-dim">
          Every invoice on this account has been settled.
        </p>
      </section>
    );
  }

  return (
    <div className="space-y-4">
      {/* --- Step 1: choose invoices --- */}
      <section className="overflow-hidden rounded-md border border-border bg-surface shadow-sm">
        <h2 className="border-b border-border px-4 py-3 text-[13px] font-bold text-text">
          1 · Choose invoices
        </h2>

        <div className="overflow-x-auto">
          <table className="w-full text-[12.5px]">
            <thead>
              <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
                <th scope="col" className="px-4 py-2 font-bold">
                  <span className="sr-only">Select</span>
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Invoice
                </th>
                <th scope="col" className="px-4 py-2 font-bold">
                  Due
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Outstanding
                </th>
                <th scope="col" className="px-4 py-2 text-right font-bold">
                  Amount to pay
                </th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const selection = selections[item.documentNumber]!;
                const issue = localIssue(item) ?? fieldErrors[item.documentNumber];
                const overdue = item.daysOverdue > 0;

                return (
                  <tr
                    key={item.documentNumber}
                    className={`border-t border-border ${overdue ? "bg-danger-subtle/40" : ""}`}
                  >
                    <td className="px-4 py-2.5">
                      <input
                        type="checkbox"
                        className="size-4 accent-primary"
                        checked={selection.selected}
                        aria-label={`Pay invoice ${item.documentNumber}`}
                        onChange={(event) =>
                          update(item.documentNumber, { selected: event.target.checked })
                        }
                      />
                    </td>
                    <td className="px-4 py-2.5 font-mono text-[12px] text-text">
                      {item.documentNumber}
                    </td>
                    <td className="px-4 py-2.5">
                      <span className="text-text-mid">{formatDisplayDate(item.dueDate)}</span>
                      {overdue ? (
                        <span className="ml-1.5 rounded-pill border border-danger-border bg-danger-subtle px-1.5 py-0.5 text-[11px] font-semibold text-danger">
                          {item.daysOverdue}d overdue
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Money value={item.openAmount} />
                    </td>
                    <td className="px-4 py-2.5 text-right">
                      <Input
                        type="number"
                        step="0.01"
                        min="0"
                        max={item.openAmount}
                        className="w-32 text-right"
                        disabled={!selection.selected}
                        invalid={Boolean(issue)}
                        aria-label={`Amount to pay against ${item.documentNumber}`}
                        value={selection.amount}
                        onChange={(event) =>
                          update(item.documentNumber, { amount: event.target.value })
                        }
                      />
                      {issue ? (
                        <p role="alert" className="mt-1 text-[11px] text-danger">
                          {issue}
                        </p>
                      ) : null}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      {/* --- Step 2: mode + summary --- */}
      <section className="rounded-md border border-border bg-surface p-4 shadow-sm">
        <h2 className="text-[13px] font-bold text-text">2 · How would you like to pay?</h2>

        <fieldset className="mt-3 grid gap-2 sm:grid-cols-2">
          <legend className="sr-only">Payment mode</legend>
          {PAYMENT_MODES.map((option) => (
            <label
              key={option.code}
              className={`flex cursor-pointer items-start gap-2 rounded-md border p-3 transition-colors ${
                mode === option.code
                  ? "border-primary bg-primary-subtle"
                  : "border-border hover:border-border-strong"
              }`}
            >
              <input
                type="radio"
                name="payment-mode"
                className="mt-0.5 size-4 accent-primary"
                checked={mode === option.code}
                onChange={() => setMode(option.code)}
              />
              <span>
                <span className="block text-[12.5px] font-semibold text-text">{option.label}</span>
                <span className="block text-[11.5px] text-text-dim">{option.hint}</span>
              </span>
            </label>
          ))}
        </fieldset>
      </section>

      {/* --- Step 3: confirm --- */}
      <section className="sticky bottom-0 rounded-md border border-border-strong bg-surface p-4 shadow-md">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="text-[11px] font-bold uppercase tracking-[0.8px] text-text-dim">
              {chosen.length === 0
                ? "Nothing selected"
                : `${chosen.length} ${chosen.length === 1 ? "invoice" : "invoices"} · ${currency}`}
            </p>
            <Money value={total} className="text-[18px] font-bold" />
          </div>

          <Button disabled={!canSubmit} onClick={() => void submit()}>
            {busy ? "Starting…" : "Continue to payment"}
          </Button>
        </div>

        {error ? (
          <p role="alert" className="mt-2 text-[12px] font-medium text-danger">
            {error}
          </p>
        ) : null}

        <p className="mt-2 text-[11px] text-text-dim">
          You&apos;ll confirm the payment with your bank or UPI app. Nothing is charged until you
          do, and your invoices are only marked settled once your bank confirms it to us.
        </p>
      </section>
    </div>
  );
}
