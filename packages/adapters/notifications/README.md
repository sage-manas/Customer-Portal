# `@cc/adapter-notifications`

Outbound notification channels — the email half of docs/07 A7 and docs/05 §6.4's "Email/WhatsApp mirrors". Email is an external system, so it sits behind an interface with a driver that needs nothing external built first (CLAUDE.md rule 2). Nothing in the portal composes a provider payload outside this package.

**The in-app bell is not a channel here.** It is a row in the portal's own database, written by `@cc/service-notification` in the same transaction as the fan-out. Routing it through a "sender" would make the portal an external system to itself, with a failure mode where a notification exists for email but not in the inbox.

## Public API

```ts
import { createNotificationSender, LogNotificationSender } from "@cc/adapter-notifications";

const sender = createNotificationSender({ driver: "log", echo: false });

const result = await sender.send({
  channel: "email",
  tenantId,
  tenantName: "Acme Industrial",
  recipient: { userId, email: "buyer@acme.example" },
  subject: "Order 0000004711 confirmed",
  body: "Your order is with SAP and has started processing.",
  url: "https://acme.portal.example/orders/0000004711",
  severity: "success",
  idempotencyKey: `${eventId}:${userId}:order.created.customer`,
});
// -> { delivered: true, providerMessageId: "…" }
```

| Export                     | What it is                                                                      |
| -------------------------- | ------------------------------------------------------------------------------- |
| `NotificationSender`       | The contract: `driver`, `channels`, `send(message)`.                            |
| `createNotificationSender` | Factory; one sender per process, cached by configuration.                       |
| `LogNotificationSender`    | Default driver. Console + an in-memory `sent` list a test can read.             |
| `EmailNotificationSender`  | HTTPS POST to a transactional-email provider.                                   |
| `NotificationError`        | Thrown only for `misconfigured` / `unsupported_channel` — never for a bad send. |

## Two contract-level promises

1. **A send never throws for a delivery failure.** A provider that is down, slow or refusing returns `{ delivered: false, error }`. The same fail-open instinct as `@cc/adapter-cache` (ADR-036), for a different asymmetry: by the time a message is sent the fact has already happened and the bell row is already written, so a mail outage must not fail the job and re-run the whole fan-out. Programming errors — an unsupported channel, a driver built without its settings — still throw.
2. **Every message carries an `idempotencyKey`.** The relay is at-least-once (ADR-023), so a redelivered event must not become a second email. Providers that honour the header dedupe on it; the log driver records it, so a duplicate is identifiable rather than merely suspected.

## Drivers

- **`log`** (default) — writes one line per message and retains the last 500. Not only a test double: a developer with no provider, every unit test, and demo tenants run on it, and because `sent` is readable a test asserts _what the customer would have received_.
- **`email`** — a provider HTTP call, not an SMTP client. docs/07 says "SMTP/provider"; the provider side was chosen because SMTP is a stateful pooled connection with a lifecycle nobody in a wake-up-send-sleep worker owns, while a POST is a request with a status code. It also keeps this package dependency-free. The provider is unnamed on purpose — endpoint + bearer key covers every transactional provider's `{to, from, subject, text, html}`, and one that differs gets `transformBody` rather than a fork.

WhatsApp is deliberately **not** in `NOTIFICATION_CHANNELS`. A channel a template may ask for must have a driver; declaring one without would let a template promise a delivery nothing performs. It joins the list with its driver.

## Configuration

```
NOTIFICATIONS_DRIVER=log            # log (default) | email
NOTIFICATIONS_EMAIL_ENDPOINT=https://api.provider.example/v1/send
NOTIFICATIONS_EMAIL_API_KEY=…
NOTIFICATIONS_FROM_EMAIL=no-reply@customerconnect.example
NOTIFICATIONS_FROM_NAME=CustomerConnect
```

Like storage and the cache, this is a **platform** choice rather than a per-tenant one: one provider serves every tenant, and what varies per tenant is the sender name and which notifications leave the portal at all — which is the template registry's business (`@cc/domain` `entities/notification.ts`), not the driver's.

## Testing

```
pnpm --filter @cc/adapter-notifications test
```

`src/drivers/notifications.test.ts` runs a shared contract suite against every driver, so a real provider driver added in Track C inherits the same promises rather than being trusted to have read the interface.
