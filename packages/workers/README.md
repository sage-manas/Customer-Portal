# @cc/workers

The background layer: the outbox relay and the queue consumers (docs/07 A1, `docs/DECISIONS.md` ADR-022 and ADR-023).

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

## Adding a consumer

1. Make sure the event is in `DOMAIN_EVENTS` (`packages/domain/src/events.ts`) with a Zod payload schema and a queue. Never a string literal.
2. Add `src/handlers/<thing>.ts` calling `registerHandler("<event>", …)`.
3. Import it from `src/handlers/index.ts` — that barrel is what the entrypoint loads, and a queue that starts before its handlers are registered treats real events as no-ops.
4. Make the handler idempotent. It **will** run twice.

An event with no handler is a deliberate no-op, not an error: the phase that emits an event lands before the phase that consumes it (A2 emits the POD discrepancy, A3 turns it into a ticket).

## Running it

```
docker compose -f ../../docker-compose.dev.yml up -d   # Postgres + Redis
cp .env.example .env
pnpm --filter @cc/workers start        # relay + consumers in one process
pnpm --filter @cc/workers dev          # same, with reload
```

One process runs both halves because at pilot scale two would be two things to deploy and monitor for no benefit. They are separate modules so that splitting them later is a change to `src/bin/worker.ts` and nothing else.

## How to test

```
pnpm --filter @cc/workers test              # registry + handler semantics; no infrastructure
pnpm --filter @cc/workers test:integration  # the relay against real Postgres (no Redis needed)
```

The integration suite passes a fake `EventPublisher`, so claim/publish/mark, the crash-between-publish-and-mark republication, the reclaim of a dead relay's rows, and per-tenant scoping are all provable without standing up a broker.
