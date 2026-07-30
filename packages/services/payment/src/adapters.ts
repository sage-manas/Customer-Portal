import { createPaymentGateway, type PaymentGateway } from "@cc/adapter-payment";
import { db, getTenantCredential, runWithTenant } from "@cc/db";

/**
 * Gateway resolution for the payments module.
 *
 * Resolved per tenant from its stored driver setting, exactly like GSTN is
 * in `@cc/service-onboarding` — a tenant with real Razorpay credentials is a
 * config change, not a code change. The API secret and webhook secret come
 * from the per-tenant credential vault (`@cc/db`, docs/DECISIONS.md
 * ADR-042), decrypted once here — `@cc/adapter-payment` cannot reach
 * `@cc/db` itself (`adapters -> domain, config`, never `db`).
 *
 * The *SAP* adapter is deliberately not resolved here: it belongs to
 * `@cc/service-sap`, and a service may not import another service
 * (CLAUDE.md rule 1, ADR-011). Callers pass it in.
 */
export async function getPaymentGatewayForTenant(tenantId: string): Promise<PaymentGateway> {
  // `tenants` is a platform-plane table, not tenant-scoped: read unbound.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Unknown tenant: ${tenantId}`);

  // TenantCredential *is* tenant-scoped, so this resolver binds its own
  // context rather than assuming a caller already did (same reasoning as
  // `@cc/service-sap`'s adapter-resolver.ts).
  const credentials =
    tenant.paymentGateway === "mock"
      ? null
      : await runWithTenant(tenantId, () => getTenantCredential(tenantId, "payment_gateway"));

  return createPaymentGateway({
    tenantId: tenant.id,
    driver: tenant.paymentGateway,
    razorpay:
      tenant.paymentGateway === "razorpay"
        ? {
            keyId: process.env.RAZORPAY_KEY_ID ?? "",
            credentials: {
              keySecret: (credentials?.keySecret as string | undefined) ?? "",
              webhookSecret: (credentials?.webhookSecret as string | undefined) ?? "",
            },
          }
        : undefined,
  });
}
