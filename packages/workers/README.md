# @cc/workers

The background layer: the outbox relay, the queue consumers, the SLA sweep, and reconciliation (docs/07 A1, A3 and B4, `docs/DECISIONS.md` ADR-022, ADR-023, ADR-029 and ADR-044).

**Nothing imports this package.** The boundary rules give `workers` the same treatment as `apps` — it may import `services`, `adapters`, `db`, `domain` and `config`, and nothing may import _from_ it. That is what stops queue work creeping back onto the request path, and it means the process can be deployed and scaled separately without any package following it.

Handlers here are the one place in the codebase allowed to touch two services in a single file. A service may never import another service (ADR-011); sequencing across modules is precisely what a worker is for, and it does it from above, passing adapters in — the same role a route handler plays for synchronous cross-service flows.

## How an event travels

```
service            @cc/db                @cc/workers                 @cc/workers
  │                  │                        │                           │
  ├─ db.$transaction ┤                        │                           │
  │   state change   │                        │                           │
  │   writeOutboxEvent ──> outbox_events      │                           │
  │                  │      (pending)         │                           │
  │                  │            relay sweep ┤                           │
  │                  │      claim → publish → mark published              │
  │                  │                        ├──> BullMQ queue           │
  │                  │                        │        job id = row id ──>├─ dispatchEvent
  │                  │                        │                           │   → registered handlers
```

The relay is deliberately **at-least-once**: it publishes, _then_ marks, so a crash in between republishes. The alternative would silently drop an event whenever the process died at the wrong moment — for a dispatch notification, that is a customer who is never told their goods shipped. Duplicates are handled instead: the BullMQ job id is the outbox row id, and **every handler must be idempotent**.

Tenancy: the relay never queries the outbox unscoped. It lists tenants (`Tenant` is not a tenant-owned model) and sweeps each inside `runWithTenant`, so the scoping extension applies exactly as it does on the request path.

## Public API

| Export                                                        | Purpose                                                                                           |
| ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `relayTenant(tenantId, options)`                              | One outbox sweep for one tenant. Reclaim → claim → publish → mark.                                |
| `relayOnce(options)`                                          | One sweep across every tenant, sequentially (a shared connection pool is not a place to fan out). |
| `startRelayLoop(options)`                                     | `relayOnce` on an interval, with `stop()`. A throwing sweep never kills the loop.                 |
| `registerHandler(name, handler)`                              | Register a consumer for a `DomainEventName`.                                                      |
| `dispatchEvent(name, payload, ctx)`                           | Run every handler for an event.                                                                   |
| `registeredQueues()`                                          | Which queues actually have work — what the process listens on.                                    |
| `createBullPublisher(connection)` / `createRedisConnection()` | The BullMQ side, behind the `EventPublisher` interface.                                           |
| `createQueueWorker(queue, connection)`                        | A BullMQ `Worker` that looks handlers up in the registry.                                         |
| `sweepSlaOnce(options)`                                       | One SLA sweep across every tenant; writes breach events to the outbox.                            |
| `startSlaSweepLoop(options)`                                  | `sweepSlaOnce` on an interval, with `stop()`.                                                     |
| `reconcileOnce(options)`                                      | One reconciliation pass: retries stuck payments and requeues failed outbox rows, per tenant.      |
| `startReconciliationLoop(options)`                            | `reconcileOnce` on an interval, with `stop()`.                                                    |

## Adding a consumer

1. Make sure the event is in `DOMAIN_EVENTS` (`packages/domain/src/events.ts`) with a Zod payload schema and a queue. Never a string literal.
2. Add `src/handlers/<thing>.ts` calling `registerHandler("<event>", …)`.
3. Import it from `src/handlers/index.ts` — that barrel is what the entrypoint loads, and a queue that starts before its handlers are registered treats real events as no-ops.
4. Make the handler idempotent. It **will** run twice.

An event with no handler is a deliberate no-op, not an error: the phase that emits an event lands before the phase that consumes it. A2 emitted the POD discrepancy with nothing listening; `handlers/support-auto-ticket.ts` is A3 closing that loop.

`handlers/notification-fanout.ts` is the exception to step 2, and deliberately so: it registers itself for **every event the `@cc/domain` notification registry has a template for**, in a loop. Eleven near-identical `registerHandler` calls would mean the twelfth template ships unwired, and the failure mode would be silence — no error, no job, no notification. Driving subscription from the registry makes "declared" and "delivered" the same fact (ADR-040). What a notification _is_ still belongs to `@cc/service-notification`; the handler only routes.

## The SLA sweep — the other kind of background work

The relay publishes facts a service already wrote. A **breach** is different in kind: a deadline passing with nothing happening produces no write at the moment it becomes true, so no transaction can record it. `sweepSlaOnce` asks instead — every tenant, every open ticket past its window — and writes the breach to the **outbox**, not to a queue. The sweep is a producer like any service, and ADR-023's rule that only the relay publishes to BullMQ holds for it too.

The interval is minutes, not seconds (`SLA_SWEEP_INTERVAL_MS`, default 60s). An SLA is measured in hours, so a breach noticed a minute late is indistinguishable from one noticed instantly, and a tighter tick would scan per tenant per second to learn that nothing changed. Idempotency is `SupportTicket.slaBreachedAt`, claimed by a conditional update in the same transaction as the event, so two overlapping sweeps cannot both report one breach.

## Reconciliation — the third kind of background work (docs/07 B4)

The relay publishes; the SLA sweep discovers; reconciliation **retries**. Every tick, `reconcileOnce` asks `@cc/service-payment` for every payment stuck `captured` (SAP hasn't confirmed the posting) or `initiated` with a gateway attempt (the webhook never arrived), and `@cc/service-reconciliation` for every outbox row the relay has already given up on. Both retries are the same idempotent operations a human clicking "Retry" in `/admin/exceptions` would trigger — `postCapturedPayment`/`getPayment` polling for a payment, `state: "pending"` for an outbox row — run on a schedule so most exceptions resolve themselves.

Two services, not one, because a service may not import another (ADR-011, ADR-027): `@cc/service-payment` owns the payment half, `@cc/service-reconciliation` owns the outbox half, and this worker is what sequences both (ADR-044).

The interval is minutes too (`RECONCILIATION_INTERVAL_MS`, default 5 minutes) — every exception it would retry is already visible in the admin tray, so a tighter tick only adds load against SAP and the gateway.

## Running it

```
docker compose -f ../../docker-compose.dev.yml up -d   # Postgres + Redis
cp .env.example .env
pnpm --filter @cc/workers start        # relay + consumers + SLA sweep + reconciliation in one process
pnpm --filter @cc/workers dev          # same, with reload
```

One process runs all four parts because at pilot scale separate processes would be separate things to deploy and monitor for no benefit. They are separate modules so that splitting them later is a change to `src/bin/worker.ts` and nothing else.

## How to test

```
pnpm --filter @cc/workers test              # registry + handler semantics; no infrastructure
pnpm --filter @cc/workers test:integration  # the relay, SLA sweep and reconciliation against real Postgres (no Redis needed)
```

The integration suite passes a fake `EventPublisher`, so claim/publish/mark, the crash-between-publish-and-mark republication, the reclaim of a dead relay's rows, and per-tenant scoping are all provable without standing up a broker. `support-flow.test.ts` carries a POD discrepancy the whole way — outbox row → relay → handler → ticket — and proves the handler raises exactly one ticket when the same event arrives twice. `reconciliation.test.ts` proves a captured-but-unposted payment gets retried once it is stale enough (and not before), and that a failed outbox row past its cooldown gets requeued while a fresh one is left alone.
