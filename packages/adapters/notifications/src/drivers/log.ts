import type {
  NotificationDriverName,
  NotificationMessage,
  NotificationSender,
  OutboundChannel,
  SendResult,
} from "../contract";
import { NotificationError } from "../errors";

/**
 * The driver built first (CLAUDE.md rule 2): it writes the message to the
 * console and keeps it in memory.
 *
 * This is the default, and it is not only a test double. A developer with no
 * mail provider, every unit test in the repo, and a demo tenant all run on
 * it — and because `sent` is readable, a test can assert *what a customer
 * would have received* rather than that some function was called. That is
 * the same reason the mock SAP driver is a simulation and not a stub.
 *
 * It never fails. A driver whose whole job is to be available has no failure
 * to model, and a fake outage would only exercise the caller's retry against
 * a code path the real driver reaches differently.
 */

export interface LogNotificationOptions {
  /** Set false in tests that assert on output rather than read it. */
  echo?: boolean;
  /** Bounds an unbounded process; oldest messages are dropped first. */
  maxRetained?: number;
  log?: (line: string) => void;
}

const DEFAULT_MAX_RETAINED = 500;

export class LogNotificationSender implements NotificationSender {
  readonly driver: NotificationDriverName = "log";
  readonly channels: readonly OutboundChannel[] = ["email"];

  private readonly messages: NotificationMessage[] = [];
  private readonly echo: boolean;
  private readonly maxRetained: number;
  private readonly log: (line: string) => void;

  constructor(options: LogNotificationOptions = {}) {
    this.echo = options.echo ?? true;
    this.maxRetained = options.maxRetained ?? DEFAULT_MAX_RETAINED;
    this.log = options.log ?? ((line) => console.log(line));
  }

  // `async` rather than returning a resolved promise, so the refusal below
  // rejects the promise instead of throwing at the call site — a caller
  // awaiting a send should not have to also wrap it in try/catch.
  async send(message: NotificationMessage): Promise<SendResult> {
    // Same refusal the real driver makes. A default driver that quietly
    // accepted a channel it has no business with would let a template ask
    // for WhatsApp in development and discover in production that nothing
    // implements it.
    if (!this.channels.includes(message.channel)) {
      throw new NotificationError(`The log driver cannot send on "${message.channel}".`, {
        kind: "unsupported_channel",
      });
    }

    this.messages.push(message);
    if (this.messages.length > this.maxRetained) this.messages.shift();

    if (this.echo) {
      this.log(
        `[notifications:log] ${message.channel} -> ${message.recipient.email} :: ${message.subject}` +
          (message.url ? ` (${message.url})` : ""),
      );
    }

    return { delivered: true, providerMessageId: `log:${message.idempotencyKey}` };
  }

  /** Everything this driver has "sent", oldest first. */
  get sent(): readonly NotificationMessage[] {
    return this.messages;
  }

  clear(): void {
    this.messages.length = 0;
  }
}
