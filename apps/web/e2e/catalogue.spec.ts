import { expect, test, type Page } from "@playwright/test";

/**
 * Module 2 happy path: a buyer browses the catalogue at their own prices,
 * opens a product, adds it to the cart, and edits the cart in the drawer.
 *
 * Everything is on the mock SAP driver, so the prices and stock asserted
 * here are the seeded landscape — no SAP in sight (docs/06, mock-first).
 */

const PASSWORD = "portal-dev-password";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  // Wait for the cookie to land — navigating earlier bounces off middleware.
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/**
 * The cart is per sold-to account and deliberately persistent, so it
 * survives between runs — a suite that assumed an empty one would pass only
 * on a fresh database. Issued from inside the page so it carries the tenant
 * host and the session cookie.
 */
async function emptyCart(page: Page) {
  await page.evaluate(() => fetch("/api/cart", { method: "DELETE" }).then(() => undefined));
}

test.describe("product catalogue", () => {
  test("a buyer browses, filters, and adds an item to the cart", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await emptyCart(page);

    await page.getByRole("link", { name: "Catalogue" }).click();
    await expect(page.getByRole("heading", { name: "Catalogue" })).toBeVisible();

    // Price and stock are lazy per card (docs/05 §7.2) — they arrive after
    // the card itself, hence waiting on the price rather than the heading.
    const pumpCard = page.locator("article", { hasText: "Hydraulic Pump HP-200" });
    await expect(pumpCard.getByText("your price", { exact: false })).toBeVisible();
    await expect(pumpCard.getByText("In stock")).toBeVisible();

    // Filtering is a URL state, so it survives a share or a reload.
    await page.getByLabel("Material group").selectOption("VALVES");
    await expect(page).toHaveURL(/group=VALVES/);
    await expect(page.locator("article", { hasText: "Control Valve CV-50" })).toBeVisible();
    await expect(page.locator("article", { hasText: "Hydraulic Pump HP-200" })).toHaveCount(0);

    await page.getByRole("button", { name: "Clear" }).click();

    // --- Add to cart -----------------------------------------------------
    await pumpCard.getByRole("button", { name: "Add to Cart" }).click();

    const drawer = page.getByRole("dialog", { name: "Cart" });
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText("Hydraulic Pump HP-200")).toBeVisible();
    await expect(drawer.getByText("Net value (ex-GST)")).toBeVisible();

    // --- Edit the line ---------------------------------------------------
    await drawer.getByRole("button", { name: /Increase Quantity of MAT-10001/ }).click();
    await expect(drawer.getByRole("textbox", { name: "Quantity of MAT-10001" })).toHaveValue("2");

    await drawer.getByRole("button", { name: /Remove MAT-10001 from cart/ }).click();
    await expect(drawer.getByText("Your cart is empty")).toBeVisible();
  });

  test("the product detail page shows plant-wise stock and the customer's condition record", async ({
    page,
  }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/catalogue/MAT-10001");

    await expect(page.getByRole("heading", { name: "Hydraulic Pump HP-200" })).toBeVisible();
    await expect(page.getByText("Your price")).toBeVisible();
    await expect(page.getByText("Condition record")).toBeVisible();

    // Two seeded plants hold this material.
    await expect(page.getByRole("cell", { name: "1000", exact: true })).toBeVisible();
    await expect(page.getByRole("cell", { name: "2000", exact: true })).toBeVisible();
  });

  test("MOQ is enforced on the stepper before SAP ever sees the line", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    // MVKE-MINBM is 5 for this valve.
    await page.goto("/catalogue/MAT-10003");

    const stepper = page.getByRole("textbox", { name: "Quantity of MAT-10003" });
    await expect(stepper).toHaveValue("5");
    await expect(page.getByText("Minimum order quantity 5 EA")).toBeVisible();

    // The step is the MOQ, not 1: fractions of a MOQ aren't orderable.
    await page.getByRole("button", { name: /Increase Quantity of MAT-10003/ }).click();
    await expect(stepper).toHaveValue("10");
  });

  test("the price list shows customer-specific prices with their validity", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/catalogue/price-list");

    await expect(page.getByRole("heading", { name: "Your price list" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Your price" })).toBeVisible();
    await expect(page.getByRole("columnheader", { name: "Condition" })).toBeVisible();
    await expect(page.getByRole("link", { name: "MAT-10001" })).toBeVisible();
  });

  test("a session without `cart:manage` cannot add to a cart", async ({ page }) => {
    // The buyer plane is one role now (doc 09 §1), so the denial worth
    // asserting is plane-vs-plane: an `ap_manager` session exists in the
    // tenant and holds no `cart:manage`. The API is the control (docs/05 §4.3).
    await signIn(page, "ap@acme.example");

    // Issued from inside the page so it carries the tenant host — the API
    // context can't resolve `acme.localhost`, and hitting 127.0.0.1 would
    // exercise a different tenant resolution than the one under test.
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/cart/lines", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ material: "MAT-10001", quantity: 1 }),
      });
      return response.status;
    });
    expect(status).toBe(403);
  });
});
