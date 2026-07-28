import {
  getPaymentGatewayForTenant,
  handleGatewayWebhook,
  isPaymentError,
} from "@cc/service-payment";
import { getSapAdapterForTenant } from "@cc/service-sap";
import { NextResponse } from "next/server";

import { resolveRequestTenant } from "@/lib/tenant";

/**
 * Payment gateway webhook (docs/02 §6: "webhook (signed, idempotent) →
 * payment record → outbox → SAP incoming-payment posting with clearing").
 *
 * This route is **public** — it has no session, because the caller is the
 * gateway, not a person. It is not unguarded: the signature over the raw
 * body is the authentication, and it is checked before the body is parsed or
 * anything is looked up (the same reasoning as the applicant's draft token,
 * ADR-009 — a public route with its own proof of authenticity).
 *
 * Three things this handler does deliberately:
 *
 *  - **Reads the raw body, once.** Every HMAC scheme signs bytes, and
 *    `request.json()` would re-serialize them into something that no longer
 *    verifies.
 *  - **Takes the tenant from the host, never the body.** The body is
 *    attacker-controlled until the signature verifies, and even after that a
 *    tenant id inside it would let one tenant's gateway post against
 *    another's payments.
 *  - **Answers 200 to things it can't act on.** A webhook for an unknown
 *    payment, or a duplicate of one already applied, is acknowledged — a
 *    gateway retries anything else forever, and a retry storm is a worse
 *    failure than a dropped notification about a payment we don't have.
 */
export const runtime = "nodejs";

/** Razorpay's header; the mock signs the same way under our own name. */
const SIGNATURE_HEADERS = ["x-razorpay-signature", "x-cc-signature"];

export async function POST(request: Request) {
  const tenant = await resolveRequestTenant();
  if (!tenant) {
    // No tenant for this host: nothing to post against, and saying more
    // would confirm which hosts are real.
    return NextResponse.json({ received: true }, { status: 200 });
  }

  const rawBody = await request.text();
  const signature =
    SIGNATURE_HEADERS.map((header) => request.headers.get(header)).find(Boolean) ?? "";

  try {
    const [sap, gateway] = await Promise.all([
      getSapAdapterForTenant(tenant.id),
      getPaymentGatewayForTenant(tenant.id),
    ]);

    const result = await handleGatewayWebhook(tenant.id, rawBody, signature, { sap, gateway });
    return NextResponse.json(result, { status: 200 });
  } catch (error) {
    if (isPaymentError(error)) {
      // A bad signature is the one case that must NOT look like success: it
      // is either a misconfigured secret or an attack, and both need to be
      // visible in the gateway's delivery log and ours.
      if (error.code === "invalid_signature") {
        return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
      }

      // The money is taken but SAP wouldn't post it. 200, deliberately: the
      // gateway has done its job and redelivering won't help — the payment
      // is recorded as `captured` and reconciliation owns it from here.
      if (error.code === "posting_failed") {
        return NextResponse.json(
          { received: true, posted: false, reason: "awaiting_sap_posting" },
          { status: 200 },
        );
      }

      return NextResponse.json({ received: true, applied: false }, { status: 200 });
    }
    throw error;
  }
}
