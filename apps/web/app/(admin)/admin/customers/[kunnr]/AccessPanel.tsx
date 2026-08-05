"use client";

import { Button, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import * as React from "react";

/**
 * Deactivate / reactivate a customer's portal access (ADR-057).
 *
 * The confirmation lists what actually happens, including the unflattering
 * part — the same standard ADR-054 set for the console's tenant dialog. A
 * confirmation that overstated the immediacy would be believed by exactly
 * the person who most needs it to be accurate.
 */
export function AccessPanel({
  kunnr,
  legalEntityName,
  isActive,
  deactivationReason,
}: {
  kunnr: string;
  legalEntityName: string;
  isActive: boolean;
  deactivationReason?: string;
}) {
  const router = useRouter();
  const [confirming, setConfirming] = React.useState(false);
  const [typed, setTyped] = React.useState("");
  const [reason, setReason] = React.useState("");
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState(false);

  async function setActive(next: boolean) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`/api/admin/customers/${kunnr}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isActive: next, reason: reason.trim() || undefined }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "That didn't work. Try again.");
        return;
      }
      setConfirming(false);
      setTyped("");
      setReason("");
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
    } finally {
      setBusy(false);
    }
  }

  if (isActive) {
    return (
      <div className="flex flex-col gap-3">
        {!confirming ? (
          <>
            <p className="text-[12.5px] text-text-mid">
              This customer can sign in and place orders.
            </p>
            <div>
              <Button variant="destructive" onClick={() => setConfirming(true)}>
                Deactivate portal access
              </Button>
            </div>
          </>
        ) : (
          <>
            <ul className="flex list-disc flex-col gap-1.5 pl-4 text-[12.5px] text-text-mid">
              <li>Everyone signing in for {legalEntityName} is refused at the sign-in screen.</li>
              <li>
                <strong>
                  Sessions already open keep working until their token expires, up to 30 minutes.
                </strong>{" "}
                This is not a remote sign-out — the middleware runs on the edge with no database and
                cannot make it one.
              </li>
              <li>New orders and quotation acceptances are refused immediately.</li>
              <li>
                Nothing is deleted. Orders, deliveries, invoices and payments stay exactly as they
                are — they are this portal&apos;s side of documents SAP has already posted.
              </li>
              <li>Nothing changes in SAP. The customer master stays active and billable.</li>
            </ul>

            <Textarea
              value={reason}
              onChange={(event) => setReason(event.currentTarget.value)}
              placeholder="Why? (optional — recorded on the account, never shown to the customer)"
              rows={2}
            />

            <label className="flex flex-col gap-1 text-[11.5px] text-text-mid">
              Type the customer number <span className="font-mono">{kunnr}</span> to confirm:
              <input
                value={typed}
                onChange={(event) => setTyped(event.currentTarget.value)}
                className="rounded-md border border-border bg-surface px-2 py-1.5 font-mono text-[12.5px]"
              />
            </label>

            {error ? (
              <p role="alert" className="text-[12.5px] text-danger">
                {error}
              </p>
            ) : null}

            <div className="flex gap-2">
              <Button
                variant="destructive"
                loading={busy}
                disabled={typed !== kunnr}
                onClick={() => void setActive(false)}
              >
                Deactivate
              </Button>
              <Button variant="secondary" onClick={() => setConfirming(false)}>
                Cancel
              </Button>
            </div>
          </>
        )}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-3">
      <p className="text-[12.5px] text-text-mid">
        Portal access is switched off. The customer&apos;s documents are untouched and SAP is
        unaffected.
        {deactivationReason ? ` Reason recorded: “${deactivationReason}”.` : ""}
      </p>
      {error ? (
        <p role="alert" className="text-[12.5px] text-danger">
          {error}
        </p>
      ) : null}
      <div>
        <Button loading={busy} onClick={() => void setActive(true)}>
          Reactivate portal access
        </Button>
      </div>
    </div>
  );
}
