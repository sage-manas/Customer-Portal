/**
 * Shared plumbing for the frontend-only stand-ins for `@cc/service-*`.
 *
 * Phase 1 of the /client -> /frontend migration is frontend-only, so none of
 * the real service packages came across: they reach Prisma, Redis, object
 * storage and the payment gateway. Each file next to this one re-implements
 * just the *reads and writes the migrated screens actually call*, over the
 * seeded SAP landscape in ../sap-mock plus the in-memory stores below.
 *
 * Two rules kept throughout, so the swap back is mechanical:
 *   1. Function names, parameter order and return shapes match the real
 *      service exactly — that is what lets every migrated page keep its
 *      original import lines untouched.
 *   2. Anything the portal *owns* (tickets, notifications, credit requests,
 *      onboarding applications, carts, drafts) lives in `demoStore` here
 *      rather than in Postgres.
 *
 * TODO(BACKEND):
 * Delete this file and repoint the `@cc/service-*` aliases in tsconfig.json
 * at the real workspace packages once the backend migration lands.
 */

import type { Permission, SessionClaims } from "@cc/domain";

import { MockSapAdapter, SEED_TODAY, type FreshnessClass, type SapAdapter } from "../sap-mock";

/** Everything in the demo is "live" — there is no cache to be stale against. */
export const DEMO_FRESHNESS: FreshnessClass = "live";

/**
 * The seeded landscape is frozen at this date (see sap-mock/mock/seed.ts), so
 * "today" has to be frozen with it — otherwise every seeded invoice reads as
 * years overdue and the aging buckets tell a story the seed never meant.
 */
export const DEMO_TODAY = SEED_TODAY;

export function demoSyncedAt(): string {
  return `${DEMO_TODAY}T09:15:00.000Z`;
}

/**
 * One adapter per process, not per request: the mock driver holds its
 * landscape in memory, and a fresh instance per call would drop an order the
 * customer had just placed. `globalThis` rather than a module-level `let`
 * because Next's dev server re-evaluates modules on hot reload.
 */
const globalForDemo = globalThis as typeof globalThis & {
  __ccDemoSap?: MockSapAdapter;
  __ccDemoStore?: DemoStore;
};

/**
 * Artificial SAP latency, in milliseconds.
 *
 * Defaults to 0 so the demo stays snappy, but QA and design review run with
 * CC_DEMO_SAP_LATENCY_MS set — without it the skeletons and pending states
 * never render long enough to be seen, let alone reviewed.
 */
const DEMO_LATENCY_MS = Number(process.env.CC_DEMO_SAP_LATENCY_MS ?? 0) || 0;

/** Forces every SAP call to fail, for exercising the §1 degradation path. */
const DEMO_SAP_DOWN = process.env.CC_DEMO_SAP_DOWN === "1";

export function demoSapAdapter(): SapAdapter {
  globalForDemo.__ccDemoSap ??= new MockSapAdapter({
    today: DEMO_TODAY,
    latencyMs: DEMO_LATENCY_MS,
    unavailable: DEMO_SAP_DOWN,
  });
  return globalForDemo.__ccDemoSap;
}

// ---------------------------------------------------------------------------
// Portal-owned state
// ---------------------------------------------------------------------------

/**
 * Rows the portal owns rather than reads from SAP. In /client each of these
 * is a Prisma table; here they are arrays that live as long as the server
 * process, which is enough for the whole demo to behave consistently within
 * a session (place an order, see it in the list, open it).
 *
 * TODO(BACKEND):
 * Every collection here maps to a table in packages/db/prisma/schema.prisma.
 */
export interface DemoStore {
  tickets: unknown[];
  ticketComments: unknown[];
  notifications: unknown[];
  creditRequests: unknown[];
  onboardingApplications: unknown[];
  orderDrafts: unknown[];
  inquiryDrafts: unknown[];
  carts: unknown[];
  payments: unknown[];
  podConfirmations: unknown[];
  customerAccounts: unknown[];
  outboxExceptions: unknown[];
  tenants: unknown[];
  operators: unknown[];
  counters: Record<string, number>;
}

export function demoStore(): DemoStore {
  globalForDemo.__ccDemoStore ??= {
    tickets: [],
    ticketComments: [],
    notifications: [],
    creditRequests: [],
    onboardingApplications: [],
    orderDrafts: [],
    inquiryDrafts: [],
    carts: [],
    payments: [],
    podConfirmations: [],
    customerAccounts: [],
    outboxExceptions: [],
    tenants: [],
    operators: [],
    counters: {},
  };
  return globalForDemo.__ccDemoStore;
}

/** Monotonic per-process counter, standing in for a DB sequence. */
export function nextSequence(key: string, start = 1): number {
  const store = demoStore();
  store.counters[key] = (store.counters[key] ?? start - 1) + 1;
  return store.counters[key];
}

export function demoId(prefix: string): string {
  return `${prefix}-${nextSequence(prefix).toString().padStart(4, "0")}`;
}

// ---------------------------------------------------------------------------
// Errors
// ---------------------------------------------------------------------------

/**
 * The shape every `*Error` in the service layer shares, so the migrated
 * `isXError(error)` guards and the `toXErrorResponse` mappers keep working.
 */
export class DemoServiceError extends Error {
  readonly status: number;
  readonly code: string;
  readonly issues?: Array<{ path: string; message: string }>;
  readonly upstreamMessage?: string;

  constructor(
    message: string,
    options: {
      status?: number;
      code?: string;
      issues?: Array<{ path: string; message: string }>;
      upstreamMessage?: string;
    } = {},
  ) {
    super(message);
    this.name = "DemoServiceError";
    this.status = options.status ?? 400;
    this.code = options.code ?? "demo_error";
    this.issues = options.issues;
    this.upstreamMessage = options.upstreamMessage;
  }
}

export function notFound(what: string): DemoServiceError {
  // 404 rather than 403 for a document that exists on another account — the
  // rule /client applies everywhere (CLAUDE.md rule 5, docs/05 §8).
  return new DemoServiceError(`${what} not found`, { status: 404, code: "not_found" });
}

/** Guard mirroring each service's `requireKunnr` / `requireAccount`. */
export function requireDemoKunnr(kunnr: string | undefined): string {
  if (!kunnr) {
    throw new DemoServiceError("No customer account is linked to this login.", {
      status: 403,
      code: "no_account",
    });
  }
  return kunnr;
}

/** The AuthError the migrated guards throw. */
export class DemoAuthError extends Error {
  readonly status: number;
  readonly code: string;

  constructor(message: string, status = 403, code = "forbidden") {
    super(message);
    this.name = "AuthError";
    this.status = status;
    this.code = code;
  }
}

export function assertPermission(
  session: SessionClaims | null,
  permission: Permission,
  has: (s: SessionClaims | null, p: Permission) => boolean,
): SessionClaims {
  if (!session) throw new DemoAuthError("Not authenticated", 401, "unauthenticated");
  if (!has(session, permission)) throw new DemoAuthError("Not permitted", 403, "forbidden");
  return session;
}
