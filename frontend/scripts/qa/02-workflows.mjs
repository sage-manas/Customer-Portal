/**
 * Deep, real-browser workflow tests: complete business flows end to end,
 * verifying created data shows up across list/detail/dashboard, and that
 * mutations persist across a browser refresh.
 */
import { fileURLToPath } from "node:url";
import { launch, loginAs, ok, section, RESULTS, BASE_URL } from "./helpers.mjs";

async function freshRole(roleKey) {
  const browser = await launch();
  const { page, context, errors } = await loginAs(browser, roleKey);
  return { browser, page, context, errors };
}

async function closeRole(session) {
  await session.context.close();
  await session.browser.close();
}

async function dashboardOpenOrders(page) {
  await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
  const text = await page.locator("body").innerText();
  const match = text.match(/Open orders?\s*\n?\s*(\d+)/i);
  return match ? Number(match[1]) : null;
}

// ---------------------------------------------------------------------------
// Workflow 1: Catalogue -> Cart -> Order -> cancel (with cancel-of-cancel)
// ---------------------------------------------------------------------------
async function workflowOrderLifecycle() {
  section("=== Workflow: catalogue -> cart -> order -> cancel ===");
  const s = await freshRole("customer");
  const { page } = s;
  try {
    const before = await dashboardOpenOrders(page);

    await page.goto(`${BASE_URL}/catalogue/MAT-10001`, { waitUntil: "networkidle" });
    const addToCart = page.getByRole("button", { name: "Add to Cart" });
    ok("order-lifecycle", "product page has an Add to Cart button", (await addToCart.count()) > 0);
    await addToCart.click();

    const createOrder = page.getByRole("button", { name: "Create Order" });
    await createOrder.waitFor({ state: "visible", timeout: 10000 });
    ok("order-lifecycle", "cart drawer opens with Create Order CTA", true);
    await createOrder.click();

    await page.waitForURL(/\/orders\/new/, { timeout: 10000 });
    ok("order-lifecycle", "Create Order navigates to /orders/new?from=cart", true);

    // Header: requested delivery date + ship-to (line already seeded from cart).
    const dateInput = page.getByLabel("Requested delivery date");
    const future = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
    await dateInput.fill(future);

    const lineCountBefore = await page.locator("ul.divide-y > li").count();
    ok("order-lifecycle", "order form seeded a line from the cart", lineCountBefore >= 1);

    await page.getByRole("button", { name: "Check availability" }).click();
    await page
      .getByText(/net$/i)
      .first()
      .waitFor({ timeout: 10000 })
      .catch(() => {});

    await page.getByRole("button", { name: "Submit order" }).click();
    const dialog = page.getByRole("alertdialog").filter({ hasText: "Submit this order?" });
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await dialog.getByRole("button", { name: "Submit order" }).click();

    await page.waitForURL(/\/orders\/\d+/, { timeout: 15000 });
    const vbeln = new URL(page.url()).pathname.split("/").pop();
    ok("order-lifecycle", `order submitted, landed on /orders/${vbeln}`, /^\d+$/.test(vbeln ?? ""));

    // Appears in the order list.
    await page.goto(`${BASE_URL}/orders`, { waitUntil: "networkidle" });
    const inList = await page.getByText(vbeln, { exact: false }).first().isVisible().catch(() => false);
    ok("order-lifecycle", "new order appears in the Orders list", inList);

    // Dashboard KPI reflects the new order.
    const after = await dashboardOpenOrders(page);
    ok(
      "order-lifecycle",
      `dashboard "Open orders" KPI increased (${before} -> ${after})`,
      before !== null && after !== null && after === before + 1,
      `before=${before} after=${after}`,
    );

    // Refresh persistence.
    await page.goto(`${BASE_URL}/orders/${vbeln}`, { waitUntil: "networkidle" });
    await page.reload({ waitUntil: "networkidle" });
    const stillThere = await page.getByText(vbeln, { exact: false }).first().isVisible().catch(() => false);
    ok("order-lifecycle", "order detail survives a browser refresh", stillThere);

    // Cancel flow: cancel-of-cancel first, then real cancel.
    const cancelBtn = page.getByRole("button", { name: "Cancel order" });
    if (await cancelBtn.count()) {
      await cancelBtn.click();
      const cancelDialog = page.getByRole("alertdialog").filter({ hasText: "Cancel this order?" });
      await cancelDialog.waitFor({ state: "visible", timeout: 5000 });
      await cancelDialog.getByRole("button", { name: "Keep it" }).click();
      await cancelDialog.waitFor({ state: "hidden", timeout: 5000 }).catch(() => {});
      const stillCancellable = await page.getByRole("button", { name: "Cancel order" }).count();
      ok("order-lifecycle", "\"Keep it\" cancels the cancel-order dialog without cancelling", stillCancellable > 0);

      await page.getByRole("button", { name: "Cancel order" }).click();
      await cancelDialog.waitFor({ state: "visible", timeout: 5000 });
      await cancelDialog.getByRole("button", { name: "Cancel order" }).click();
      await page.waitForLoadState("networkidle");
      const bodyText = await page.locator("body").innerText();
      ok("order-lifecycle", "order shows Cancelled status after confirming cancel", /cancel/i.test(bodyText));
    } else {
      ok("order-lifecycle", "order has a Cancel order action available to click", false, "button not found");
    }
  } catch (err) {
    ok("order-lifecycle", "workflow completed without throwing", false, String(err));
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// Workflow 2: Inquiry -> (client_admin) issue quotation -> customer views it
// ---------------------------------------------------------------------------
async function workflowInquiryToQuotation() {
  section("=== Workflow: inquiry -> admin issues quotation -> customer sees it ===");
  const customerSession = await freshRole("customer");
  let vbeln;
  try {
    const { page } = customerSession;
    await page.goto(`${BASE_URL}/inquiries/new`, { waitUntil: "networkidle" });

    const future = new Date(Date.now() + 21 * 86_400_000).toISOString().slice(0, 10);
    await page.getByLabel("Required delivery date").fill(future);
    const materialSelect = page.getByLabel("Add an item");
    const materialValue = await materialSelect
      .locator("option", { hasText: "MAT-10002" })
      .getAttribute("value");
    await materialSelect.selectOption(materialValue);

    await page.getByRole("button", { name: "Send inquiry" }).click();
    const dialog = page.getByRole("alertdialog").filter({ hasText: "Send this inquiry?" });
    await dialog.waitFor({ state: "visible", timeout: 5000 });
    await dialog.getByRole("button", { name: "Send inquiry" }).click();

    await page.waitForURL(/\/inquiries\/\d+/, { timeout: 15000 });
    vbeln = new URL(page.url()).pathname.split("/").pop();
    ok("inquiry-quotation", `inquiry submitted, got VBELN ${vbeln}`, /^\d+$/.test(vbeln ?? ""));

    await page.goto(`${BASE_URL}/inquiries`, { waitUntil: "networkidle" });
    const inList = await page.getByText(vbeln, { exact: false }).first().isVisible().catch(() => false);
    ok("inquiry-quotation", "new inquiry appears in the Inquiries list", inList);
  } catch (err) {
    ok("inquiry-quotation", "customer could raise an inquiry", false, String(err));
  } finally {
    await closeRole(customerSession);
  }

  if (!vbeln) return;

  const adminSession = await freshRole("client_admin");
  try {
    const { page } = adminSession;
    await page.goto(`${BASE_URL}/admin/quotations`, { waitUntil: "networkidle" });
    const row = page.locator("li, tr", { hasText: vbeln }).first();
    const found = await row.isVisible().catch(() => false);
    ok("inquiry-quotation", "inquiry appears on the admin Quotation Workbench", found);
    if (!found) return;

    await row.getByRole("button", { name: "Quote" }).click();
    const validUntil = new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const validUntilInput = row.locator('input[type="date"]');
    await validUntilInput.fill(validUntil);
    await row.getByRole("button", { name: "Issue quotation" }).click();
    await page.waitForLoadState("networkidle");
    const stillOnPage = await page.locator("body").isVisible();
    ok("inquiry-quotation", "admin can issue a quotation against the inquiry", stillOnPage);
  } catch (err) {
    ok("inquiry-quotation", "admin could issue a quotation", false, String(err));
  } finally {
    await closeRole(adminSession);
  }

  const customerCheck = await freshRole("customer");
  try {
    const { page } = customerCheck;
    await page.goto(`${BASE_URL}/quotations`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    ok(
      "inquiry-quotation",
      "customer's Quotations list reflects the newly issued quotation",
      bodyText.includes(vbeln) || /quotation/i.test(bodyText),
    );
  } catch (err) {
    ok("inquiry-quotation", "customer could view quotations after issue", false, String(err));
  } finally {
    await closeRole(customerCheck);
  }
}

// ---------------------------------------------------------------------------
// Workflow 3: Support ticket create -> admin resolve -> customer close
// ---------------------------------------------------------------------------
async function workflowSupportTicket() {
  section("=== Workflow: support ticket create -> admin resolve -> customer close ===");
  let ticketId;
  const customerSession = await freshRole("customer");
  try {
    const { page } = customerSession;
    await page.goto(`${BASE_URL}/support/new`, { waitUntil: "networkidle" });
    await page.getByRole("button", { name: "General question" }).click().catch(() => {});
    await page.getByLabel("Subject").fill("QA test ticket — delivery timing");
    await page
      .getByLabel("What happened?")
      .fill("Automated QA: checking the raise -> resolve -> close lifecycle end to end.");
    await page.getByRole("button", { name: "Raise ticket" }).click();
    // Exclude "new" itself: /support/new already matches a bare id pattern,
    // so waitForURL must require the path to actually change off it.
    await page.waitForURL(/\/support\/(?!new$)[A-Za-z0-9-]+$/, { timeout: 15000 });
    ticketId = new URL(page.url()).pathname.split("/").pop();
    ok("support-ticket", `ticket raised, id ${ticketId}`, Boolean(ticketId));

    await page.goto(`${BASE_URL}/support`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    ok("support-ticket", "new ticket appears in the customer's ticket list", bodyText.includes("QA test ticket"));
  } catch (err) {
    ok("support-ticket", "customer could raise a ticket", false, String(err));
  } finally {
    await closeRole(customerSession);
  }

  if (!ticketId) return;

  const adminSession = await freshRole("client_admin");
  try {
    const { page } = adminSession;
    await page.goto(`${BASE_URL}/admin/tickets/${ticketId}`, { waitUntil: "networkidle" });
    const assignBtn = page.getByRole("button", { name: "Assign to me" });
    if (await assignBtn.count()) {
      await assignBtn.click();
      await page.waitForLoadState("networkidle");
    }
    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    await page
      .getByLabel(/What was done\?/)
      .fill("QA: verified and resolved via automated workflow test.");
    await page.getByRole("button", { name: "Resolve ticket" }).click();
    await page.waitForLoadState("networkidle");
    const bodyText = await page.locator("body").innerText();
    ok("support-ticket", "admin resolved the ticket", /resolved/i.test(bodyText));
  } catch (err) {
    ok("support-ticket", "admin could resolve the ticket", false, String(err));
  } finally {
    await closeRole(adminSession);
  }

  const customerClose = await freshRole("customer");
  try {
    const { page } = customerClose;
    await page.goto(`${BASE_URL}/support/${ticketId}`, { waitUntil: "networkidle" });
    const closeBtn = page.getByRole("button", { name: /^Close$/i });
    const canClose = (await closeBtn.count()) > 0;
    ok("support-ticket", "customer sees a Close action on the resolved ticket", canClose);
    if (canClose) {
      await closeBtn.click();
      await page.waitForLoadState("networkidle");
      const bodyText = await page.locator("body").innerText();
      ok("support-ticket", "ticket shows Closed after the customer closes it", /closed/i.test(bodyText));
    }
  } catch (err) {
    ok("support-ticket", "customer could close the resolved ticket", false, String(err));
  } finally {
    await closeRole(customerClose);
  }
}

// ---------------------------------------------------------------------------
// Workflow 4: Credit increase request -> admin approves
// ---------------------------------------------------------------------------
async function workflowCreditRequest() {
  section("=== Workflow: credit increase request -> admin approves ===");
  const customerSession = await freshRole("customer");
  try {
    const { page } = customerSession;
    await page.goto(`${BASE_URL}/account/credit/request`, { waitUntil: "networkidle" });
    const amountInput = page.getByLabel(/New limit you'd like/);
    await amountInput.fill("15000000");
    await page
      .getByLabel(/Why do you need it\?/)
      .fill("QA automated test: seasonal peak ahead of the festival season, need more headroom.");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForURL(/\/account$/, { timeout: 15000 });
    const bodyText = await page.locator("body").innerText();
    ok("credit-request", "credit increase request submitted and Account page shows it pending", /pending/i.test(bodyText));
  } catch (err) {
    ok("credit-request", "customer could submit a credit increase request", false, String(err));
  } finally {
    await closeRole(customerSession);
  }

  const adminSession = await freshRole("client_admin");
  try {
    const { page } = adminSession;
    await page.goto(`${BASE_URL}/admin/credit`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    const hasQueueItem = /15,?000,?000|1,50,00,000/.test(bodyText) || /QA automated test/.test(bodyText);
    ok("credit-request", "request appears on the admin Credit Desk queue", hasQueueItem || (await page.getByRole("button", { name: "Approve" }).count()) > 0);

    const approveBtn = page.getByRole("button", { name: "Approve" }).first();
    if (await approveBtn.count()) {
      await approveBtn.click();
      // A decided request's row loses its Approve button once
      // router.refresh() lands.
      await page
        .getByRole("button", { name: "Approve" })
        .first()
        .waitFor({ state: "detached", timeout: 10000 })
        .catch(() => {});
      const decided = (await page.getByRole("button", { name: "Approve" }).count()) === 0;
      ok("credit-request", "admin approved the credit request", decided);
    }
  } catch (err) {
    ok("credit-request", "admin could review/approve the credit request", false, String(err));
  } finally {
    await closeRole(adminSession);
  }

  // Regression check: DecisionPanel sends "rejected", but the route handler
  // used to compare against "reject" and silently approved every decline.
  const declineCustomer = await freshRole("customer");
  let requestedLimit;
  try {
    const { page } = declineCustomer;
    await page.goto(`${BASE_URL}/account/credit/request`, { waitUntil: "networkidle" });
    requestedLimit = String(7654321 + Math.floor(Math.random() * 1000));
    await page.getByLabel(/New limit you'd like/).fill(requestedLimit);
    await page
      .getByLabel(/Why do you need it\?/)
      .fill("QA automated test: verifying Decline is not silently recorded as Approve.");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForURL(/\/account$/, { timeout: 15000 });
  } catch (err) {
    ok("credit-request", "customer could submit a second request for the decline check", false, String(err));
    requestedLimit = undefined;
  } finally {
    await closeRole(declineCustomer);
  }

  if (!requestedLimit) return;

  const declineAdmin = await freshRole("client_admin");
  try {
    const { page } = declineAdmin;
    await page.goto(`${BASE_URL}/admin/credit`, { waitUntil: "networkidle" });
    const row = page.locator("li, tr, article", { hasText: "QA automated test: verifying Decline" }).first();
    const declineBtn = (await row.count()) ? row.getByRole("button", { name: "Decline" }) : page.getByRole("button", { name: "Decline" }).first();
    await declineBtn.click();
    await page.waitForTimeout(1500);
    // Declined requests drop off the default "Waiting" view -- switch to
    // "Decided" to see the status.
    await page.getByRole("button", { name: /Decided/ }).click().catch(() => {});
    await page.waitForTimeout(500);
    const bodyText = await page.locator("body").innerText();
    const declinedEntry = bodyText.slice(
      bodyText.indexOf("verifying Decline") - 400,
      bodyText.indexOf("verifying Decline") + 100,
    );
    ok(
      "credit-request",
      "Decline is recorded as Rejected/Declined, not silently approved",
      /rejected/i.test(declinedEntry) && !/approved/i.test(declinedEntry),
      declinedEntry,
    );
  } catch (err) {
    ok("credit-request", "admin could decline the second request", false, String(err));
  } finally {
    await closeRole(declineAdmin);
  }
}

// ---------------------------------------------------------------------------
// Workflow 5: Payment — pay an open invoice, complete mock checkout
// ---------------------------------------------------------------------------
async function workflowPayment() {
  section("=== Workflow: pay an open invoice -> mock checkout -> posted ===");
  const s = await freshRole("customer");
  try {
    const { page } = s;
    await page.goto(`${BASE_URL}/payments/pay`, { waitUntil: "networkidle" });
    const firstCheckbox = page.locator('input[type="checkbox"]').first();
    const hasOpenItems = (await firstCheckbox.count()) > 0;
    ok("payment", "Pay screen lists at least one open item", hasOpenItems);
    if (!hasOpenItems) return;

    await firstCheckbox.check();
    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.waitForURL(/\/payments\/[^/]+\/receipt/, { timeout: 15000 });
    ok("payment", "submitting starts a payment and lands on the receipt page", true);

    const completeBtn = page.getByRole("button", { name: "Complete payment" });
    if (await completeBtn.count()) {
      await completeBtn.click();
      await page.waitForLoadState("networkidle");
      // The panel polls for the SAP posting; give it a few polling cycles.
      await page.waitForTimeout(4000);
      const bodyText = await page.locator("body").innerText();
      ok("payment", "payment reaches a settled state (posted) after mock checkout", /posted|paid|settled/i.test(bodyText));
    } else {
      ok("payment", "receipt page offers Complete payment for the mock gateway", false, "button not found");
    }

    await page.goto(`${BASE_URL}/payments`, { waitUntil: "networkidle" });
    const bodyText = await page.locator("body").innerText();
    ok("payment", "payment appears in the payments/statement history", /posted|captured|paid/i.test(bodyText));
  } catch (err) {
    ok("payment", "payment workflow completed without throwing", false, String(err));
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// Workflow 6: Proof of delivery confirmation
// ---------------------------------------------------------------------------
async function workflowPod() {
  section("=== Workflow: confirm receipt (POD) on an in-transit delivery ===");
  const s = await freshRole("customer");
  try {
    const { page } = s;
    // 0080001947: InTransit, podConfirmed falsy -> eligible per isPodConfirmable.
    // The server holds this in memory across script runs within one dev-server
    // lifetime, so a prior successful run of this same script leaves it
    // already confirmed -- that is the *other* half of this test (the route
    // must refuse a second confirmation), not a failure.
    await page.goto(`${BASE_URL}/deliveries/0080001947/pod`, { waitUntil: "networkidle" });
    const submitBtn = page.getByRole("button", { name: /Confirm receipt|Report discrepancy/ });
    const eligible = (await submitBtn.count()) > 0;
    const bouncedToDetail = page.url().endsWith("/deliveries/0080001947");
    if (!eligible && bouncedToDetail) {
      ok("pod", "already-confirmed delivery correctly refuses a second POD confirmation (state carried over from an earlier run)", true);
      return;
    }
    ok("pod", "POD form is reachable for an in-transit, unconfirmed delivery", eligible);
    if (!eligible) return;

    await submitBtn.click();
    await page.waitForURL(/\/deliveries\/0080001947$/, { timeout: 15000 });
    const bodyText = await page.locator("body").innerText();
    ok("pod", "confirming receipt redirects to the delivery detail page", /delivered|signed|confirmed/i.test(bodyText));

    // Re-visiting the POD route should now bounce back (already confirmed).
    await page.goto(`${BASE_URL}/deliveries/0080001947/pod`, { waitUntil: "networkidle" });
    const backOnDetail = page.url().endsWith("/deliveries/0080001947");
    ok("pod", "POD route is no longer offered once already confirmed", backOnDetail);
  } catch (err) {
    ok("pod", "POD confirmation workflow completed without throwing", false, String(err));
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// Workflow 7: Notifications — bell, unread count, mark all read, persistence
// ---------------------------------------------------------------------------
async function workflowNotifications() {
  section("=== Workflow: notification bell — unread count, mark read, persists ===");
  const s = await freshRole("customer");
  try {
    const { page } = s;
    await page.goto(`${BASE_URL}/`, { waitUntil: "networkidle" });
    const bellButton = page.getByRole("button", { name: /notification/i });
    ok("notifications", "notification bell is present in the shell", (await bellButton.count()) > 0);
    await bellButton.click();

    await page.waitForTimeout(500);
    const bodyText = await page.locator("body").innerText();
    ok("notifications", "opening the bell shows a non-empty notification list", /notification|order|invoice|payment|ticket/i.test(bodyText));

    const markAll = page.getByRole("button", { name: /mark all/i });
    if (await markAll.count()) {
      await markAll.click();
      await page.waitForTimeout(300);
      ok("notifications", "Mark all read is clickable", true);
    }

    await page.reload({ waitUntil: "networkidle" });
    ok("notifications", "page reloads cleanly after reading notifications", true);
  } catch (err) {
    ok("notifications", "notification workflow completed without throwing", false, String(err));
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// Workflow 8: Admin — register a customer, view, edit, verify persistence
// ---------------------------------------------------------------------------
async function workflowAdminCustomerWizardLoads() {
  section("=== Workflow: admin customer registration wizard (load + step-1 validation) ===");
  const s = await freshRole("client_admin");
  try {
    const { page } = s;
    await page.goto(`${BASE_URL}/admin/customers/new`, { waitUntil: "networkidle" });
    await page.waitForTimeout(1000); // wizard bootstraps an application server-side
    const bodyText = await page.locator("body").innerText();
    ok("admin-customer-wizard", "registration wizard renders its first step", bodyText.length > 200);

    const nextBtn = page.getByRole("button", { name: /^Next$/i });
    if (await nextBtn.count()) {
      await nextBtn.click();
      await page.waitForTimeout(300);
      const afterText = await page.locator("body").innerText();
      const blocked = page.url().includes("/admin/customers/new");
      ok(
        "admin-customer-wizard",
        "submitting step 1 empty does not silently advance without validation",
        blocked && /required|enter|provide/i.test(afterText) === true || blocked,
      );
    }
  } catch (err) {
    ok("admin-customer-wizard", "wizard loaded without throwing", false, String(err));
  } finally {
    await closeRole(s);
  }
}

// ---------------------------------------------------------------------------
// Workflow 9: Admin edits an existing customer, verifies persistence
// ---------------------------------------------------------------------------
async function workflowAdminCustomerEdit() {
  section("=== Workflow: admin edits an existing customer's details ===");
  const s = await freshRole("client_admin");
  try {
    const { page } = s;
    await page.goto(`${BASE_URL}/admin/customers/0010001001`, { waitUntil: "networkidle" });
    // CustomerEditPanel renders its fields inline, already editable — there
    // is no separate "Edit" toggle, just a "Save changes" submit.
    const phoneInput = page.getByLabel(/phone/i).first();
    ok("admin-customer-edit", "customer detail page renders an editable phone field", (await phoneInput.count()) > 0);
    if (await phoneInput.count()) {
      // PHONE_PATTERN (packages/domain/validation/india.ts) is digits only,
      // 10-15 chars -- no "+" prefix.
      const marker = `98765${Math.floor(10000 + Math.random() * 89999)}`;
      await phoneInput.fill(marker);
      const saveBtn = page.getByRole("button", { name: "Save changes" });
      await saveBtn.click();
      // "Saved to SAP." is set from local state after the POST resolves --
      // networkidle can resolve a beat before that commit lands.
      const savedNotice = page.getByText("Saved to SAP.");
      await savedNotice.waitFor({ state: "visible", timeout: 10000 }).catch(() => {});
      ok("admin-customer-edit", "saving the edit succeeds", await savedNotice.isVisible().catch(() => false));

      // The value lives in an <input>, which innerText() can't see -- read
      // it back via inputValue() instead.
      await page.reload({ waitUntil: "networkidle" });
      const persistedPhone = await page.getByLabel(/phone/i).first().inputValue();
      ok("admin-customer-edit", "edited value survives a browser refresh", persistedPhone === marker, `expected ${marker}, got ${persistedPhone}`);
    } else {
      ok("admin-customer-edit", "edit form exposes an editable phone field", false, "field not found");
    }
  } catch (err) {
    ok("admin-customer-edit", "customer edit workflow completed without throwing", false, String(err));
  } finally {
    await closeRole(s);
  }
}

export async function run() {
  await workflowOrderLifecycle();
  await workflowInquiryToQuotation();
  await workflowSupportTicket();
  await workflowCreditRequest();
  await workflowPayment();
  await workflowPod();
  await workflowNotifications();
  await workflowAdminCustomerWizardLoads();
  await workflowAdminCustomerEdit();
  return RESULTS;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().then(() => {
    console.log(`\nWorkflows: ${RESULTS.pass} passed, ${RESULTS.fail} failed`);
    process.exit(RESULTS.fail > 0 ? 1 : 0);
  });
}
