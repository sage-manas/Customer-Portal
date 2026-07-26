# adapters

Every external system sits behind an interface here, with a mock implementation built first (`docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md`, mock-first rule). Adapters depend only on `domain` + `config`; **adapters never import services**.

| Package                             | Status                                                                                                                  |
| ----------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| [`sap/`](./sap) — `@cc/adapter-sap` | **Built (Phase 1).** `SapAdapter` contract + `mock` driver (full simulation), `ecc`/`s4` skeletons, per-tenant factory. |
| `gstn/`                             | Phase 2 — GSTIN verification for the onboarding wizard.                                                                 |
| `einvoice/`                         | Phase 5 — IRN fetch/display.                                                                                            |
| `eway/`                             | Phase 6 — e-way bill fetch/display.                                                                                     |
| `payment-gateway/`                  | Phase 5 — Razorpay first, behind a gateway abstraction.                                                                 |
| `notifications/`                    | Phase 6 — email/SMS/WhatsApp.                                                                                           |

Not-yet-built adapters have no `package.json` and are not workspace members. Each follows the same shape as `sap/`: an interface, a mock implementation, real drivers behind a factory, typed errors, and a test-suite that doubles as the contract suite for the real drivers.
