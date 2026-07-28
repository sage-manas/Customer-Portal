import { isPaymentError, postCapturedPayment } from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";

import { registerHandler } from "./registry";

/**
 * `payment.captured` → make sure SAP eventually accounts for the money.
 *
 * This is the first real consumer, and it exists in A1 rather than waiting
 * for B4 because it closes the one gap ADR-019 names explicitly: between the
 * gateway capturing money and SAP clearing the items, nothing in SAP accounts
 * for the debit. Until now the only thing that retried that posting was the
 * next webhook — which, for a payment that captured cleanly and then hit a
 * SAP outage, never comes.
 *
 * Safe to run any number of times, as ADR-023 requires: `postCapturedPayment`
 * returns early for a payment already `posted`, and `postIncomingPayment` is
 * itself idempotent on the gateway reference (ADR-021), so a retry returns
 * the original FI document rather than clearing the items twice.
 */
registerHandler("payment.captured", async (payload, context) => {
  const sap = await getSapAdapterForTenant(context.tenantId);

  try {
    await postCapturedPayment(context.tenantId, payload.paymentId, sap);
  } catch (error) {
    // A posting failure is a retry, not a lost payment: the row stays
    // `captured`, `listPendingSync` still surfaces it, and rethrowing lets
    // BullMQ back off and try again. Nothing here may mark the payment
    // failed — the money has been taken (ADR-019).
    if (isPaymentError(error) && error.code === "not_found") {
      // The payment was deleted or belongs to a tenant this event no longer
      // matches. Nothing to retry; swallow rather than poison the queue.
      return;
    }
    throw error;
  }
});

export {};
