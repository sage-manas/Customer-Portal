/**
 * Write-path smoke test for the demo service layer.
 *
 * The route sweep proves every screen *renders*; this proves the mutations
 * behind them actually do something — add a cart line and read it back,
 * place an order and find it on the list, raise a ticket, ask for a credit
 * increase and decide it from the desk, approve an onboarding application
 * and get a KUNNR from SAP.
 *
 * Run with:  npx tsx scripts/demo-smoke.ts
 *
 * TODO(BACKEND):
 * When the real services return, this file should be deleted in favour of
 * the Playwright suite in client/apps/web/e2e, which covers the same flows
 * against a real backend.
 */

import * as catalogue from "../packages/services/catalogue";
import * as inquiry from "../packages/services/inquiry";
import * as loyalty from "../packages/services/loyalty";
import * as onboarding from "../packages/services/onboarding";
import * as order from "../packages/services/order";
import * as payment from "../packages/services/payment";
import { getSapAdapterForTenant } from "../packages/services/sap";
import * as support from "../packages/services/support";

const TENANT = "tenant-acme";
const KUNNR = "0010001001";

let failures = 0;

function check(label: string, condition: unknown, detail = ""): void {
  if (condition) {
    console.log(`  ok    ${label}`);
  } else {
    failures += 1;
    console.log(`  FAIL  ${label} ${detail}`);
  }
}

async function main() {
  const sap = await getSapAdapterForTenant(TENANT);

  console.log("\ncart");
  const empty = await catalogue.getCart(TENANT, KUNNR, sap);
  check("starts empty", empty.lines.length === 0);
  const added = await catalogue.addToCart(sap, TENANT, KUNNR, {
    material: "MAT-10001",
    quantity: 2,
  });
  check("add line", added.lines.length === 1 && added.lines[0]!.quantity === 2);
  check("line is priced", (added.lines[0]!.netPrice ?? 0) > 0, String(added.lines[0]!.netPrice));
  check("cart total follows", added.netValue > 0, String(added.netValue));
  const reread = await catalogue.getCart(TENANT, KUNNR, sap);
  check("persists across reads", reread.lines.length === 1);
  const bumped = await catalogue.updateCartLine(sap, TENANT, KUNNR, added.lines[0]!.id, 5);
  check("quantity change reprices", bumped.netValue > added.netValue);
  const removed = await catalogue.removeCartLine(sap, TENANT, KUNNR, added.lines[0]!.id);
  check("remove line", removed.lines.length === 0);

  console.log("\norders");
  const defaults = await order.getOrderFormDefaults(sap, KUNNR);
  check("ship-tos available", defaults.shipTos.length > 0);
  const availability = await order.checkAvailability(sap, KUNNR, {
    requestedDeliveryDate: "2026-08-30",
    shipTo: defaults.shipTos[0]!.kunnr,
    lines: [{ material: "MAT-10001", quantity: 1, uom: "EA" }],
  } as never);
  check("ATP confirms", availability.lines.length === 1);
  const before = await order.listOrders(sap, KUNNR);
  const created = await order.createOrder(sap, KUNNR, {
    requestedDeliveryDate: "2026-08-30",
    shipTo: defaults.shipTos[0]!.kunnr,
    customerPoRef: `SMOKE-${Date.now()}`,
    lines: [{ material: "MAT-10001", quantity: 1, uom: "EA" }],
  } as never);
  check("order gets a VBELN", Boolean(created.vbeln), created.vbeln);
  const after = await order.listOrders(sap, KUNNR);
  check("appears on the list", after.total === before.total + 1);
  const detail = await order.getOrder(sap, KUNNR, created.vbeln);
  check("detail reads back", detail.order.vbeln === created.vbeln);
  check("O2C timeline built", detail.timeline.length > 0);

  console.log("\ncross-account isolation");
  const otherAccountOrder = await order
    .getOrder(sap, "0010001002", created.vbeln)
    .then(() => null)
    .catch((error: unknown) => error as { status?: number; code?: string });
  check(
    "another account's order is a 404, not a 403",
    otherAccountOrder?.status === 404 && otherAccountOrder?.code === "not_found",
    JSON.stringify(otherAccountOrder),
  );

  console.log("\ninquiries & quotations");
  const raised = await inquiry.createInquiry(
    sap,
    { tenantId: TENANT, kunnr: KUNNR },
    {
      requiredDeliveryDate: "2026-09-15",
      lines: [{ material: "MAT-10003", quantity: 10, uom: "EA" }],
    } as never,
  );
  check("inquiry gets a VBELN", Boolean(raised.vbeln), raised.vbeln);
  const queue = await inquiry.listInquiryQueue(sap);
  check("shows on the sales desk queue", queue.inquiries.some((row) => row.vbeln === raised.vbeln));
  const issued = await inquiry.issueQuotation(sap, { tenantId: TENANT }, {
    inquiryVbeln: raised.vbeln,
    validUntil: "2026-09-30",
  });
  check("desk can issue a quotation", Boolean(issued.vbeln), issued.vbeln);
  const quotation = await inquiry.getQuotation(sap, { tenantId: TENANT, kunnr: KUNNR }, issued.vbeln);
  check("quotation validity derived", Boolean(quotation.validity.state), quotation.validity.state);
  check("quotation tax from SAP conditions", quotation.tax.grossAmount > 0);

  console.log("\nsupport");
  const ticket = await support.createTicket(
    { tenantId: TENANT, kunnr: KUNNR, userId: "demo-customer" },
    {
      category: "delivery",
      priority: "high",
      subject: "Smoke test ticket",
      description: "Raised by scripts/demo-smoke.ts",
    },
  );
  check("ticket gets a number", ticket.ticketNo.startsWith("TKT-"), ticket.ticketNo);
  check("SLA derived on read", Boolean(ticket.sla.state), ticket.sla.state);
  const workbench = await support.listWorkbench({ tenantId: TENANT, userId: "demo-client-admin" });
  check("appears on the agent workbench", workbench.tickets.some((row) => row.id === ticket.id));
  const resolved = await support.resolveTicket(
    { tenantId: TENANT, userId: "demo-client-admin" },
    ticket.id,
    "Resolved in the smoke test.",
  );
  check("agent can resolve", resolved.status === "resolved");
  const closed = await support.transitionTicketAsCustomer(
    { tenantId: TENANT, kunnr: KUNNR, userId: "demo-customer" },
    ticket.id,
    "closed",
  );
  check("customer can close a resolved ticket", closed.status === "closed");

  console.log("\ncredit desk");
  const position = await loyalty.getCreditPosition(sap, { tenantId: TENANT, kunnr: KUNNR });
  check("credit position reads", position.position.creditLimit > 0);
  const request = await loyalty.requestCreditIncrease(
    { tenantId: TENANT, kunnr: KUNNR, userId: "demo-customer" },
    {
      requestedLimit: position.position.creditLimit * 2,
      justification: "Smoke test justification, long enough to pass.",
      currentLimit: position.position.creditLimit,
    },
  );
  check("request is pending", request.status === "pending");
  const deskQueue = await loyalty.listCreditRequestQueue({ tenantId: TENANT });
  check("shows on the credit desk", deskQueue.requests.some((row) => row.id === request.id));
  const decided = await loyalty.decideCreditRequest(
    { tenantId: TENANT, userId: "demo-client-admin" },
    request.id,
    { decision: "approve", note: "Approved in the smoke test." },
  );
  check("desk can approve", decided.status === "approved");
  const duplicate = await loyalty
    .requestCreditIncrease(
      { tenantId: TENANT, kunnr: KUNNR, userId: "demo-customer" },
      {
        requestedLimit: position.position.creditLimit * 3,
        justification: "Second request, should be allowed after a decision.",
        currentLimit: position.position.creditLimit,
      },
    )
    .then((row) => row.status)
    .catch(() => "refused");
  check("a second request is allowed once the first is decided", duplicate === "pending");

  console.log("\nonboarding");
  const started = await onboarding.startApplication(TENANT);
  const handle = { applicationId: started.application.id, draftToken: started.draftToken };
  // The fields the canonical mapper needs; the wizard collects these across
  // its steps (see @cc/domain ONBOARDING_STEPS).
  await onboarding.saveStep(TENANT, handle, 1, {
    legalEntityName: "Smoke Test Industries",
    customerType: "Z001",
    street: "12 Industrial Estate",
    city: "Pune",
    state: "27",
    pinCode: "411019",
    country: "IN",
    contactPerson: "A Tester",
    email: "smoke@example.test",
    phone: "9876500000",
    pan: "AAAAA0000A",
    gstin: "27AAAAA0000A1Z5",
  } as never);
  const verified = await onboarding.verifyApplicationGstin(TENANT, handle, "27AAAAA0000A1Z5");
  check("GSTIN verifies", verified.gstinVerification?.outcome === "verified");
  const wrongToken = await onboarding
    .getDraftApplication(TENANT, { applicationId: handle.applicationId, draftToken: "guessed" })
    .then(() => null)
    .catch((error: unknown) => error as { status?: number });
  check("a wrong draft token is a 404", wrongToken?.status === 404);
  await onboarding.submitApplication(TENANT, handle);
  const pending = await onboarding.listApplications(TENANT, { status: "PendingApproval" });
  check("reaches the review queue", pending.some((row) => row.id === handle.applicationId));
  const approved = await onboarding.approveApplication(sap, TENANT, handle.applicationId, {
    salesOrg: "1000",
    distributionChannel: "10",
    actorUserId: "demo-client-admin",
  });
  check("approval mints a KUNNR in SAP", Boolean(approved.kunnr), approved.kunnr);
  const newCustomer = await sap.getCustomer(approved.kunnr);
  check("and SAP can read it back", newCustomer.data.legalEntityName === "Smoke Test Industries");

  console.log("\npayments");
  const payables = await payment.listPayableItems(sap, KUNNR);
  check("open items to pay", payables.items.length > 0);
  const initiated = await payment.initiatePayment({
    tenantId: TENANT,
    kunnr: KUNNR,
    amount: payables.items[0]!.openAmount,
    mode: "netbanking",
    allocations: [
      {
        documentNumber: payables.items[0]!.documentNumber,
        amount: payables.items[0]!.openAmount,
      },
    ],
  });
  check("payment initiates", initiated.paymentId.startsWith("PAY-"), initiated.paymentId);
  const completed = await payment.completeMockCheckout(sap, {
    tenantId: TENANT,
    paymentId: initiated.paymentId,
    kunnr: KUNNR,
  });
  check("checkout posts to SAP", completed.status === "posted", completed.status);
  check("and gets an FI document", Boolean(completed.fiDocumentNumber), completed.fiDocumentNumber);

  console.log(`\n${failures === 0 ? "PASS" : `FAIL — ${failures} check(s)`}\n`);
  process.exit(failures === 0 ? 0 : 1);
}

void main();
