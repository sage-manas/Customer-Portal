# Runbook: outbox/queue backlog

## What's actually queued here

There is exactly one producer of async work in this codebase: a service
calls `writeOutboxEvent` (`@cc/db`) inside the same transaction that made
the effect true (ADR-023), and `packages/workers` is the only thing that
ever touches BullMQ. A "queue backlog" always means one of two things:

1. **The outbox relay is behind** — rows sit `pending` longer than usual
   before a worker claims them and pushes them to BullMQ.
2. **A BullMQ queue itself is backed up** — jobs are enqueued but consumers
   aren't keeping pace (worker process down, or a slow/failing handler).

## Diagnosing which

- the AP workspace's Reconciliation tab (`/admin/ap?tab=reconciliation`, `exceptions:view`) shows outbox rows in `failed`
  state — a row lands there only after exhausting `OUTBOX_MAX_ATTEMPTS`
  (default 5), so a _growing_ `failed` count means handlers are erroring,
  not just running slowly.
- A growing `pending` count with few/no `failed` rows means the relay loop
  itself is either not running (`packages/workers` process is down — check
  it's actually up: `pnpm --filter @cc/workers start`) or is falling behind
  real-time (`OUTBOX_POLL_INTERVAL_MS`/`OUTBOX_BATCH_SIZE` too conservative
  for current volume).
- Redis reachability: if `packages/workers` can't reach Redis at all, rows
  stay `pending` indefinitely and the process logs will say so on every
  poll — check `REDIS_URL` and `docker compose -f docker-compose.dev.yml ps`.

## What degrades, and what doesn't, while the queue is behind

Nothing on the request path depends on the queue draining promptly — this
is the entire point of the outbox pattern (ADR-023). Specifically:

- **Orders, deliveries, invoices, payments, tickets**: unaffected. None of
  their core read/write paths wait on an outbox row being relayed.
- **Notifications** (`@cc/adapter-notifications`) are delayed exactly as
  long as the backlog — a customer's bell/email for "your order shipped"
  arrives late rather than not at all, once the relay catches up (events
  are never dropped, only delayed; `dedupeKey` makes a late-relayed event
  as safe as an on-time one).
- **`support.sla.breached`** notifications specifically: these come from a
  _separate_ sweep (`packages/workers`'s SLA loop, not the outbox relay) —
  a queue backlog does not delay the SLA sweep discovering a breach, only
  the _notification_ about one already discovered and written to the
  outbox.
- **Auto-raised support tickets** (POD discrepancy → ticket, A3's consumer
  of A2's event): delayed, not lost — `sourceKey`'s uniqueness means the
  eventual relay still produces exactly one ticket, however late.

## Recovering

1. **Confirm the worker process is actually running** before anything
   else — `pnpm --filter @cc/workers start` (or check your process
   supervisor). A backlog with the worker down is not a queue-tuning
   problem, it's a "restart the process" problem.
2. **`failed` rows**: `requeueOutboxEvent`/`requeueStaleFailedOutboxEvents`
   (`@cc/service-reconciliation`) give a row exactly one more attempt
   without resetting its `attempts` counter (ADR-044's reasoning) — either
   via `/admin/ap` (Reconciliation)'s manual retry or the automatic sweep on
   `RECONCILIATION_INTERVAL_MS`. If the same event keeps failing after a
   requeue, the underlying handler has a real bug — read `lastError` on the
   row, don't just keep requeuing it.
3. **Once the backlog clears**: no backfill step is needed anywhere. Every
   consumer in this codebase is written to be idempotent under at-least-once
   delivery (ADR-023's requirement), so a relay that's caught up has already
   produced the correct end state — there is no "replay the last N hours"
   operation to run.

## Never do this

Do not delete `pending`/`failed` outbox rows to "clear" a backlog metric.
A deleted row is a notification, an auto-ticket, or a payment-posting retry
that silently never happens — worse than a visible backlog, which at least
shows up in `/admin/ap` (Reconciliation) and this runbook's diagnostics.
