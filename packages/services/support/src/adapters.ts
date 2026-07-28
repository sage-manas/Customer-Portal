import { createObjectStorage, type ObjectStorage } from "@cc/adapter-storage";

/**
 * Adapter resolution for the support module — object storage only, for ticket
 * attachments (docs/03 Screen 8.1 "Attachment (GOS)"). Storage is
 * platform-wide rather than per-tenant (see `@cc/adapter-storage` README), so
 * it comes from env, exactly as onboarding's and the signed-POD scan's do.
 *
 * There is no SAP adapter here, and that is not an oversight: a portal-native
 * ticket has no SAP document behind it. When a tenant runs QM notifications
 * instead (docs/03 Screen 8.1), the adapter arrives as a *parameter* like the
 * delivery module's — a service may not import `@cc/service-sap` (ADR-011).
 */

export function getSupportStorage(): ObjectStorage {
  const driver = process.env.STORAGE_DRIVER === "local" ? "local" : "memory";
  return createObjectStorage({
    driver,
    root: process.env.STORAGE_ROOT ?? ".storage",
  });
}

/**
 * Storage key for a ticket attachment. Tenant-prefixed by construction so one
 * tenant's files can neither collide with nor be guessed from another's, and
 * suffixed with a random token because — unlike a POD, of which there is
 * exactly one per delivery — a ticket carries many files and two of them are
 * quite likely to be called `photo.jpg`.
 */
export function attachmentStorageKey(
  tenantId: string,
  ticketRef: string,
  fileName: string,
  token: string,
): string {
  const extension = fileName.includes(".") ? fileName.slice(fileName.lastIndexOf(".")) : "";
  return `${tenantId}/support/${ticketRef}/${token}${extension.toLowerCase()}`;
}
