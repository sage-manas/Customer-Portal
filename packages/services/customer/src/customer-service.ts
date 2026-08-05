import {
  earliestSyncedAt,
  isSapError,
  leastFresh,
  sapRead,
  type SapAdapter,
  type SapRead,
} from "@cc/adapter-sap";
import { db, getTenantId, isCustomerAccountActive, runWithTenant } from "@cc/db";
import type {
  CanonicalCustomer,
  CustomerAccountSummary,
  CustomerEditInput,
  CustomerPatch,
} from "@cc/domain";
import { customerAccountBlock, customerAccountStatus, customerEditSchema } from "@cc/domain";
import type { z } from "zod";

import { CustomerError } from "./errors";

/**
 * The tenant's customer directory (doc 09 §3.4, Phase 5) — `/admin/customers`.
 *
 * Two systems own the answer between them, and the split is the whole design
 * (ADR-057):
 *
 *  - **SAP owns the customer master.** Name, address, contact, GSTIN and PAN
 *    are read per request through the adapter and carry their freshness, as
 *    ADR-016 requires of everything SAP owns. Nothing about them is stored
 *    here, so a name changed in XD02 is right on this screen immediately and
 *    there is no sync job to be behind.
 *  - **The portal owns whether the account may use the portal.** That is one
 *    boolean SAP has nowhere to put, so `CustomerAccount` stores it — plus
 *    the deactivation trail and who registered the customer.
 *
 * The adapter is passed in rather than resolved here, as everywhere else: it
 * belongs to `@cc/service-sap` and a service may not import another
 * (ADR-011).
 *
 * Every function is tenant-scoped, and the KUNNR boundary answers **404**:
 * a customer of another tenant is indistinguishable from one that does not
 * exist (CLAUDE.md rule 5).
 */

export interface ListCustomersFilter {
  /** Matches legal entity name, KUNNR, GSTIN or contact email. */
  search?: string;
  status?: "Active" | "Deactivated";
}

export interface CustomerAccountDetail {
  summary: CustomerAccountSummary;
  /** The SAP master, absent when SAP could not be reached for this account. */
  customer?: CanonicalCustomer;
  /** Freshness of that read, for `SapSyncIndicator`; absent with the master. */
  freshness?: SapRead<CanonicalCustomer>["freshness"];
  syncedAt?: string;
  users: CustomerAccountUser[];
  deactivatedByUserId?: string;
  registeredByUserId?: string;
  onboardingApplicationId?: string;
}

export interface CustomerAccountUser {
  id: string;
  email: string;
  isActive: boolean;
  lastLoginAt?: Date;
}

interface AccountRow {
  sapKunnr: string;
  isActive: boolean;
  deactivatedAt: Date | null;
  deactivatedByUserId: string | null;
  deactivationReason: string | null;
  registeredByUserId: string | null;
  onboardingApplicationId: string | null;
  createdAt: Date;
}

// ---------------------------------------------------------------------------
// Internals
// ---------------------------------------------------------------------------

async function audit(
  action: string,
  kunnr: string,
  options: { actorUserId?: string; metadata?: Record<string, unknown> } = {},
): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: getTenantId(),
      actorUserId: options.actorUserId,
      action,
      entityType: "CustomerAccount",
      entityId: kunnr,
      metadata: options.metadata ?? {},
    },
  });
}

/**
 * Reads one customer master, or `undefined` when SAP cannot answer for it.
 *
 * A directory that 500s because one account is missing in SAP would be
 * useless exactly when it is needed — the screen still has to show which
 * accounts exist and which are switched off. So an unreadable master is a
 * row without a name, not a failed page; `getCustomerAccount` is where a
 * caller asking about one specific customer gets the error instead.
 */
async function readMaster(
  sap: SapAdapter,
  kunnr: string,
): Promise<SapRead<CanonicalCustomer> | undefined> {
  try {
    return await sap.getCustomer(kunnr);
  } catch {
    return undefined;
  }
}

function toSummary(
  row: AccountRow,
  master: CanonicalCustomer | undefined,
  userCount: number,
): CustomerAccountSummary {
  return {
    kunnr: row.sapKunnr,
    legalEntityName: master?.legalEntityName ?? "",
    gstin: master?.tax.gstin,
    city: master?.address.city,
    state: master?.address.region,
    contactEmail: master?.contact.email,
    status: customerAccountStatus(row.isActive),
    origin: row.registeredByUserId ? "back_office" : "self_registered",
    userCount,
    registeredAt: row.createdAt,
    deactivatedAt: row.deactivatedAt ?? undefined,
    deactivationReason: row.deactivationReason ?? undefined,
  };
}

function matchesSearch(summary: CustomerAccountSummary, search: string): boolean {
  const needle = search.trim().toLowerCase();
  if (needle.length === 0) return true;
  return [summary.legalEntityName, summary.kunnr, summary.gstin, summary.contactEmail].some(
    (value) => value?.toLowerCase().includes(needle),
  );
}

async function userCounts(kunnrs: string[]): Promise<Map<string, number>> {
  if (kunnrs.length === 0) return new Map();
  const links = await db.userAccountLink.findMany({
    where: { sapKunnr: { in: kunnrs } },
    select: { sapKunnr: true },
  });

  const counts = new Map<string, number>();
  for (const link of links) counts.set(link.sapKunnr, (counts.get(link.sapKunnr) ?? 0) + 1);
  return counts;
}

async function loadAccount(kunnr: string): Promise<AccountRow> {
  const row = await db.customerAccount.findFirst({ where: { sapKunnr: kunnr } });
  // The tenant-scoped extension has already narrowed this, so another
  // tenant's customer is simply not here.
  if (!row) throw new CustomerError("not_found");
  return row;
}

/**
 * Registry values -> the adapter's patch shape.
 *
 * Exported so it can be tested without a database, and because this is the
 * one place the portal's field names (`state`, `pinCode` — the applicant's
 * words) meet the canonical customer's (`region`, `postalCode` — SAP's). A
 * second translation of that pair elsewhere is how a portal edit comes to
 * write a PIN code into a region.
 */
export function toCustomerPatch(values: CustomerEditInput & Record<string, string>): CustomerPatch {
  return {
    tradeName: values.tradeName,
    address: {
      street: values.street,
      city: values.city,
      region: values.state,
      postalCode: values.pinCode,
      country: values.country,
    },
    contact: {
      contactPerson: values.contactPerson,
      email: values.email,
      phone: values.phone,
    },
  };
}

function issuesFromZod(error: z.ZodError): { field: string; message: string }[] {
  return error.issues.map((issue) => ({
    field: String(issue.path[0] ?? ""),
    message: issue.message,
  }));
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

/**
 * The directory. One SAP read per account, in parallel, and the list carries
 * the *weakest* freshness of the reads behind it — a row served from cache
 * makes the whole list "as of" that moment, and saying otherwise would be
 * the dishonesty ADR-007 exists to prevent.
 */
export async function listCustomerAccounts(
  tenantId: string,
  sap: SapAdapter,
  filter: ListCustomersFilter = {},
): Promise<SapRead<CustomerAccountSummary[]>> {
  return runWithTenant(tenantId, async () => {
    const rows = await db.customerAccount.findMany({ orderBy: { createdAt: "desc" } });
    const counts = await userCounts(rows.map((row) => row.sapKunnr));

    const masters = await Promise.all(rows.map((row) => readMaster(sap, row.sapKunnr)));

    const summaries = rows
      .map((row, index) => toSummary(row, masters[index]?.data, counts.get(row.sapKunnr) ?? 0))
      .filter((summary) => (filter.status ? summary.status === filter.status : true))
      .filter((summary) => (filter.search ? matchesSearch(summary, filter.search) : true));

    const reads = masters.filter((read): read is SapRead<CanonicalCustomer> => read !== undefined);
    // No accounts, or none readable: the list is honestly empty rather than
    // claiming a freshness no read supports.
    if (reads.length === 0) return sapRead(summaries, "stale", new Date(0));

    return sapRead(summaries, leastFresh(reads), new Date(earliestSyncedAt(reads)));
  });
}

export async function getCustomerAccount(
  tenantId: string,
  kunnr: string,
  sap: SapAdapter,
): Promise<CustomerAccountDetail> {
  return runWithTenant(tenantId, async () => {
    const row = await loadAccount(kunnr);
    const master = await readMaster(sap, kunnr);

    const users = await db.user.findMany({
      where: { accountLinks: { some: { sapKunnr: kunnr } } },
      select: { id: true, email: true, isActive: true, lastLoginAt: true },
      orderBy: { email: "asc" },
    });

    return {
      summary: toSummary(row, master?.data, users.length),
      customer: master?.data,
      freshness: master?.freshness,
      syncedAt: master?.syncedAt,
      users: users.map((user) => ({
        id: user.id,
        email: user.email,
        isActive: user.isActive,
        lastLoginAt: user.lastLoginAt ?? undefined,
      })),
      deactivatedByUserId: row.deactivatedByUserId ?? undefined,
      registeredByUserId: row.registeredByUserId ?? undefined,
      onboardingApplicationId: row.onboardingApplicationId ?? undefined,
    };
  });
}

/**
 * The second consequence of a deactivation: no new orders (doc 09 §3.4).
 *
 * Called by the two handlers that create a sales order — `POST /api/orders`
 * and quotation acceptance — before they call into `@cc/service-order`,
 * because a service may not import another (ADR-011) and the API is the
 * enforcement point anyway (CLAUDE.md rule 5). Both handlers are declared in
 * `API_ROUTES`, and the integration suite asserts the refusal rather than
 * trusting the call to be present.
 *
 * It refuses *creation only*. A deactivated account keeps reading its
 * documents, paying its invoices and raising tickets: switching off a portal
 * login must not strand money already owed or goods already in transit.
 */
export async function assertCustomerCanOrder(tenantId: string, kunnr: string): Promise<void> {
  const allowed = await runWithTenant(tenantId, () => isCustomerAccountActive(kunnr));
  if (allowed) return;

  throw new CustomerError("conflict", {
    // The domain owns the wording, so the portal says the same thing here as
    // it does at the sign-in screen.
    issues: [{ field: "kunnr", message: customerAccountBlock({ isActive: false }) ?? "" }],
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export interface RegisterCustomerAccountInput {
  kunnr: string;
  /** Set when a tenant admin registered this customer from the back office. */
  registeredByUserId?: string;
  onboardingApplicationId?: string;
}

/**
 * Records that the portal knows about this account. Called after SAP has
 * created the customer — by the approval handler and by the back-office
 * registration handler — and idempotent, because approving a second sold-to
 * for the same company must not fail on the first one's row.
 */
export async function registerCustomerAccount(
  tenantId: string,
  input: RegisterCustomerAccountInput,
): Promise<void> {
  await runWithTenant(tenantId, async () => {
    await db.customerAccount.upsert({
      where: { tenantId_sapKunnr: { tenantId, sapKunnr: input.kunnr } },
      // An existing row keeps its provenance and its access decision: this
      // is a record of registration, not a way to silently reactivate.
      update: {},
      create: {
        tenantId,
        sapKunnr: input.kunnr,
        registeredByUserId: input.registeredByUserId,
        onboardingApplicationId: input.onboardingApplicationId,
      },
    });
  });
}

/**
 * Edits the customer master through SAP (XD02), bounded by the domain's
 * `CUSTOMER_EDITABLE_FIELDS` registry: PAN and GSTIN are not in the schema,
 * so they cannot be in the patch, so there is no path from this screen to a
 * changed tax identifier (ADR-057).
 *
 * SAP is written *first* and nothing portal-side changes, because there is
 * nothing portal-side to change — the fields being edited are all SAP's.
 */
export async function updateCustomerAccount(
  tenantId: string,
  kunnr: string,
  input: unknown,
  sap: SapAdapter,
  actorUserId: string,
): Promise<CanonicalCustomer> {
  const parsed = customerEditSchema.safeParse(input);
  if (!parsed.success) {
    throw new CustomerError("invalid", { issues: issuesFromZod(parsed.error) });
  }
  const values = parsed.data as CustomerEditInput & Record<string, string>;

  return runWithTenant(tenantId, async () => {
    // Existence is checked against the portal's own row first: a KUNNR the
    // tenant has no account row for must 404 here rather than reach SAP,
    // where a well-formed guess about *another* tenant's customer would
    // otherwise be answered.
    await loadAccount(kunnr);

    const patch = toCustomerPatch(values);

    let updated: CanonicalCustomer;
    try {
      const result = await sap.updateCustomer(kunnr, patch);
      updated = result.customer;
    } catch (error) {
      if (isSapError(error)) {
        if (error.kind === "not_found") throw new CustomerError("not_found", { cause: error });
        if (error.kind === "unavailable") {
          throw new CustomerError("upstream_unavailable", {
            upstreamMessage: error.sapMessage,
            cause: error,
          });
        }
        throw new CustomerError("sap_rejected", {
          issues: error.field ? [{ field: error.field, message: error.message }] : [],
          upstreamMessage: error.sapMessage ?? error.message,
          cause: error,
        });
      }
      throw error;
    }

    // Field *names* only, for the same reason the SAP config trail records
    // names rather than values (ADR-053): an audit row is not a second copy
    // of the customer master.
    await audit("customer.updated", kunnr, {
      actorUserId,
      metadata: { changedFields: Object.keys(values) },
    });

    return updated;
  });
}

export interface SetCustomerActiveInput {
  isActive: boolean;
  reason?: string;
  actorUserId: string;
}

/**
 * Deactivate / reactivate — the tenant-plane mirror of ADR-054's tenant
 * switch, and the same shape: one entry point carrying the target state,
 * because the two directions are the same reversible decision.
 *
 * Nothing is deleted and nothing reaches SAP. The consequences are enforced
 * where they belong — `login` and the account switcher refuse the account
 * (identity), and `createOrder` refuses a new sales order (order) — never
 * here, because refusing a sign-in is identity's decision to make.
 */
export async function setCustomerAccountActive(
  tenantId: string,
  kunnr: string,
  input: SetCustomerActiveInput,
): Promise<CustomerAccountSummary> {
  return runWithTenant(tenantId, async () => {
    const row = await loadAccount(kunnr);

    const updated = await db.customerAccount.update({
      where: { tenantId_sapKunnr: { tenantId, sapKunnr: kunnr } },
      data: input.isActive
        ? {
            isActive: true,
            deactivatedAt: null,
            deactivatedByUserId: null,
            deactivationReason: null,
          }
        : {
            isActive: false,
            deactivatedAt: new Date(),
            deactivatedByUserId: input.actorUserId,
            deactivationReason: input.reason?.trim() || null,
          },
    });

    await audit(input.isActive ? "customer.reactivated" : "customer.deactivated", kunnr, {
      actorUserId: input.actorUserId,
      metadata: { reason: input.reason ?? null },
    });

    const counts = await userCounts([kunnr]);
    return toSummary({ ...row, ...updated }, undefined, counts.get(kunnr) ?? 0);
  });
}
