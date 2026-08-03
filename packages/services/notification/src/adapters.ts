import {
  createNotificationSender,
  isNotificationDriver,
  type NotificationSender,
} from "@cc/adapter-notifications";

/**
 * Adapter resolution for the notification module.
 *
 * The sender is a **platform** choice, like storage and the cache and unlike
 * SAP: one provider serves every tenant, and what varies per tenant is the
 * name on the mail, not the transport. So it comes from env rather than from
 * a `Tenant` column, and the default is the driver that needs nothing
 * external — a developer with no provider still sees exactly what a customer
 * would have been sent, in their terminal.
 */
export function getNotificationSender(): NotificationSender {
  const configured = process.env.NOTIFICATIONS_DRIVER ?? "log";
  const driver = isNotificationDriver(configured) ? configured : "log";

  if (driver === "email") {
    return createNotificationSender({
      driver: "email",
      endpoint: process.env.NOTIFICATIONS_EMAIL_ENDPOINT ?? "",
      apiKey: process.env.NOTIFICATIONS_EMAIL_API_KEY ?? "",
      fromEmail: process.env.NOTIFICATIONS_FROM_EMAIL ?? "",
      fromName: process.env.NOTIFICATIONS_FROM_NAME,
    });
  }

  return createNotificationSender({ driver: "log" });
}

/**
 * Absolute URL for a notification's deep link.
 *
 * The stored `href` is relative, because that is what the bell renders and
 * what a route re-authorises. A mail needs the whole thing, and only the
 * deployment knows the tenant's hostname — the same `<slug>.<ROOT_DOMAIN>`
 * rule `apps/web/lib/tenant.ts` resolves *in*, applied in reverse.
 *
 * Returns undefined rather than a guess when no root domain is configured: a
 * mail with a broken link is worse than one with none, because the recipient
 * cannot tell which portal it meant.
 */
export function portalUrl(tenantSlug: string, href: string): string | undefined {
  const rootDomain = process.env.ROOT_DOMAIN;
  if (!rootDomain) return undefined;

  // Local development runs on http and a port; anything else is https on 443.
  const isLocal = rootDomain === "localhost" || rootDomain.startsWith("localhost:");
  const scheme = process.env.PORTAL_URL_SCHEME ?? (isLocal ? "http" : "https");
  const port = process.env.PORTAL_PORT ? `:${process.env.PORTAL_PORT}` : "";

  return `${scheme}://${tenantSlug}.${rootDomain}${port}${href}`;
}
