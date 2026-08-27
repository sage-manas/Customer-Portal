"use client";

import { Button } from "@cc/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

// TODO(BACKEND): swap `demoFetch` back to `fetch` once /api/* is migrated.
import { demoFetch } from "@/lib/demo-fetch";

/**
 * Withdraw a credit-limit request that hasn't been decided.
 *
 * The button is only rendered for a pending request, but that is presentation
 * — the service asks `CREDIT_REQUEST_TRANSITIONS` whether the move is allowed,
 * so a stale page whose request has since been decided gets a plain refusal
 * rather than a silent second decision (docs/05 §4.3).
 */
export function WithdrawRequestButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function withdraw() {
    setBusy(true);
    setError(null);
    try {
      const response = await demoFetch(`/api/account/credit/requests/${requestId}/withdraw`, {
        method: "POST",
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        setError(body?.error ?? "We couldn't withdraw that request.");
        return;
      }
      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button type="button" variant="ghost" disabled={busy} onClick={() => void withdraw()}>
        {busy ? "Withdrawing…" : "Withdraw"}
      </Button>
      {error ? (
        <span role="alert" className="text-[11px] text-danger">
          {error}
        </span>
      ) : null}
    </div>
  );
}
