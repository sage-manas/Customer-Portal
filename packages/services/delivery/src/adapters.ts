import { createObjectStorage, type ObjectStorage } from "@cc/adapter-storage";

/**
 * Adapter resolution for the delivery module.
 *
 * Only object storage, and only for the signed-POD scan (docs/03 Screen 5.2
 * "Signed POD upload (GOS)"). Storage is platform-wide rather than per-tenant
 * (see `@cc/adapter-storage` README), so it comes from env like onboarding's.
 *
 * The *SAP* adapter is deliberately not resolved here: it belongs to
 * `@cc/service-sap`, and a service may not import another service (CLAUDE.md
 * rule 1). Callers pass it in — ADR-011.
 */

export function getDeliveryStorage(): ObjectStorage {
  const driver = process.env.STORAGE_DRIVER === "local" ? "local" : "memory";
  return createObjectStorage({
    driver,
    root: process.env.STORAGE_ROOT ?? ".storage",
  });
}

/**
 * Storage key for a signed POD. Tenant-prefixed by construction, so one
 * tenant's scans can neither collide with nor be guessed from another's even
 * though the store is shared — and keyed by delivery, because there is only
 * ever one POD per delivery.
 */
export function podStorageKey(tenantId: string, deliveryVbeln: string, fileName: string): string {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${tenantId}/pod/${deliveryVbeln}/signed${extension.toLowerCase()}`;
}
