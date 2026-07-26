# services — stub

Per `docs/06-CLAUDE-CODE-KICKOFF-PROMPT.md`: business logic per module (`onboarding/`, `catalogue/`, `order/`, `delivery/`, `invoice/`, `payment/`, `support/`, `loyalty/`, `reporting/`), each exposing a typed service interface. Depends on `domain` + `adapters` + `db`; never on `ui` or `apps`.

Not yet built — no `package.json`, not a pnpm workspace member. The first module (`onboarding/`) arrives in Phase 2 (`docs/04-ROADMAP-ZERO-TO-PRODUCTION.md`), once the mock `SapAdapter` (Phase 1) exists for it to depend on.
