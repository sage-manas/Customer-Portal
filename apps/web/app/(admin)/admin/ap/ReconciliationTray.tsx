import { listPaymentExceptions } from "@cc/service-payment";
import { listOutboxExceptions } from "@cc/service-reconciliation";
import { Badge, Money, relativeTime } from "@cc/ui";

import { RetryButton } from "./RetryButton";

/**
 * The exception tray (docs/07 B4, ADR-044), now a view inside the AP
 * workspace rather than a tab of its own (doc 09 §3.4, ADR-060).
 *
 * Two sources, not one table: a payment reconciliation is stuck on
 * (`@cc/service-payment`) and an outbox row the relay has given up on
 * (`@cc/service-reconciliation`). Neither package may import the other
 * (CLAUDE.md rule 1, ADR-011, ADR-027), so this component is what sequences
 * both reads — the same role a route handler plays for a flow spanning two
 * services.
 *
 * Most-severe-then-oldest, the same instinct as the ticket workbench: someone
 * opening this is asking "what needs me right now?", not "what happened most
 * recently?".
 */

type ExceptionRow =
  | {
      kind: "payment";
      id: string;
      label: string;
      severity: "warning" | "critical";
      ageMs: number;
      kunnr: string;
      status: string;
      amount: number;
      currency: string;
    }
  | {
      kind: "outbox";
      id: string;
      label: string;
      severity: "warning" | "critical";
      ageMs: number;
      eventName: string;
      queue: string;
      lastError: string | null;
    };

export async function ReconciliationTray({ tenantId }: { tenantId: string }) {
  const now = new Date();
  const [paymentExceptions, outboxExceptions] = await Promise.all([
    listPaymentExceptions(tenantId, now),
    listOutboxExceptions(tenantId, now),
  ]);

  const rows: ExceptionRow[] = [
    ...paymentExceptions.map((exception): ExceptionRow => ({
      kind: "payment",
      id: exception.paymentId,
      label: exception.exception.label,
      severity: exception.exception.severity,
      ageMs: exception.exception.ageMs,
      kunnr: exception.kunnr,
      status: exception.status,
      amount: exception.amount,
      currency: exception.currency,
    })),
    ...outboxExceptions.map((exception): ExceptionRow => ({
      kind: "outbox",
      id: exception.id,
      label: exception.exception.label,
      severity: exception.exception.severity,
      ageMs: exception.exception.ageMs,
      eventName: exception.eventName,
      queue: exception.queue,
      lastError: exception.lastError,
    })),
  ].sort((a, b) => {
    if (a.severity !== b.severity) return a.severity === "critical" ? -1 : 1;
    return b.ageMs - a.ageMs;
  });

  return (
    <>
      <p className="text-[12px] text-text-mid">
        Payments and outbox events reconciliation couldn&apos;t resolve on its own. Most of these
        clear themselves on the next automatic sweep — retry only if you need it sooner.
      </p>

      <div className="overflow-x-auto rounded-md border border-border bg-surface shadow-sm">
        <table className="w-full text-[12.5px]">
          <thead>
            <tr className="bg-background text-left text-[11px] uppercase tracking-wide text-text-dim">
              <th scope="col" className="px-4 py-2 font-bold">
                Exception
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Detail
              </th>
              <th scope="col" className="px-4 py-2 font-bold">
                Age
              </th>
              <th scope="col" className="px-4 py-2 font-bold" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-4 py-12 text-center text-[12.5px] text-text-dim">
                  Nothing needs attention. Every payment has posted and every event has relayed.
                </td>
              </tr>
            ) : (
              rows.map((row) => (
                <tr key={`${row.kind}:${row.id}`} className="border-t border-border">
                  <td className="px-4 py-2.5 align-top">
                    <Badge variant={row.severity === "critical" ? "danger" : "warning"}>
                      {row.label}
                    </Badge>
                  </td>
                  <td className="px-4 py-2.5 align-top text-text-mid">
                    {row.kind === "payment" ? (
                      <>
                        <span className="font-mono text-[11px]">{row.kunnr}</span> ·{" "}
                        <Money value={row.amount} className="text-[12.5px]" /> · {row.status}
                      </>
                    ) : (
                      <>
                        <span className="font-mono text-[11px]">{row.eventName}</span> on{" "}
                        {row.queue}
                        {row.lastError ? (
                          <span className="mt-0.5 block text-[11px] text-danger">
                            {row.lastError}
                          </span>
                        ) : null}
                      </>
                    )}
                  </td>
                  <td className="px-4 py-2.5 align-top tabular-nums text-text-mid">
                    {relativeTime(new Date(now.getTime() - row.ageMs), now)}
                  </td>
                  <td className="px-4 py-2.5 align-top">
                    <RetryButton kind={row.kind} id={row.id} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
