/**
 * Frontend-only stand-in for `@cc/service-customer` (the back-office
 * customer master: list, detail, edit, deactivate).
 *
 * The SAP half (the canonical customer, XD02 writes) goes through the mock
 * adapter and is faithful. The portal half — which accounts exist, who is
 * linked to them, deactivation state — is seeded from the SAP landscape on
 * first read and then lives in the demo store.
 *
 * TODO(BACKEND):
 * Replace with the real @cc/service-customer (`CustomerAccount`/`User`
 * tables, XD02 through the tenant adapter, deactivation audit).
 */

import {
  customerAccountStatus,
  type CanonicalCustomer,
  type CustomerAccountSummary,
  type CustomerEditInput,
  type CustomerPatch,
} from "@cc/domain";

import { DemoServiceError, demoStore, demoSyncedAt, DEMO_FRESHNESS } from "./_demo";

import type { FreshnessClass, SapAdapter } from "../sap-mock";
import { SEED_CUSTOMERS } from "../sap-mock";

export class CustomerError extends DemoServiceError {
  constructor(message: string, code = "customer_error", status = 400) {
    super(message, { code, status });
    this.name = "CustomerError";
  }
}

export function isCustomerError(error: unknown): error is CustomerError {
  return error instanceof CustomerError;
}

export type CustomerErrorCode = string;
export type CustomerIssue = { path: string; message: string };

export interface CustomerAccountUser {
  id: string;
  email: string;
  isActive: boolean;
  lastLoginAt?: Date;
}

interface StoredAccount {
  kunnr: string;
  isActive: boolean;
  origin: "self_registered" | "back_office";
  registeredAt: Date;
  deactivatedAt?: Date;
  deactivationReason?: string;
  deactivatedByUserId?: string;
  registeredByUserId?: string;
  onboardingApplicationId?: string;
  users: CustomerAccountUser[];
}

/** Seeded from the SAP landscape so the list is never empty on first paint. */
function accounts(): StoredAccount[] {
  const store = demoStore();
  if (store.customerAccounts.length === 0) {
    store.customerAccounts = SEED_CUSTOMERS.map((customer, index) => ({
      kunnr: customer.kunnr!,
      isActive: true,
      origin: index === 0 ? "self_registered" : "back_office",
      registeredAt: new Date("2026-01-15T00:00:00.000Z"),
      users: [
        {
          id: `user-${index + 1}`,
          email: customer.contact?.email ?? `buyer${index + 1}@example.com`,
          isActive: true,
          lastLoginAt: new Date("2026-07-25T08:30:00.000Z"),
        },
      ],
    })) satisfies StoredAccount[];
  }
  return store.customerAccounts as StoredAccount[];
}

function toSummary(account: StoredAccount, customer?: CanonicalCustomer): CustomerAccountSummary {
  return {
    kunnr: account.kunnr,
    legalEntityName: customer?.legalEntityName ?? account.kunnr,
    gstin: customer?.tax?.gstin,
    city: customer?.address?.city,
    state: customer?.address?.region,
    contactEmail: customer?.contact?.email,
    status: customerAccountStatus(account.isActive),
    origin: account.origin,
    userCount: account.users.length,
    registeredAt: account.registeredAt,
    deactivatedAt: account.deactivatedAt,
    deactivationReason: account.deactivationReason,
  };
}

export interface ListCustomersFilter {
  search?: string;
  status?: "Active" | "Deactivated";
}

export interface CustomerListResult {
  data: CustomerAccountSummary[];
  freshness: FreshnessClass;
  syncedAt: string;
}

export async function listCustomerAccounts(
  _tenantId: string,
  adapter: SapAdapter,
  filter: ListCustomersFilter = {},
): Promise<CustomerListResult> {
  const rows: CustomerAccountSummary[] = [];

  for (const account of accounts()) {
    const customer = await adapter
      .getCustomer(account.kunnr)
      .then((read) => read.data)
      .catch(() => undefined);
    rows.push(toSummary(account, customer));
  }

  let filtered = rows;
  if (filter.status) filtered = filtered.filter((row) => row.status === filter.status);

  const search = filter.search?.trim().toLowerCase();
  if (search) {
    filtered = filtered.filter(
      (row) =>
        row.legalEntityName.toLowerCase().includes(search) ||
        row.kunnr.toLowerCase().includes(search) ||
        row.gstin?.toLowerCase().includes(search) ||
        row.contactEmail?.toLowerCase().includes(search),
    );
  }

  return {
    data: filtered.sort((a, b) => a.legalEntityName.localeCompare(b.legalEntityName)),
    freshness: DEMO_FRESHNESS,
    syncedAt: demoSyncedAt(),
  };
}

export interface CustomerAccountDetail {
  summary: CustomerAccountSummary;
  customer?: CanonicalCustomer;
  freshness?: FreshnessClass;
  syncedAt?: string;
  users: CustomerAccountUser[];
  deactivatedByUserId?: string;
  registeredByUserId?: string;
  onboardingApplicationId?: string;
}

export async function getCustomerAccount(
  _tenantId: string,
  kunnr: string,
  adapter: SapAdapter,
): Promise<CustomerAccountDetail> {
  const account = accounts().find((row) => row.kunnr === kunnr);
  // 404, never 403: confirming an account exists on another tenant is a leak.
  if (!account) throw new CustomerError("We couldn't find that customer.", "not_found", 404);

  const customer = await adapter
    .getCustomer(kunnr)
    .then((read) => read.data)
    .catch(() => undefined);

  return {
    summary: toSummary(account, customer),
    customer,
    freshness: customer ? DEMO_FRESHNESS : undefined,
    syncedAt: customer ? demoSyncedAt() : undefined,
    users: account.users,
    deactivatedByUserId: account.deactivatedByUserId,
    registeredByUserId: account.registeredByUserId,
    onboardingApplicationId: account.onboardingApplicationId,
  };
}

export interface RegisterCustomerAccountInput {
  kunnr: string;
  registeredByUserId?: string;
  onboardingApplicationId?: string;
}

export async function registerCustomerAccount(
  _tenantId: string,
  input: RegisterCustomerAccountInput,
): Promise<CustomerAccountSummary> {
  const existing = accounts().find((row) => row.kunnr === input.kunnr);
  if (existing) return toSummary(existing);

  const account: StoredAccount = {
    kunnr: input.kunnr,
    isActive: true,
    origin: input.registeredByUserId ? "back_office" : "self_registered",
    registeredAt: new Date(),
    registeredByUserId: input.registeredByUserId,
    onboardingApplicationId: input.onboardingApplicationId,
    users: [],
  };
  accounts().push(account);
  return toSummary(account);
}

export async function updateCustomerAccount(
  _tenantId: string,
  kunnr: string,
  adapter: SapAdapter,
  input: CustomerEditInput,
): Promise<CustomerAccountDetail> {
  const account = accounts().find((row) => row.kunnr === kunnr);
  if (!account) throw new CustomerError("We couldn't find that customer.", "not_found", 404);

  // CUSTOMER_EDITABLE_FIELDS (the wizard's field registry) is flat, but the
  // adapter's CustomerPatch groups address/contact — sending `input` through
  // unshaped left every field but tradeName silently dropped (region/postalCode
  // don't even share the form's field names: state/pinCode).
  const patch: CustomerPatch = {
    tradeName: input.tradeName,
    address: {
      street: input.street,
      city: input.city,
      region: input.state,
      postalCode: input.pinCode,
      country: input.country,
    },
    contact: {
      contactPerson: input.contactPerson,
      email: input.email,
      phone: input.phone,
    },
  };

  await adapter.updateCustomer(kunnr, patch).catch(() => {
    throw new CustomerError(
      "SAP refused the change.",
      "upstream_rejected",
      422,
    );
  });

  return getCustomerAccount(_tenantId, kunnr, adapter);
}

export interface SetCustomerActiveInput {
  isActive: boolean;
  reason?: string;
  actorUserId: string;
}

export async function setCustomerAccountActive(
  _tenantId: string,
  kunnr: string,
  input: SetCustomerActiveInput,
): Promise<CustomerAccountSummary> {
  const account = accounts().find((row) => row.kunnr === kunnr);
  if (!account) throw new CustomerError("We couldn't find that customer.", "not_found", 404);

  account.isActive = input.isActive;
  account.deactivatedAt = input.isActive ? undefined : new Date();
  account.deactivationReason = input.isActive ? undefined : input.reason;
  account.deactivatedByUserId = input.isActive ? undefined : input.actorUserId;

  // Deactivation blocks login and new orders; it never deletes O2C history
  // (doc 09 §3.4) — which is exactly what this does: the SAP documents stay.
  return toSummary(account);
}

/** ADR-057: a deactivated account is a 409 with the domain's own wording. */
export async function assertCustomerCanOrder(_tenantId: string, kunnr: string): Promise<void> {
  const account = accounts().find((row) => row.kunnr === kunnr);
  if (account && !account.isActive) {
    throw new CustomerError(
      "This account has been deactivated and can't place new orders. Contact your account manager.",
      "account_deactivated",
      409,
    );
  }
}
