# adapters — stub

Per `docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md` and `docs/02-TRD-ARCHITECTURE.md` §4: `sap/` (the `SapAdapter` interface + `mock`/`ecc`/`s4` drivers + factory), plus `gstn/`, `einvoice/`, `eway/`, `payment-gateway/`, `notifications/` — each following the same interface-plus-mock pattern. Depends only on `domain`; adapters never import `services`.

Not yet built — no `package.json`, not a pnpm workspace member. `sap/mock` is the first thing built in Phase 1 (`docs/04-ROADMAP-ZERO-TO-PRODUCTION.md`) — the whole point being that product/module development never blocks on real SAP access.
