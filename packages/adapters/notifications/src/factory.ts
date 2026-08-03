import type { NotificationDriverName, NotificationSender } from "./contract";
import { EmailNotificationSender, type EmailNotificationConfig } from "./drivers/email";
import { LogNotificationSender, type LogNotificationOptions } from "./drivers/log";
import { NotificationError } from "./errors";

/**
 * Sender resolution.
 *
 * Like storage and the cache — and unlike SAP, GSTN and the payment gateway
 * — this is a *platform* choice rather than a per-tenant one: one mail
 * provider serves every tenant, and what varies per tenant is the sender
 * name and the policy about which notifications leave the portal at all
 * (which is the template registry's business, not the driver's). So the
 * factory caches one sender per process, keyed by its configuration.
 */
export type NotificationConfig =
  ({ driver: "log" } & LogNotificationOptions) | ({ driver: "email" } & EmailNotificationConfig);

let cached: { key: string; sender: NotificationSender } | undefined;

function build(config: NotificationConfig): NotificationSender {
  switch (config.driver) {
    case "log":
      return new LogNotificationSender(config);
    case "email":
      return new EmailNotificationSender(config);
    default: {
      const exhaustive: never = config;
      throw new NotificationError(
        `Unknown notification driver: ${String((exhaustive as { driver?: string }).driver)}`,
        { kind: "misconfigured" },
      );
    }
  }
}

function cacheKeyFor(config: NotificationConfig): string {
  return config.driver === "email"
    ? `email::${config.endpoint}::${config.fromEmail}`
    : "log::default";
}

export function createNotificationSender(config: NotificationConfig): NotificationSender {
  const key = cacheKeyFor(config);
  if (cached?.key === key) return cached.sender;

  const sender = build(config);
  cached = { key, sender };
  return sender;
}

export function resetNotificationSender(): void {
  cached = undefined;
}

export function isNotificationDriver(value: string): value is NotificationDriverName {
  return value === "log" || value === "email";
}
