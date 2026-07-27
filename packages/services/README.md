# services

Business logic per module, each exposing a typed service interface. Depends on `domain` + `adapters` + `db` + `config`; never on `ui` or `apps`. Framework-free — no Next.js imports — so the service layer can move behind NestJS/Fastify without a rewrite (`docs/DECISIONS.md` ADR-002).

| Package                                                  | Status                                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| [`identity/`](./identity) — `@cc/service-identity`       | **Built (Phase 1).** Login, session tokens, tenant resolution, RBAC guards, dev seed.               |
| [`sap/`](./sap) — `@cc/service-sap`                      | **Built (Phase 1).** Per-tenant adapter resolution + the dashboard summary read.                    |
| [`onboarding/`](./onboarding) — `@cc/service-onboarding` | **Built (Phase 2).** The 4-step wizard, GSTIN verification, approval queue, BAPI customer creation. |
| [`catalogue/`](./catalogue) — `@cc/service-catalogue`    | **Built (Phase 3).** Browse, product detail, customer price list, and the cart.                     |
| `order/`                                                 | Phase 4                                                                                             |
| `invoice/`, `payment/`                                   | Phase 5                                                                                             |
| `delivery/`, `support/`, `loyalty/`, `reporting/`        | Phase 6                                                                                             |

Not-yet-built services have no `package.json` and are not workspace members.

## Adding a service

1. Copy the shape of `identity/`: `package.json` (name `@cc/service-<module>`), `tsconfig.json`, `eslint.config.js`, `vitest.config.ts`, `README.md`.
2. Depend on `@cc/domain` for types and registries, `@cc/adapter-*` for external systems, `@cc/db` for persistence. Wrap every DB call in `runWithTenant`.
3. Throw typed domain errors (see `identity/src/errors.ts`) carrying an HTTP status and user-safe copy — route handlers map them, they never invent messages.
4. Add it to `apps/web`'s dependencies and to `transpilePackages` in `next.config.mjs`.
