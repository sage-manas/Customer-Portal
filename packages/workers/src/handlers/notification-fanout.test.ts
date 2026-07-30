import { DOMAIN_EVENT_NAMES, isNotifiableEvent } from "@cc/domain";
import { describe, expect, it, vi } from "vitest";

import { handlersFor } from "./registry";

/**
 * The registration itself is the thing worth testing. The handler's body is
 * one call into `@cc/service-notification`, which the service's own
 * integration suite covers against a real database; what could silently go
 * wrong here is a *subscription* — an event that has a template and no
 * handler, whose failure mode is silence.
 */

vi.mock("@cc/service-notification", () => ({
  deliverEventNotifications: vi.fn(async () => ({
    created: 0,
    recipients: 0,
    emailsSent: 0,
    emailsFailed: 0,
  })),
}));

// Imported for its side effect, once, exactly as the worker entrypoint does
// it — registration happens at module load and there is no second load.
await import("./notification-fanout");

describe("the notification fan-out", () => {
  it("subscribes to exactly the events the template registry declares", () => {
    for (const name of DOMAIN_EVENT_NAMES) {
      const registered = handlersFor(name).length > 0;
      expect(registered, name).toBe(isNotifiableEvent(name));
    }
  });

  it("covers a real spread of modules rather than one", () => {
    // A guard against the registry accidentally emptying out: if this drops
    // to nothing the test above would still pass, and nobody would be told
    // anything ever again.
    const notifiable = DOMAIN_EVENT_NAMES.filter(isNotifiableEvent);
    expect(notifiable.length).toBeGreaterThanOrEqual(8);
    expect(notifiable).toContain("order.created");
    expect(notifiable).toContain("support.sla.breached");
  });

  it("passes the tenant, the outbox row id and the payload straight through", async () => {
    const { deliverEventNotifications } = await import("@cc/service-notification");

    const payload = {
      occurredAt: new Date("2026-07-20T09:00:00.000Z"),
      kunnr: "0010001001",
      documentNumber: "0000004711",
      creditBlocked: false,
    };
    const [handler] = handlersFor("order.created");

    await handler?.(payload, { tenantId: "tenant_1", eventId: "evt_1" });

    // `eventId` is the outbox row id, and it is what makes the fan-out
    // idempotent under an at-least-once relay (ADR-023) — losing it here
    // would turn every redelivery into a second buzz.
    expect(deliverEventNotifications).toHaveBeenCalledWith(
      "tenant_1",
      "evt_1",
      "order.created",
      payload,
    );
  });
});
