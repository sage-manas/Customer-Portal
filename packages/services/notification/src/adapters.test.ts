import { resetNotificationSender } from "@cc/adapter-notifications";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { getNotificationSender, portalUrl } from "./adapters";

const ORIGINAL = { ...process.env };

beforeEach(() => {
  resetNotificationSender();
});

afterEach(() => {
  process.env = { ...ORIGINAL };
  resetNotificationSender();
});

describe("getNotificationSender", () => {
  it("defaults to the driver that needs nothing external", () => {
    delete process.env.NOTIFICATIONS_DRIVER;
    expect(getNotificationSender().driver).toBe("log");
  });

  it("falls back to the log driver for an unknown name rather than throwing", () => {
    // A typo in a deployment's environment must not take the worker down —
    // the notifications still land in the bell, and the log line says where
    // the mail went.
    process.env.NOTIFICATIONS_DRIVER = "smtp-ish";
    expect(getNotificationSender().driver).toBe("log");
  });

  it("builds the email driver when it is configured", () => {
    process.env.NOTIFICATIONS_DRIVER = "email";
    process.env.NOTIFICATIONS_EMAIL_ENDPOINT = "https://mail.example/send";
    process.env.NOTIFICATIONS_EMAIL_API_KEY = "key";
    process.env.NOTIFICATIONS_FROM_EMAIL = "no-reply@example";

    expect(getNotificationSender().driver).toBe("email");
  });

  it("refuses the email driver without its settings, loudly", () => {
    process.env.NOTIFICATIONS_DRIVER = "email";
    delete process.env.NOTIFICATIONS_EMAIL_ENDPOINT;
    delete process.env.NOTIFICATIONS_EMAIL_API_KEY;
    delete process.env.NOTIFICATIONS_FROM_EMAIL;

    expect(() => getNotificationSender()).toThrow(/endpoint/i);
  });
});

describe("portalUrl", () => {
  it("builds <slug>.<ROOT_DOMAIN> — the tenant resolution rule, in reverse", () => {
    process.env.ROOT_DOMAIN = "customerconnect.example";
    delete process.env.PORTAL_PORT;
    delete process.env.PORTAL_URL_SCHEME;

    expect(portalUrl("acme", "/orders/0000004711")).toBe(
      "https://acme.customerconnect.example/orders/0000004711",
    );
  });

  it("uses http and the dev port on localhost", () => {
    process.env.ROOT_DOMAIN = "localhost";
    process.env.PORTAL_PORT = "3000";
    delete process.env.PORTAL_URL_SCHEME;

    expect(portalUrl("acme", "/support/tkt_1")).toBe("http://acme.localhost:3000/support/tkt_1");
  });

  it("returns nothing rather than a guess when no root domain is configured", () => {
    delete process.env.ROOT_DOMAIN;
    // A mail with a broken link is worse than one with none: the recipient
    // cannot tell which portal it meant.
    expect(portalUrl("acme", "/orders/1")).toBeUndefined();
  });
});
