"use client";

import { Button } from "@cc/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * Gives one exception the same retry the automatic sweep would give it,
 * sooner (docs/07 B4). Nothing here decides an outcome — a captured payment
 * either posts or it doesn't, and a requeued outbox row either relays or
 * lands back in `failed`; the button only asks.
 */
export function RetryButton({ kind, id }: { kind: "payment" | "outbox"; id: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function retry() {
    setBusy(true);
    setError(null);

    try {
      const segment = kind === "payment" ? "payments" : "outbox";
      const response = await fetch(`/api/admin/exceptions/${segment}/${id}/retry`, {
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { error?: string } | null;

      if (!response.ok) {
        setError(body?.error ?? "That retry didn't go through.");
        return;
      }

      router.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={busy}
        onClick={() => void retry()}
      >
        {busy ? "Retrying…" : "Retry"}
      </Button>
      {error ? <span className="text-[11px] text-danger">{error}</span> : null}
    </div>
  );
}
