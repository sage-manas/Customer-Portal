# @cc/service-onboarding

Customer onboarding (docs/03 Module 1, docs/05 §7.1) — the module that proves the whole Phase 2 vertical: **registry → validation → service → adapter → UI**.

Framework-free, like every `packages/services` module: no Next.js imports, every DB call inside `runWithTenant`, typed errors that route handlers map to status codes.

## Two audiences, two access models

- **Applicant** — has no portal user until their account is created at approval, so they hold an unguessable `draftToken` (32 random bytes, compared in constant time) instead of a session. See `docs/DECISIONS.md` ADR-009.
- **Reviewer** — has a session; the route handler checks `onboarding:review` / `onboarding:approve` before calling in.

Both go through `runWithTenant`, so another tenant's application is simply **not found** — 404, never 403.

## Public API

### Applicant

| Function                                             | Notes                                                                                            |
| ---------------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `startApplication(tenantId)`                         | Creates a draft; returns the token **once**. `toApplication` never carries it.                   |
| `getDraftApplication(tenantId, handle)`              |                                                                                                  |
| `saveStep(tenantId, handle, step, values)`           | Step schema (registry-derived) first, then cross-field rules on the _merged_ draft.              |
| `verifyApplicationGstin(tenantId, handle, gstn)`     | Stores the GSTN answer as evidence (ADR-010). An unverified GSTIN is a _state_, not an error.    |
| `uploadDocument` / `removeDocument` / `readDocument` | Through `@cc/adapter-storage`; one document per kind, re-upload replaces.                        |
| `submitApplication(tenantId, handle)`                | Full-schema validation + GSTIN evidence + duplicate guard, then `Submitted` → `PendingApproval`. |

### Back-office

| Function                                                    | Notes                                                                                                                 |
| ----------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------- |
| `listApplications(tenantId, filter)`                        | The approval queue.                                                                                                   |
| `getApplicationForReview(tenantId, id)`                     |                                                                                                                       |
| `requestMoreInfo(tenantId, id, { note, actorUserId })`      | `PendingApproval` → `Draft`, same record, same token.                                                                 |
| `rejectApplication(tenantId, id, { reasons, actorUserId })` | Reason mandatory (docs/05 §7.1).                                                                                      |
| `approveApplication(tenantId, id, decision, sap)`           | Calls `createCustomer` (BAPI/BP API), syncs KUNNR back, audits. **Takes the SAP adapter as a parameter** — see below. |

`approveApplication` returns `{ application, kunnr, contactEmail, legalEntityName }`; the route handler then calls `@cc/service-identity` to issue portal credentials. Splitting it that way is ADR-011.

## Why the SAP adapter is passed in

`services → services` is not an allowed dependency edge, and per-tenant SAP resolution lives in `@cc/service-sap`. Rather than duplicate that resolver, this service takes a `SapAdapter` — the same pattern `getDashboardSummary(adapter, kunnr)` already uses. GSTN and storage _are_ resolved here (`adapters.ts`), because this module owns them.

## Statuses

`Draft → Submitted → PendingApproval → Approved | Rejected`, with `PendingApproval → Draft` for "Request More Info" and `Rejected → Draft` for re-apply. The transition table is a registry in `@cc/domain` (`ONBOARDING_TRANSITIONS`); this service asks it rather than growing a `switch`.

## Errors

`OnboardingError` carries `code`, `status`, field-level `issues`, and `upstreamMessage` (raw SAP/GSTN text — logs and admin screens only, never shown to a customer).

`not_found` 404 · `invalid` 422 · `incomplete` 422 · `invalid_transition` 409 · `duplicate` 409 · `sap_rejected` 422 · `upstream_unavailable` 503

## Testing

```
pnpm --filter @cc/service-onboarding test              # pure units, no database
pnpm --filter @cc/service-onboarding test:integration  # full flow, needs Postgres
```

The integration suite needs `docker compose -f docker-compose.dev.yml up -d` and `pnpm --filter @cc/db db:push`. It covers the happy path, both unhappy GSTN paths, the duplicate guard, SAP rejection and outage, every decision action, and cross-tenant 404s on all of them.
