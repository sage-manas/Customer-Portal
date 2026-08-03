# @cc/service-reconciliation

Outbox exception queue — docs/07 B4, docs/DECISIONS.md ADR-044.

## Purpose

The outbox half of B4's "reconciliation & exception queues". `@cc/service-payment` can't be reached from here and this package can't be reached from there — a service may not import another service (CLAUDE.md rule 1, ADR-011, ADR-027) — so payment exceptions (`listPaymentExceptions`, `reconcilePayment`) stay in `@cc/service-payment`, and this package owns only the outbox side: an `OutboxEvent` row the relay has already given up on after `OUTBOX_MAX_ATTEMPTS` (ADR-023), the state A1 added specifically "for docs/07 B4's exception tray".

Nothing new is stored. `OutboxEvent.state` already carries `failed`; this package composes that on every read (`@cc/domain`'s `classifyOutboxException`), the same "no projection table" instinct as `@cc/service-reporting` (ADR-037).

## Public API

```ts
import {
  listOutboxExceptions,
  requeueOutboxEvent,
  requeueStaleFailedOutboxEvents,
  type OutboxException,
} from "@cc/service-reconciliation";
```

- `listOutboxExceptions(tenantId, now?)` — every `failed` row in the tenant, oldest first, for the `/admin/exceptions` tray.
- `requeueOutboxEvent(tenantId, eventId)` — a human's manual retry: moves one `failed` row back to `pending` for the relay's next sweep. Returns `false` if the row wasn't `failed`.
- `requeueStaleFailedOutboxEvents(tenantId, { now?, cooldownMs? })` — the automatic half, called by `@cc/workers`' reconciliation loop: requeues every `failed` row older than the cooldown (default 30 minutes), on the theory that the upstream outage that failed it may have resolved since.

Requeuing never resets `attempts`. A row given one more shot fails again after a single attempt if the cause hasn't cleared, landing back in `failed` rather than spinning through all five attempts again — that is deliberate, not a bug: see `classifyOutboxException` in `@cc/domain` for why a `failed` row is an exception the instant it's reached, with no "still in flight" reading.

## Testing

```
pnpm --filter @cc/service-reconciliation test              # none yet — everything here needs a database
pnpm --filter @cc/service-reconciliation test:integration   # needs Postgres
```
