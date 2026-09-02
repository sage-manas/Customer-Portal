"use client";

import type { TicketStatus } from "@cc/domain";
import { Button, Textarea } from "@cc/ui";
import { useRouter } from "next/navigation";
import { useState } from "react";

/**
 * What an agent can do to a ticket (docs/05 §7.8, docs/03 Screen 8.2).
 *
 * Three things worth pointing at:
 *
 * **Resolving asks for the text.** Doc 03 requires resolution notes, and the
 * customer's 7-day reopen window and CSAT prompt both start from the
 * resolution — so Resolve opens a box rather than firing a status change, and
 * the API refuses `to: "resolved"` without it either way.
 *
 * **The internal toggle is right next to the reply box, not hidden.** An agent
 * posts both kinds from the same place, and the thread renders internal notes
 * as dashed amber so a glance can tell them apart. A toggle somewhere else is
 * how a note meant for the team ends up in front of the customer.
 *
 * **Which buttons exist comes from the server**, computed by
 * `availableTicketTransitions(status, "agent")`.
 */

export interface AgentPanelProps {
  ticketId: string;
  transitions: ReadonlyArray<{ to: TicketStatus; label: string }>;
  canResolve: boolean;
  assigned: boolean;
}

export function AgentPanel({ ticketId, transitions, canResolve, assigned }: AgentPanelProps) {
  const router = useRouter();
  const [body, setBody] = useState("");
  const [internal, setInternal] = useState(false);
  const [resolution, setResolution] = useState("");
  const [resolving, setResolving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function send(url: string, payload: unknown, method = "POST") {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(url, {
        method,
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

      <form
        className="flex flex-col gap-2"
        onSubmit={async (event) => {
          event.preventDefault();
          const ok = await send(`/api/admin/tickets/${ticketId}/comments`, { body, internal });
          if (ok) setBody("");
        }}
      >
        <label className="text-[12.5px] font-semibold text-text" htmlFor="agent-reply">
          Reply
        </label>
        <Textarea
          id="agent-reply"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          maxLength={2000}
          required
        />
        <label className="flex items-center gap-2 text-[12px] text-text-mid">
          <input
            type="checkbox"
            checked={internal}
            onChange={(e) => setInternal(e.target.checked)}
            className="size-3.5 accent-warning"
          />
          Internal note — the customer will not see this
        </label>
        <div>
          <Button type="submit" size="sm" disabled={busy || body.trim().length === 0}>
            {internal ? "Post internal note" : "Send reply"}
          </Button>
        </div>
      </form>

      {canResolve ? (
        resolving ? (
          <form
            className="flex flex-col gap-2 rounded-md border border-border bg-background p-3"
            onSubmit={async (event) => {
              event.preventDefault();
              const ok = await send(`/api/admin/tickets/${ticketId}/status`, {
                to: "resolved",
                resolution,
              });
              if (ok) {
                setResolving(false);
                setResolution("");
              }
            }}
          >
            <label className="text-[12.5px] font-semibold text-text" htmlFor="resolution">
              What was done?{" "}
              <span className="font-normal text-text-dim">(the customer reads this)</span>
            </label>
            <Textarea
              id="resolution"
              value={resolution}
              onChange={(e) => setResolution(e.target.value)}
              rows={3}
              maxLength={2000}
              required
            />
            <div className="flex gap-2">
              <Button type="submit" size="sm" disabled={busy}>
                Resolve ticket
              </Button>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setResolving(false)}
                disabled={busy}
              >
                Cancel
              </Button>
            </div>
          </form>
        ) : (
          <div>
            <Button type="button" size="sm" onClick={() => setResolving(true)} disabled={busy}>
              Resolve
            </Button>
          </div>
        )
      ) : null}

      <div className="flex flex-wrap gap-2">
        {transitions
          // Resolve has its own form above; leaving it in this row would offer
          // a one-click resolve the API refuses for want of the notes.
          .filter((transition) => transition.to !== "resolved")
          .map((transition) => (
            <Button
              key={transition.to}
              type="button"
              size="sm"
              variant="secondary"
              disabled={busy}
              onClick={() =>
                void send(`/api/admin/tickets/${ticketId}/status`, { to: transition.to })
              }
            >
              {transition.label}
            </Button>
          ))}

        <Button
          type="button"
          size="sm"
          variant="secondary"
          disabled={busy}
          onClick={() =>
            void send(
              `/api/admin/tickets/${ticketId}`,
              // "@me" rather than a user id: the API resolves it from the
              // session, so a client can never assign a ticket to someone it
              // has merely named.
              { assigneeUserId: assigned ? null : "@me" },
              "PATCH",
            )
          }
        >
          {assigned ? "Return to queue" : "Assign to me"}
        </Button>
      </div>
    </div>
  );
}
