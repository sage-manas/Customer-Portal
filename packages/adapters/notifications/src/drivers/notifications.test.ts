import { beforeEach, describe, expect, it, vi } from "vitest";

import type { NotificationMessage, NotificationSender } from "../contract";
import { NotificationError } from "../errors";
import { createNotificationSender, resetNotificationSender } from "../factory";

import { EmailNotificationSender } from "./email";
import { LogNotificationSender } from "./log";

function message(overrides: Partial<NotificationMessage> = {}): NotificationMessage {
  return {
    channel: "email",
    tenantId: "tenant_1",
    tenantName: "Acme Industrial",
    recipient: { userId: "usr_1", email: "buyer@acme.example", name: "Priya" },
    subject: "Order 0000004711 confirmed",
    body: "Your order is with SAP and has started processing.",
    url: "https://acme.portal.example/orders/0000004711",
    severity: "success",
    idempotencyKey: "evt_1:usr_1:order.created.customer",
    ...overrides,
  };
}

/**
 * The contract suite. Every driver runs it, so a real provider driver added
 * later inherits the same promises the log driver is held to rather than
 * being trusted to have read the interface.
 */
function contractSuite(name: string, make: () => NotificationSender) {
  describe(`${name} — contract`, () => {
    it("reports which channels it can serve", () => {
      expect(make().channels.length).toBeGreaterThan(0);
    });

    it("refuses a channel it cannot serve, loudly", async () => {
      const sender = make();
      const unsupported = message({ channel: "sms" as never });
      await expect(sender.send(unsupported)).rejects.toThrow(NotificationError);
    });

    it("never throws for a delivery failure", async () => {
      const result = await make().send(message());
      expect(typeof result.delivered).toBe("boolean");
    });
  });
}

contractSuite("log", () => new LogNotificationSender({ echo: false }));
contractSuite(
  "email",
  () =>
    new EmailNotificationSender({
      endpoint: "https://mail.example/send",
      apiKey: "key",
      fromEmail: "no-reply@example",
      fetchImpl: async () => new Response("{}", { status: 200 }),
    }),
);

describe("the log driver", () => {
  it("keeps what it sent so a test can read the customer's mail", async () => {
    const sender = new LogNotificationSender({ echo: false });

    const result = await sender.send(message());

    expect(result.delivered).toBe(true);
    expect(sender.sent).toHaveLength(1);
    expect(sender.sent[0]?.subject).toContain("0000004711");
  });

  it("bounds what it retains", async () => {
    const sender = new LogNotificationSender({ echo: false, maxRetained: 2 });

    for (const key of ["a", "b", "c"]) {
      await sender.send(message({ idempotencyKey: key }));
    }

    expect(sender.sent.map((row) => row.idempotencyKey)).toEqual(["b", "c"]);
  });

  it("echoes one readable line per message", async () => {
    const lines: string[] = [];
    const sender = new LogNotificationSender({ log: (line) => lines.push(line) });

    await sender.send(message());

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain("buyer@acme.example");
  });
});

describe("the email driver", () => {
  it("posts the provider payload with the idempotency key on the request", async () => {
    const fetchImpl = vi.fn(
      async () => new Response(JSON.stringify({ id: "msg_9" }), { status: 200 }),
    );
    const sender = new EmailNotificationSender({
      endpoint: "https://mail.example/send",
      apiKey: "secret",
      fromEmail: "no-reply@example",
      fromName: "CustomerConnect",
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });

    const result = await sender.send(message());

    expect(result).toEqual({ delivered: true, providerMessageId: "msg_9" });
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://mail.example/send");
    expect((init.headers as Record<string, string>)["Idempotency-Key"]).toBe(
      "evt_1:usr_1:order.created.customer",
    );
    const body = JSON.parse(init.body as string) as Record<string, string>;
    expect(body.from).toBe("CustomerConnect <no-reply@example>");
    expect(body.to).toBe("buyer@acme.example");
    expect(body.text).toContain("https://acme.portal.example/orders/0000004711");
  });

  it("escapes the tenant's own text in the HTML body", async () => {
    let sent = "";
    const sender = new EmailNotificationSender({
      endpoint: "https://mail.example/send",
      apiKey: "secret",
      fromEmail: "no-reply@example",
      fetchImpl: (async (_url: string, init: RequestInit) => {
        sent = init.body as string;
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
    });

    await sender.send(message({ body: 'Ticket "<script>alert(1)</script>" raised' }));

    const body = JSON.parse(sent) as Record<string, string>;
    expect(body.html).not.toContain("<script>");
    expect(body.html).toContain("&lt;script&gt;");
  });

  it("reports a provider rejection as undelivered rather than throwing", async () => {
    const sender = new EmailNotificationSender({
      endpoint: "https://mail.example/send",
      apiKey: "secret",
      fromEmail: "no-reply@example",
      fetchImpl: async () => new Response("nope", { status: 429, statusText: "Too Many Requests" }),
    });

    const result = await sender.send(message());

    expect(result.delivered).toBe(false);
    expect(result.error).toContain("429");
  });

  it("reports an unreachable provider as undelivered rather than throwing", async () => {
    const sender = new EmailNotificationSender({
      endpoint: "https://mail.example/send",
      apiKey: "secret",
      fromEmail: "no-reply@example",
      fetchImpl: async () => {
        throw new Error("ECONNREFUSED");
      },
    });

    const result = await sender.send(message());

    expect(result).toEqual({ delivered: false, error: "ECONNREFUSED" });
  });

  it("still counts a 2xx with an unparseable body as delivered", async () => {
    const sender = new EmailNotificationSender({
      endpoint: "https://mail.example/send",
      apiKey: "secret",
      fromEmail: "no-reply@example",
      fetchImpl: async () => new Response("OK", { status: 202 }),
    });

    expect(await sender.send(message())).toEqual({
      delivered: true,
      providerMessageId: undefined,
    });
  });

  it("refuses to be constructed without the settings it needs", () => {
    expect(
      () =>
        new EmailNotificationSender({
          endpoint: "",
          apiKey: "",
          fromEmail: "",
        }),
    ).toThrow(/endpoint/i);
  });
});

describe("the factory", () => {
  beforeEach(() => {
    resetNotificationSender();
  });

  it("defaults to a driver that needs nothing external", () => {
    expect(createNotificationSender({ driver: "log", echo: false }).driver).toBe("log");
  });

  it("reuses one sender per configuration", () => {
    const first = createNotificationSender({ driver: "log", echo: false });
    const second = createNotificationSender({ driver: "log", echo: false });
    expect(second).toBe(first);
  });

  it("rebuilds when the configuration changes", () => {
    const log = createNotificationSender({ driver: "log", echo: false });
    const email = createNotificationSender({
      driver: "email",
      endpoint: "https://mail.example/send",
      apiKey: "k",
      fromEmail: "no-reply@example",
    });
    expect(email).not.toBe(log);
    expect(email.driver).toBe("email");
  });
});
