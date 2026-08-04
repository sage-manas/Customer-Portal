# `@cc/service-notification`

The bell inbox and the fan-out behind it (docs/07 A7, docs/05 §6.4, §4.2). Turns a relayed domain event into notifications addressed to named people, writes them to the portal's own inbox, and mirrors the ones that ask for it by email through `@cc/adapter-notifications`.

Two shapes it deliberately is **not**:

- It is not a "send" API. Nothing in the portal calls this to announce something; it is called by the worker for events that were written to the outbox inside their causing transaction (ADR-023). A notification can therefore only ever describe something that actually happened.
- It is not a projection. The one stored row is a **message delivered to a person at a moment** — words that were shown, not state that can be re-derived. It keeps an `href`, never a copy of the document: clicking re-reads through the owning module with its normal KUNNR check and its normal freshness (ADR-016).

## Public API

```ts
// The worker, once per relayed event:
await deliverEventNotifications(tenantId, eventId, eventName, payload);

// The bell:
const { notifications, unreadCount } = await listNotifications({ tenantId, userId });
await markNotificationsRead({ tenantId, userId }, { ids: [id] }); // omit ids to clear all
await unreadNotificationCount({ tenantId, userId });
await readNotification({ tenantId, userId }, id); // 404 for anyone else's
```

| Export                      | What it does                                                                                       |
| --------------------------- | -------------------------------------------------------------------------------------------------- |
| `deliverEventNotifications` | Render → resolve recipients → write inbox rows → mirror by email. Idempotent on the outbox row id. |
| `resolveRecipients`         | The security boundary. See below.                                                                  |
| `listNotifications`         | One user's bell, newest **fact** first, with the unread count.                                     |
| `markNotificationsRead`     | Idempotent; keeps the first-seen timestamp.                                                        |
| `readNotification`          | One row, 404 for another user's.                                                                   |
| `getNotificationSender`     | Env-resolved platform sender (`log` by default).                                                   |
| `portalUrl`                 | `<slug>.<ROOT_DOMAIN>` — the tenant-resolution rule in reverse, for the link in a mail.            |

## Recipient resolution is the module's boundary

A notification is a **push**: nobody asked for it, no route guarded it, and there is no URL to answer 404 from. So the check every other module performs when a customer _pulls_ data has to happen before the row is written, and `recipients.ts` is the only place that decides it.

- **`customer` templates** fan out to users linked to the sold-to account the event names — the KUNNR boundary orders, deliveries, invoices and tickets already enforce (ADR-025, ADR-032). An event with no KUNNR resolves to **nobody**, because the alternative reading of a missing account is "everyone".
- **`back_office` templates** fan out to users holding the template's permission _and_ a back-office role. The role check is redundant against today's registry and is there because that is a property of the current table, not a guarantee: a tenant-plane notification quotes another customer's account number, so the day a buyer role gains `support:resolve` this must fail closed.

Both filters are pushed into SQL rather than applied to a loaded list — ADR-028's reasoning, one module over: a row that was never selected cannot be leaked by the next person who edits the loop.

There is no tenant-wide "all notifications" view. A bell is a personal inbox; a feed of everything the portal has told everybody is a different product and would hand an agent a buyer's account notifications with no KUNNR check anywhere.

## Ordering: the inbox first, the mail second

`deliverEventNotifications` writes every inbox row before it attempts a single email — ADR-026's "durable thing first", applied to a different pair of systems. The bell is the portal's own record of what it told somebody, so a provider outage must never leave a notification that was emailed but exists nowhere in the portal. A failed send is recorded on the row (`emailError`) and the job still succeeds: the fact already happened, the customer can already see it, and failing here would re-run the whole fan-out for the sake of a mail.

Idempotency is structural. `(tenantId, userId, eventId, templateKey)` is unique, so an at-least-once redelivery writes nothing; the mail is separately guarded by `emailSentAt` on the row, which is ADR-021's "three places" applied to a different external system.

## Configuration

```
NOTIFICATIONS_DRIVER=log            # log (default) | email — see @cc/adapter-notifications
ROOT_DOMAIN=localhost               # tenants are <slug>.<ROOT_DOMAIN>
PORTAL_PORT=3000                    # dev only; appended to the link in a mail
PORTAL_URL_SCHEME=https             # inferred from ROOT_DOMAIN when unset
```

With no `ROOT_DOMAIN` a mail carries no link rather than a guessed one — a broken link is worse than none, because the recipient cannot tell which portal it meant.

## Testing

```
pnpm --filter @cc/service-notification test              # pure units, no database
pnpm --filter @cc/service-notification test:integration  # needs Postgres
```

The unit suite includes `src/recipients.test.ts`, the regression doc 09 §3.2 asks for: per notification template, that its permission still resolves to a non-empty role set on the declared plane after the five-tier collapse (ADR-049). `resolveRecipients` fails _silently_ when `rolesWithPermission` returns `[]` — the `hasSome` simply matches nobody — so this is the shape of registry mistake no other test would catch.

The integration suite covers the two recipient rules, cross-tenant and cross-account isolation, the cross-_user_ 404, the redelivery no-op (rows and mails), a failed mail leaving the bell intact, and the inbox reads.
