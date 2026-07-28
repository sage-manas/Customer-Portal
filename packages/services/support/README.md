# @cc/service-support

Service & Support — portal-owned tickets, the SLA clock, and the workbench the
tenant's back office works them from. Docs: `03-FUNCTIONAL-SPEC.md` Module 8,
`05-UI-UX-DESIGN.md` §7.8, `07-NEXT-PHASE-GUIDE.md` A3.

## What this module owns

Everything. Unlike orders, deliveries and invoices — where SAP owns the
document and the portal stores nothing (ADR-016) — a portal-native ticket has
no SAP counterpart to defer to. Doc 03 Screen 8.1 allows a tenant to run
either QM notifications or portal-native tickets; A3 builds the second, and
the QMEL path becomes a driver concern in Track C (ADR-028).

So this package reads and writes its own tables: `SupportTicket`,
`TicketComment`, `TicketAttachment`, `TicketCounter`. All tenant-scoped, all
in `TENANT_SCOPED_MODELS`, all covered by `pnpm --filter @cc/db test:isolation`.

What it does **not** own is any of the ticket's behaviour. SLA hours per
priority, category routing, which status may follow which and for whom, the
7-day reopen window, and the status timeline are all registry entries in
`@cc/domain` (`entities/support.ts`). There is no `switch` on a priority or a
status in this package, and there should never be one.

## The rules that hold here

- **The sold-to account is the security boundary.** Every customer-plane entry
  point takes the session's KUNNR; a mismatch is a **404**, never a 403
  (CLAUDE.md rule 5). A ticket belongs to the _account_, so a colleague on the
  same KUNNR sees it and may comment.
- **The tenant is the boundary in the back office.** An agent sees every
  account's tickets, which is why the workbench functions live in a separate
  file reachable only behind `support:resolve` — not behind a boolean flag on
  the customer functions, which is a boundary that can be passed the wrong way
  round.
- **Internal notes are excluded in the query, not in the screen.** `ticketSelect`
  takes a visibility and filters the comment relation, so a customer read never
  loads an internal comment (ADR-028). A customer session that asks to _write_
  one is refused, not silently downgraded.
- **Events go through the outbox, in the transaction that made them true**
  (ADR-023). `support.ticket.created` and `support.ticket.resolved` are written
  alongside the row they describe.

## Public API

Customer plane (`ticket-service.ts`):

| Function                                         | Purpose                                              |
| ------------------------------------------------ | ---------------------------------------------------- |
| `listTickets(ctx, {filter})`                     | The customer's list, newest activity first, + counts |
| `getTicket(ctx, id)`                             | One ticket with its thread — no internal notes       |
| `createTicket(ctx, input, {validateRelatedDoc})` | Raise; the related-doc check is injected             |
| `addCustomerComment(ctx, id, input)`             | Post to the thread                                   |
| `transitionTicketAsCustomer(ctx, id, to)`        | Close or reopen, per the transition registry         |
| `rateTicket(ctx, id, input)`                     | CSAT, once, after a resolution                       |
| `insertTicket(input)`                            | The single row-creating path, shared with the worker |

Back office (`workbench-service.ts`):

| Function                                | Purpose                                     |
| --------------------------------------- | ------------------------------------------- |
| `listWorkbench(ctx, query)`             | The queue, most-urgent-then-oldest first    |
| `getTicketForAgent(ctx, id)`            | One ticket including internal notes         |
| `assignTicket(ctx, id, userId \| null)` | Claim or return to the queue                |
| `transitionTicketAsAgent(ctx, id, to)`  | Start work, reopen, close                   |
| `resolveTicket(ctx, id, {resolution})`  | Resolve + emit `support.ticket.resolved`    |
| `addAgentComment(ctx, id, input)`       | Post; the only path that may write internal |

Async (`sla-service.ts`, `auto-ticket.ts`):

| Function                                    | Purpose                                                 |
| ------------------------------------------- | ------------------------------------------------------- |
| `sweepSlaBreaches(tenantId, opts)`          | Emits `support.sla.breached` for newly-breached tickets |
| `raiseDiscrepancyTicket(tenantId, payload)` | A2's POD discrepancy → a Delivery ticket, idempotent    |

Attachments (`attachment-service.ts`) mirror the signed-POD scan: upload
first, carry the storage key into the write. `describeAttachments` reads the
name, type and size back **from the store**, never from the client — the
client must not be able to assert facts about bytes it no longer controls.

### The `validateRelatedDoc` seam

A ticket may reference an order, delivery or invoice, and that reference is
checked against SAP. This package cannot resolve a `SapAdapter` — a service
may not import another service (ADR-011) — so the route handler passes a
validator in, exactly as the delivery module takes its adapter as a parameter.

## Why the SLA breach is swept, not emitted

A breach is a deadline passing with nothing happening: the one kind of fact no
transaction can produce, because there is no write at the moment it becomes
true. `sweepSlaBreaches` runs on a repeatable job in `@cc/workers` (ADR-029),
inverts each priority's window into an index range on `openedAt`, and claims
each breach with a conditional update so two overlapping sweeps cannot both
report it. `slaBreachedAt` is the idempotency and is cleared on reopen — a
reopened ticket is a fresh window that can genuinely breach again.

## Testing

```
pnpm --filter @cc/service-support test              # units — no database
pnpm --filter @cc/service-support test:integration  # the flow suite (needs Postgres)
```

Because the portal owns the whole document here, the integration suite is the
module's real test surface: raise → comment → assign → resolve → reopen →
rate, the SLA sweep across three priorities, the auto-ticket's idempotency,
and the three boundaries — cross-tenant, cross-customer, and the internal note
a customer must never see.

Start Postgres first:

```
docker compose -f docker-compose.dev.yml up -d
pnpm --filter @cc/db db:push
```
