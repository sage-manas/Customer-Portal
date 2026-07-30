import type {
  NotificationDriverName,
  NotificationMessage,
  NotificationSender,
  OutboundChannel,
  SendResult,
} from "../contract";
import { NotificationError } from "../errors";

/**
 * The real email driver: an HTTPS call to a transactional-email provider.
 *
 * Why a provider API and not an SMTP client, when docs/07 A7 says
 * "SMTP/provider": SMTP is a stateful, long-lived, connection-oriented
 * protocol, and the thing sending portal mail is a worker that wakes up,
 * sends one message and goes back to sleep. A pooled SMTP connection inside
 * that process is a resource with a lifecycle nobody owns; a POST is a
 * request with a status code. It also keeps the package dependency-free —
 * `fetch` is in the runtime — which matters for a driver that must be
 * swappable per deployment rather than per build.
 *
 * The provider is deliberately unnamed. Every transactional provider takes
 * roughly `{to, from, subject, text, html}` over HTTPS with a bearer token,
 * so the driver is configured with an endpoint and a key rather than being
 * written against one vendor's SDK. A provider that wants a different body
 * shape gets a `transformBody` — not a fork of this file.
 */

export interface EmailNotificationConfig {
  /** Provider's send endpoint. */
  endpoint: string;
  apiKey: string;
  fromEmail: string;
  fromName?: string;
  timeoutMs?: number;
  /** Escape hatch for a provider whose payload differs. */
  transformBody?: (message: NotificationMessage, standard: EmailPayload) => unknown;
  fetchImpl?: typeof fetch;
}

export interface EmailPayload {
  to: string;
  from: string;
  subject: string;
  text: string;
  html: string;
  /** Providers that honour it dedupe on this; the rest ignore it. */
  idempotency_key: string;
}

const DEFAULT_TIMEOUT_MS = 10_000;

export class EmailNotificationSender implements NotificationSender {
  readonly driver: NotificationDriverName = "email";
  readonly channels: readonly OutboundChannel[] = ["email"];

  private readonly config: EmailNotificationConfig;
  private readonly fetchImpl: typeof fetch;

  constructor(config: EmailNotificationConfig) {
    if (!config.endpoint || !config.apiKey || !config.fromEmail) {
      throw new NotificationError(
        "The email driver needs an endpoint, an API key and a from address.",
        { kind: "misconfigured" },
      );
    }
    this.config = config;
    this.fetchImpl = config.fetchImpl ?? globalThis.fetch;
  }

  async send(message: NotificationMessage): Promise<SendResult> {
    if (message.channel !== "email") {
      throw new NotificationError(`The email driver cannot send on "${message.channel}".`, {
        kind: "unsupported_channel",
      });
    }

    const standard = this.payloadFor(message);
    const body = this.config.transformBody?.(message, standard) ?? standard;

    // A timeout, because a provider that never answers would otherwise hold
    // a worker job open until BullMQ's own stall detection notices — long
    // after the customer stopped waiting for the mail.
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.config.timeoutMs ?? DEFAULT_TIMEOUT_MS);

    try {
      const response = await this.fetchImpl(this.config.endpoint, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.config.apiKey}`,
          "Idempotency-Key": message.idempotencyKey,
        },
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        return {
          delivered: false,
          error: `Provider answered ${response.status} ${response.statusText}`,
        };
      }

      return { delivered: true, providerMessageId: await providerId(response) };
    } catch (error) {
      // Fail-open by contract: the fact already happened and the bell row is
      // already written, so an unreachable provider is a delivery to retry,
      // never an exception that unwinds the fan-out.
      return { delivered: false, error: error instanceof Error ? error.message : String(error) };
    } finally {
      clearTimeout(timer);
    }
  }

  private payloadFor(message: NotificationMessage): EmailPayload {
    const from = this.config.fromName
      ? `${this.config.fromName} <${this.config.fromEmail}>`
      : this.config.fromEmail;

    return {
      to: message.recipient.email,
      from,
      subject: message.subject,
      text: textBody(message),
      html: htmlBody(message),
      idempotency_key: message.idempotencyKey,
    };
  }
}

function textBody(message: NotificationMessage): string {
  const lines = [message.body];
  if (message.url) lines.push("", message.url);
  lines.push("", `— ${message.tenantName} on CustomerConnect`);
  return lines.join("\n");
}

/**
 * Minimal HTML, on purpose. A notification mail is one sentence and one
 * link; the portal is where the detail lives, and a mail that reproduced the
 * screen would be a second surface to keep true.
 */
function htmlBody(message: NotificationMessage): string {
  const link = message.url
    ? `<p><a href="${escapeHtml(message.url)}">Open in the portal</a></p>`
    : "";
  return [
    `<p>${escapeHtml(message.body)}</p>`,
    link,
    `<p style="color:#666;font-size:12px">— ${escapeHtml(message.tenantName)} on CustomerConnect</p>`,
  ].join("\n");
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

async function providerId(response: Response): Promise<string | undefined> {
  try {
    const json: unknown = await response.json();
    if (typeof json === "object" && json !== null) {
      const id =
        (json as { id?: unknown; messageId?: unknown }).id ??
        (json as { messageId?: unknown }).messageId;
      if (typeof id === "string") return id;
    }
  } catch {
    // A provider that answered 2xx with a non-JSON body still delivered the
    // mail; not knowing its id is not a failure.
  }
  return undefined;
}
