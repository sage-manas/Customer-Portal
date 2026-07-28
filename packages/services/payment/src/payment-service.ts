import { isPaymentGatewayError, type PaymentGateway } from "@cc/adapter-payment";
import { isSapError, type SapAdapter } from "@cc/adapter-sap";
import { db, getTenantId, runWithTenant } from "@cc/db";
import type { Payment, PaymentInitiateInput, PaymentStatus } from "@cc/domain";
import {
  allocationTotal,
  canTransitionPayment,
  paymentInitiateSchema,
  validateAllocations,
} from "@cc/domain";

import { PaymentError } from "./errors";
import { listPayableItems, requireKunnr } from "./statement-service";

/**
 * Payments (docs/03 Screen 7.2, docs/05 §7.7, docs/02 §6).
 *
 * This is the one module that stores an O2C document, and the reason is
 * worth stating plainly because it is the exception to ADR-016: between the
 * gateway capturing money and SAP clearing the open items there is a real
 * debit against a real customer that no FI document accounts for. Everything
 * else in the portal can be re-read from SAP; that window cannot (ADR-019).
 *
 * Three rules hold throughout:
 *
 * 1. **The webhook is the truth, not the browser.** `initiatePayment` never
 *    marks anything paid — it creates a pending row and hands back a
 *    checkout URL. Only a *signed* webhook advances a payment. A customer
 *    whose browser died mid-redirect still gets their payment posted.
 * 2. **Every step is idempotent.** Gateways deliver at least once. The
 *    gateway reference and the event id are both unique per tenant in the
 *    database, so a replay is recognised rather than posted twice — and
 *    `postIncomingPayment` is itself idempotent on the reference (ADR-021).
 * 3. **Capture and posting are separate states.** If SAP refuses the posting
 *    the money has still been taken; the payment stays `captured` and lands
 *    in reconciliation. It is never rolled back to `failed`, because that
 *    would tell the customer their money is safe when it isn't.
 */

export interface InitiatedPayment {
  paymentId: string;
  /** Where to send the customer (docs/05 §7.7 step 3). */
  checkoutUrl: string;
  amount: number;
  currency: string;
  gatewayReference: string;
}

export interface WebhookResult {
  /** False when the event had already been applied — a replay, not an error. */
  applied: boolean;
  paymentId?: string;
  status?: PaymentStatus;
  /** FI document from the SAP posting, when one was made. */
  fiDocumentNumber?: string;
}

interface PaymentRow {
  id: string;
  customerKunnr: string;
  amount: unknown;
  currency: string;
  mode: string;
  state: string;
  gatewayReference: string | null;
  fiDocumentNumber: string | null;
  failureReason: string | null;
  createdAt: Date;
  updatedAt: Date;
  allocations: Array<{ documentNumber: string; amount: unknown; cleared: boolean }>;
}

const PAYMENT_SELECT = {
  id: true,
  customerKunnr: true,
  amount: true,
  currency: true,
  mode: true,
  state: true,
  gatewayReference: true,
  fiDocumentNumber: true,
  failureReason: true,
  createdAt: true,
  updatedAt: true,
  allocations: { select: { documentNumber: true, amount: true, cleared: true } },
} as const;

const toNumber = (value: unknown): number => Number(value);

function toPayment(row: PaymentRow): Payment {
  const allocations = row.allocations.map((a) => ({
    documentNumber: a.documentNumber,
    amount: toNumber(a.amount),
  }));

  return {
    id: row.id,
    kunnr: row.customerKunnr,
    amount: toNumber(row.amount),
    currency: row.currency,
    mode: row.mode as Payment["mode"],
    status: row.state as PaymentStatus,
    gatewayReference: row.gatewayReference ?? undefined,
    fiDocumentNumber: row.fiDocumentNumber ?? undefined,
    clearedItems: row.allocations.filter((a) => a.cleared).map((a) => a.documentNumber),
    residualItems: row.allocations.filter((a) => !a.cleared).map((a) => a.documentNumber),
    failureReason: row.failureReason ?? undefined,
    allocations,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/**
 * Step 1 + 2 of Make Payment: validate the selection against what SAP says
 * is actually open, record the intent, and create the gateway attempt.
 *
 * The allocations are re-checked against a *fresh* SAP read rather than
 * trusted from the form. The screen may be minutes old, and in that time a
 * colleague may have paid the same invoice or the credit team may have
 * cleared it — paying it twice is exactly the failure this ordering
 * prevents. The portal row is written *before* the gateway is called, so a
 * gateway that charges and then times out still has something to attach its
 * webhook to.
 */
export async function initiatePayment(
  tenantId: string,
  kunnr: string | undefined,
  input: PaymentInitiateInput,
  deps: { sap: SapAdapter; gateway: PaymentGateway; userId?: string },
): Promise<InitiatedPayment> {
  const account = requireKunnr(kunnr);

  const parsed = paymentInitiateSchema.safeParse(input);
  if (!parsed.success) {
    throw new PaymentError("invalid", {
      issues: parsed.error.issues.map((issue) => ({
        field: issue.path.join("."),
        message: issue.message,
      })),
    });
  }

  const payable = await listPayableItems(deps.sap, account);
  const issues = validateAllocations(parsed.data.allocations, payable.items);
  if (issues.length > 0) {
    throw new PaymentError("not_payable", {
      issues: issues.map((issue) => ({
        field: `allocations.${issue.documentNumber}`,
        message: issue.message,
      })),
    });
  }

  const amount = allocationTotal(parsed.data.allocations);
  if (amount <= 0) {
    throw new PaymentError("invalid", {
      issues: [{ field: "allocations", message: "Enter an amount greater than zero" }],
    });
  }

  const payment = await runWithTenant(tenantId, () =>
    db.payment.create({
      data: {
        tenantId: getTenantId(),
        customerKunnr: account,
        initiatedByUserId: deps.userId,
        amount,
        currency: payable.currency,
        mode: parsed.data.mode,
        state: "initiated",
        allocations: {
          create: parsed.data.allocations.map((allocation) => ({
            tenantId: getTenantId(),
            documentNumber: allocation.documentNumber,
            amount: allocation.amount,
          })),
        },
      },
      select: { id: true },
    }),
  );

  const order = await deps.gateway
    .createOrder({
      amount,
      currency: payable.currency,
      // Our own id is the gateway's reference, which is what makes the
      // create idempotent and lets a webhook be traced back to one payment.
      reference: payment.id,
      method: parsed.data.mode,
      notes: { tenantId, kunnr: account },
    })
    .catch(async (error: unknown) => {
      // The attempt never reached the gateway, so nothing can arrive for it
      // later — close the row rather than leaving it pending forever.
      await runWithTenant(tenantId, () =>
        db.payment.update({
          where: { id: payment.id },
          data: { state: "failed", failureReason: "Gateway could not be reached" },
        }),
      ).catch(() => undefined);

      if (isPaymentGatewayError(error)) {
        throw new PaymentError("gateway_unavailable", {
          upstreamMessage: error.upstreamMessage ?? error.message,
          cause: error,
        });
      }
      throw new PaymentError("gateway_unavailable", { cause: error });
    });

  await runWithTenant(tenantId, () =>
    db.payment.update({
      where: { id: payment.id },
      data: { gatewayReference: order.gatewayReference },
    }),
  );

  return {
    paymentId: payment.id,
    checkoutUrl: order.checkoutUrl,
    amount,
    currency: payable.currency,
    gatewayReference: order.gatewayReference,
  };
}

/**
 * The gateway webhook (docs/02 §6: "webhook (signed, idempotent) → payment
 * record → outbox → SAP incoming-payment posting with clearing").
 *
 * Signature first, always: the body is attacker-controlled until it verifies,
 * and an unverified "payment.captured" would clear invoices for free. Then
 * deduplication, then the SAP posting.
 *
 * The tenant is a parameter rather than something read out of the body,
 * because the body is untrusted — the route resolves the tenant from the
 * subdomain/path before this is called.
 */
export async function handleGatewayWebhook(
  tenantId: string,
  rawBody: string,
  signature: string,
  deps: { sap: SapAdapter; gateway: PaymentGateway },
): Promise<WebhookResult> {
  if (!deps.gateway.verifyWebhookSignature(rawBody, signature)) {
    throw new PaymentError("invalid_signature");
  }

  const event = deps.gateway.parseWebhook(rawBody, signature);

  const row = await runWithTenant(tenantId, () =>
    db.payment.findFirst({
      where: { gatewayReference: event.payment.gatewayReference },
      select: { ...PAYMENT_SELECT, lastEventId: true },
    }),
  );

  // A webhook for a payment this tenant doesn't have is not an error the
  // gateway can act on — acknowledge it and move on, or it will be retried
  // forever.
  if (!row) return { applied: false };

  if (row.lastEventId === event.eventId) {
    return {
      applied: false,
      paymentId: row.id,
      status: row.state as PaymentStatus,
      fiDocumentNumber: row.fiDocumentNumber ?? undefined,
    };
  }

  const current = row.state as PaymentStatus;

  if (event.type === "payment.pending") {
    // Nothing to record: the payment is still in flight, and `initiated`
    // already says that.
    return { applied: false, paymentId: row.id, status: current };
  }

  if (event.type === "payment.failed") {
    if (!canTransitionPayment(current, "failed")) {
      // Refusing this is the point of the state machine: a "failed" arriving
      // after a capture would tell the customer their money came back.
      return { applied: false, paymentId: row.id, status: current };
    }

    await runWithTenant(tenantId, () =>
      db.payment.update({
        where: { id: row.id },
        data: {
          state: "failed",
          failureReason: event.payment.failureReason ?? "Payment was not completed",
          lastEventId: event.eventId,
        },
      }),
    );
    return { applied: true, paymentId: row.id, status: "failed" };
  }

  // payment.captured — the money is taken. Record that first and separately
  // from the posting, so a SAP failure can never lose the fact of the charge.
  if (canTransitionPayment(current, "captured")) {
    await runWithTenant(tenantId, () =>
      db.payment.update({
        where: { id: row.id },
        data: { state: "captured", lastEventId: event.eventId },
      }),
    );
  }

  const posted = await postCapturedPayment(tenantId, row.id, deps.sap);

  return {
    applied: true,
    paymentId: row.id,
    status: posted.status,
    fiDocumentNumber: posted.fiDocumentNumber,
  };
}

/**
 * The F-28 equivalent posting and clearing.
 *
 * Split out from the webhook handler so reconciliation can retry it for a
 * payment stuck at `captured` (docs/04: "daily reconciliation job +
 * exception queue from day one"). Safe to call repeatedly:
 * `postIncomingPayment` is idempotent on the gateway reference, so a retry
 * returns the original FI document rather than posting a second one.
 */
export async function postCapturedPayment(
  tenantId: string,
  paymentId: string,
  sap: SapAdapter,
): Promise<{ status: PaymentStatus; fiDocumentNumber?: string }> {
  const row = await runWithTenant(tenantId, () =>
    db.payment.findUnique({ where: { id: paymentId }, select: PAYMENT_SELECT }),
  );
  if (!row) throw new PaymentError("not_found");

  const state = row.state as PaymentStatus;
  if (state === "posted") {
    return { status: "posted", fiDocumentNumber: row.fiDocumentNumber ?? undefined };
  }
  if (state !== "captured") {
    // Nothing was taken, so there is nothing to post.
    return { status: state };
  }

  const result = await sap
    .postIncomingPayment({
      kunnr: row.customerKunnr,
      amount: toNumber(row.amount),
      currency: row.currency,
      // The gateway reference is the idempotency key on the SAP side too.
      gatewayReference: row.gatewayReference ?? row.id,
      allocations: row.allocations.map((allocation) => ({
        documentNumber: allocation.documentNumber,
        amount: toNumber(allocation.amount),
      })),
    })
    .catch((error: unknown) => {
      throw new PaymentError("posting_failed", {
        upstreamMessage: isSapError(error) ? error.sapMessage : undefined,
        cause: error,
      });
    });

  const cleared = new Set(result.clearedItems);

  await runWithTenant(tenantId, async () => {
    await db.payment.update({
      where: { id: row.id },
      data: {
        state: "posted",
        fiDocumentNumber: result.documentNumber,
        postedAt: new Date(),
      },
    });
    // Which items actually cleared vs. left a residual — the receipt says so,
    // and reconciliation needs it.
    await Promise.all(
      row.allocations.map((allocation) =>
        db.paymentAllocation.updateMany({
          where: { paymentId: row.id, documentNumber: allocation.documentNumber },
          data: { cleared: cleared.has(allocation.documentNumber) },
        }),
      ),
    );
  });

  return { status: "posted", fiDocumentNumber: result.documentNumber };
}

/**
 * One payment, for the receipt screen (docs/05 §7.7).
 *
 * Scoped to the session's sold-to account and answering 404 otherwise —
 * payments belong to the account, so a colleague can see one they didn't
 * make, but nobody outside the account can (CLAUDE.md rule 5).
 */
export async function getPayment(
  tenantId: string,
  kunnr: string | undefined,
  paymentId: string,
): Promise<Payment> {
  const account = requireKunnr(kunnr);

  const row = await runWithTenant(tenantId, () =>
    db.payment.findFirst({
      where: { id: paymentId, customerKunnr: account },
      select: PAYMENT_SELECT,
    }),
  );
  if (!row) throw new PaymentError("not_found");

  return toPayment(row);
}

/** The account's payments, newest first — the history behind the statement. */
export async function listPayments(
  tenantId: string,
  kunnr: string | undefined,
  options: { states?: readonly PaymentStatus[] } = {},
): Promise<Payment[]> {
  const account = requireKunnr(kunnr);

  const rows = await runWithTenant(tenantId, () =>
    db.payment.findMany({
      where: {
        customerKunnr: account,
        ...(options.states ? { state: { in: [...options.states] } } : {}),
      },
      orderBy: { createdAt: "desc" },
      select: PAYMENT_SELECT,
    }),
  );

  return rows.map(toPayment);
}

/**
 * Completes a payment on the **mock** gateway by delivering its own signed
 * webhook — the dev/demo stand-in for the customer finishing checkout at
 * Razorpay (docs/05 §7.7 step 3).
 *
 * It deliberately goes the long way round: it asks the mock driver to mint a
 * genuinely signed callback and then feeds it through `handleGatewayWebhook`
 * like any other. So the dev flow exercises signature verification,
 * deduplication and the SAP posting exactly as production will — a shortcut
 * that flipped the row to `posted` would leave all three untested until the
 * first real gateway.
 *
 * Refuses any driver but `mock`, so this can never become a way to mark a
 * real payment paid.
 */
export async function completeMockCheckout(
  tenantId: string,
  gatewayReference: string,
  deps: { sap: SapAdapter; gateway: PaymentGateway },
): Promise<WebhookResult> {
  const gateway = deps.gateway as PaymentGateway & {
    buildWebhook?: (reference: string) => { body: string; signature: string };
  };

  if (gateway.driver !== "mock" || typeof gateway.buildWebhook !== "function") {
    throw new PaymentError("not_found");
  }

  const { body, signature } = gateway.buildWebhook(gatewayReference);
  return handleGatewayWebhook(tenantId, body, signature, deps);
}

/**
 * Payments whose money is taken but whose SAP posting hasn't confirmed —
 * the `Pending sync` rows on the statement (docs/05 §7.7). Also what the
 * reconciliation job picks up.
 */
export async function listPendingSync(
  tenantId: string,
  kunnr: string | undefined,
): Promise<Payment[]> {
  return listPayments(tenantId, kunnr, { states: ["captured"] });
}
