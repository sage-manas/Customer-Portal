import { createPaymentGateway, type PaymentGateway } from "@cc/adapter-payment";
import { db } from "@cc/db";

/**
 * Gateway resolution for the payments module.
 *
 * Resolved per tenant from its stored driver setting, exactly like GSTN is
 * in `@cc/service-onboarding` — a tenant with real Razorpay credentials is a
 * config change, not a code change.
 *
 * The *SAP* adapter is deliberately not resolved here: it belongs to
 * `@cc/service-sap`, and a service may not import another service
 * (CLAUDE.md rule 1, ADR-011). Callers pass it in.
 */
export async function getPaymentGatewayForTenant(tenantId: string): Promise<PaymentGateway> {
  // `tenants` is a platform-plane table, not tenant-scoped: read unbound.
  const tenant = await db.tenant.findUnique({ where: { id: tenantId } });
  if (!tenant) throw new Error(`Unknown tenant: ${tenantId}`);

  return createPaymentGateway({
    tenantId: tenant.id,
    driver: tenant.paymentGateway,
    razorpay:
      tenant.paymentGateway === "razorpay"
        ? {
            keyId: process.env.RAZORPAY_KEY_ID ?? "",
            credentialsRef: `kms://${tenant.slug}/razorpay`,
            // Per tenant in production (docs/02 §9); the env var is the
            // local-dev stand-in for the vault lookup.
            webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET ?? "",
          }
        : undefined,
  });
}
