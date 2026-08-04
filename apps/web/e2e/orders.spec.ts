import { expect, test, type Page } from "@playwright/test";

/**
 * Module 4 happy path: a buyer fills a cart, converts it to an order, checks
 * availability, submits, and lands on an order detail page with the O2C
 * timeline — then cancels it.
 *
 * Everything runs on the mock SAP driver, so the confirmed quantities and
 * dates asserted here come from the seeded landscape (docs/06, mock-first).
 */

const PASSWORD = "portal-dev-password";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** The cart is per account and persistent, so a run must not assume it's empty. */
async function emptyCart(page: Page) {
  await page.evaluate(() => fetch("/api/cart", { method: "DELETE" }).then(() => undefined));
}

/** A fresh PO reference per run: it is the SAP idempotency key. */
const poRef = () => `E2E-${Date.now().toString().slice(-8)}`;

test.describe("sales orders", () => {
  test("a buyer turns a cart into a sales order, checks ATP, and submits", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await emptyCart(page);

    // --- Build a cart ----------------------------------------------------
    await page.goto("/catalogue");
    const pumpCard = page.locator("article", { hasText: "Hydraulic Pump HP-200" });
    await expect(pumpCard.getByText("In stock")).toBeVisible();
    await pumpCard.getByRole("button", { name: "Add to Cart" }).click();

    const drawer = page.getByRole("dialog", { name: "Cart" });
    await expect(drawer).toBeVisible();

    // --- Convert it ------------------------------------------------------
    await drawer.getByRole("button", { name: "Create Order" }).click();
    await expect(page).toHaveURL(/\/orders\/new\?from=cart/);
    await expect(page.getByRole("heading", { name: "New order" })).toBeVisible();

    // The cart's line came across, priced as an estimate rather than as a
    // value the browser will submit. Scoped to `main` because the cart
    // drawer is persistent (docs/05 §7.2) and shows the same material.
    const form = page.getByRole("main");
    await expect(form.getByText("MAT-10001")).toBeVisible();
    await expect(form.getByText("estimate", { exact: true })).toBeVisible();

    const reference = poRef();
    await page.getByLabel("Your PO reference").fill(reference);
    await page.getByLabel("Requested delivery date").fill("2026-09-15");

    // --- ATP -------------------------------------------------------------
    await page.getByRole("button", { name: "Check availability" }).click();
    // 145 EA in stock at plant 1000, so one unit confirms in full on the date
    // asked for. The month abbreviation is whatever en-IN gives it.
    await expect(page.getByText(/1 EA on 15-Sept?-26/)).toBeVisible();
    await expect(page.getByText("all lines confirmed in full")).toBeVisible();

    // --- Submit ----------------------------------------------------------
    await page.getByRole("button", { name: "Submit order" }).click();

    // Doc 05 §6.2: the dialog states the SAP consequence, not just "sure?".
    const dialog = page.getByRole("alertdialog", { name: "Submit this order?" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByText("creates a sales order in SAP immediately")).toBeVisible();
    await dialog.getByRole("button", { name: "Submit order" }).click();

    // --- The order -------------------------------------------------------
    await page.waitForURL(/\/orders\/\d{10}$/);
    await expect(page.getByRole("heading", { name: /^Order \d{10}$/ })).toBeVisible();
    // The header subtitle — the timeline's order stage echoes the reference too.
    await expect(page.getByText(`Your reference ${reference} · placed`)).toBeVisible();

    // The O2C spine (docs/05 P4), with the stages past the order not started.
    const timeline = page.getByRole("region", { name: "Order to cash progress" });
    await expect(timeline.getByText("Credit Check")).toBeVisible();
    await expect(timeline.getByText("Not started")).toHaveCount(3);

    // --- Cancel it, and the list reflects that ---------------------------
    const orderUrl = page.url();
    await page.getByRole("button", { name: "Cancel order" }).click();
    const cancelDialog = page.getByRole("alertdialog", { name: "Cancel this order?" });
    await expect(cancelDialog.getByText("rejects every item")).toBeVisible();
    await cancelDialog.getByRole("button", { name: "Cancel order" }).click();

    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
    await page.goto(orderUrl);
    await expect(page.getByRole("button", { name: "Cancel order" })).toHaveCount(0);
  });

  test("the orders list filters by status and links through to an order", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/orders");

    await expect(page.getByRole("heading", { name: "Orders" })).toBeVisible();
    // Seeded: 0000004711 closed, 0000004712 part-delivered.
    await expect(page.getByRole("link", { name: /0000004712/ })).toBeVisible();

    await page.getByRole("button", { name: "Completed" }).click();
    await expect(page).toHaveURL(/filter=completed/);
    await expect(page.getByRole("link", { name: /0000004711/ })).toBeVisible();
    await expect(page.getByRole("link", { name: /0000004712/ })).toHaveCount(0);

    await page.getByRole("link", { name: /0000004711/ }).click();
    await page.waitForURL(/\/orders\/0000004711$/);

    // The seeded closed order ran the whole chain: delivered, invoiced.
    const timeline = page.getByRole("region", { name: "Order to cash progress" });
    await expect(timeline.getByText("Delivered")).toBeVisible();
    await expect(page.getByRole("link", { name: "Order confirmation (PDF)" })).toBeVisible();
  });

  test("a credit-blocked order says so prominently, and confirms nothing", async ({ page }) => {
    // This user acts for Deccan Fabricators, whose seeded order is on hold.
    await signIn(page, "multi@acme.example");

    await page.evaluate(() =>
      fetch("/api/auth/switch-account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kunnr: "0010001002" }),
      }).then(() => undefined),
    );

    await page.goto("/orders/0000004713");
    await expect(page.getByRole("heading", { name: "Order on credit hold" })).toBeVisible();
    // The card, not the timeline note — both say it, which is the point.
    await expect(page.getByText("Nothing is confirmed or scheduled for delivery")).toBeVisible();
    // VBEP confirms nothing while CMGST = B.
    await expect(page.getByRole("cell", { name: "0 EA" })).toBeVisible();
  });

  test("another customer's order is not found, not forbidden", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    // 0000004713 belongs to a different sold-to account.
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/orders/0000004713");
      return response.status;
    });
    expect(status).toBe(404);
  });

  test("a session without `order:create` cannot place an order", async ({ page }) => {
    // The buyer plane is one role now (doc 09 §1), so the denial worth
    // asserting is plane-vs-plane: an `ap_manager` session exists in the
    // tenant and holds no `order:create`. The API is the control (docs/05 §4.3).
    await signIn(page, "ap@acme.example");

    const status = await page.evaluate(async () => {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedDeliveryDate: "2026-09-15",
          shipTo: "0010001001",
          lines: [{ material: "MAT-10001", quantity: 1, uom: "EA" }],
        }),
      });
      return response.status;
    });
    expect(status).toBe(403);
  });
});
