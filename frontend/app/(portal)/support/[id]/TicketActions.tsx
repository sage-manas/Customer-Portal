"use client";

import type { TicketStatus } from "@cc/domain";
import { Button, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * What the customer can do to a ticket (docs/05 §7.8): reply, close, reopen,
 * and rate the resolution.
 *
 * Which buttons exist is decided on the server from
 * `availableTicketTransitions(status, "customer")` and `canReopenTicket` —
 * this component renders the answer. It cannot offer a move the API would
 * refuse, because it is not the thing deciding.
 */

export interface TicketActionsProps {
  ticketId: string;
  /** Server-computed from the transition registry, actor `customer`. */
  transitions: ReadonlyArray<{ to: TicketStatus; label: string }>;
  canComment: boolean;
  canRate: boolean;
}

export function TicketActions({ ticketId, transitions, canComment, canRate }: TicketActionsProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [rating, setRating] = useState(0);
  const [ratingComment, setRatingComment] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function post(url: string, payload: unknown) {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      if (!response.ok) {
        const answer = (await response.json().catch(() => ({}))) as { error?: string };
        setError(answer.error ?? "That didn't work. Try again in a moment.");
        return false;
      }
      router.refresh();
      return true;
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      {error ? (
        <p
          role="alert"
          className="rounded-md border border-danger-border bg-danger-subtle px-4 py-2.5 text-[12.5px] text-danger"
        >
          {error}
        </p>
      ) : null}

      {canComment ? (
        <form
          className="flex flex-col gap-2"
          onSubmit={async (event) => {
            event.preventDefault();
            const ok = await post(`/api/support/${ticketId}/comments`, { body });
            if (ok) setBody("");
          }}
        >
          <label className="text-[12.5px] font-semibold text-text" htmlFor="reply">
            Add a reply
          </label>
          <Textarea
            id="reply"
            value={body}
            onChange={(e) => setBody(e.target.value)}
            rows={4}
            maxLength={2000}
            required
          />
          <div>
            <Button type="submit" size="sm" disabled={busy || body.trim().length === 0}>
              Post reply
            </Button>
          </div>
        </form>
      ) : null}

      {canRate ? (
        <form
          className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
          onSubmit={async (event) => {
            event.preventDefault();
            await post(`/api/support/${ticketId}/rating`, {
              rating,
              comment: ratingComment || undefined,
            });
          }}
        >
          <span className="text-[12.5px] font-semibold text-text">
            How did we do? <span className="font-normal text-text-dim">(you can rate once)</span>
          </span>
          <div role="radiogroup" aria-label="Rate the resolution" className="flex gap-1.5">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                role="radio"
                aria-checked={rating === value}
                aria-label={`${value} out of 5`}
                onClick={() => setRating(value)}
                className={
                  rating >= value
                    ? "size-8 rounded-md border border-accent-support bg-accent-support/10 text-[12.5px] font-semibold text-accent-support"
                    : "size-8 rounded-md border border-border bg-surface text-[12.5px] text-text-dim hover:bg-primary-subtle"
                }
              >
                {value}
              </button>
            ))}
          </div>
          <Textarea
            value={ratingComment}
            onChange={(e) => setRatingComment(e.target.value)}
            rows={2}
            maxLength={1000}
            placeholder="Anything else? (optional)"
            aria-label="Rating comment"
          />
          <div>
            <Button type="submit" size="sm" variant="secondary" disabled={busy || rating === 0}>
              Submit rating
            </Button>
          </div>
        </form>
      ) : null}

      {transitions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {transitions.map((transition) => (
            <Button
              key={transition.to}
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() => void post(`/api/support/${ticketId}/status`, { to: transition.to })}
            >
              {transition.label}
            </Button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
