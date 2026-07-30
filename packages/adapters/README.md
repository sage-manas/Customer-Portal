# adapters

Every external system sits behind an interface here, with a mock implementation built first (`docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md`, mock-first rule). Adapters depend only on `domain` + `config`; **adapters never import services**.

| Package                                                           | Status                                                                                                                                                                                |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [`sap/`](./sap) — `@cc/adapter-sap`                               | **Built (Phase 1).** `SapAdapter` contract + `mock` driver (full simulation), `ecc`/`s4` skeletons, per-tenant factory.                                                               |
| [`gstn/`](./gstn) — `@cc/adapter-gstn`                            | **Built (Phase 2).** `GstnAdapter` contract + `mock` driver (seeded registry + deterministic synthesis), `api` skeleton, per-tenant factory.                                          |
| [`storage/`](./storage) — `@cc/adapter-storage`                   | **Built (Phase 2).** `ObjectStorage` contract + `memory`/`local` mock drivers, `s3` skeleton. See `docs/DECISIONS.md` ADR-012.                                                        |
| [`cache/`](./cache) — `@cc/adapter-cache`                         | **Built (A6).** `CacheStore` contract + `memory` driver (default) and `redis`. Fail-open by contract; keys cannot be built without a tenant. ADR-036.                                 |
| [`notifications/`](./notifications) — `@cc/adapter-notifications` | **Built (A7).** `NotificationSender` contract + `log` driver (default) and `email` (provider HTTPS). A send never throws for a delivery failure. WhatsApp joins when its driver does. |
| `einvoice/`                                                       | Phase 5 — IRN fetch/display.                                                                                                                                                          |
| `eway/`                                                           | Phase 6 — e-way bill fetch/display.                                                                                                                                                   |
| `payment-gateway/`                                                | Phase 5 — Razorpay first, behind a gateway abstraction.                                                                                                                               |

Not-yet-built adapters have no `package.json` and are not workspace members. Each follows the same shape as `sap/`: an interface, a mock implementation, real drivers behind a factory, typed errors, and a test-suite that doubles as the contract suite for the real drivers.
