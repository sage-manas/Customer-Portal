import { expect, test, type Page } from "@playwright/test";

/**
 * Modules 6 & 7 happy paths: a buyer reads an invoice with its GST split and
 * IRN, then pays an open invoice and watches it clear.
 *
 * Everything runs on the mock SAP driver and the mock gateway, so the
 * amounts asserted here come from the seeded landscape (docs/06, mock-first).
 * The payment path deliberately goes the long way round — the "Complete
 * payment" button delivers a genuinely signed webhook through the same
 * handler Razorpay will use — so this spec covers signature verification and
 * the F-28 posting, not just the screens.
 */

const PASSWORD = "portal-dev-password";

/** Seeded for buyer@acme.example: overdue, intra-state, 143252 outstanding. */
const OVERDUE_INVOICE = "0090002190";
/** Seeded: open, 687871.56 outstanding, carries an IRN. */
const OPEN_INVOICE = "0090002211";

async function signIn(page: Page, email: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("invoices", () => {
  test("a buyer reads an invoice with its GST split, IRN and O2C chain", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/invoices");
    await expect(page.getByRole("heading", { name: "Invoices" })).toBeVisible();

    // The aging bar leads: "what do we owe?" before "which invoice?"
    await expect(page.getByRole("region", { name: "Outstanding balance by age" })).toBeVisible();

    // Credit notes are not in this table (ADR-020).
    const table = page.getByRole("table");
    await expect(table.getByText("0090002250")).toHaveCount(0);

    await page.getByRole("link", { name: OPEN_INVOICE }).first().click();
    await expect(page).toHaveURL(new RegExp(`/invoices/${OPEN_INVOICE}`));

    // The tax card surfaces the place-of-supply logic rather than a bare rate.
    await expect(page.getByText("Intra-state — CGST + SGST 18%")).toBeVisible();
    await expect(page.getByText("CGST", { exact: true })).toBeVisible();
    await expect(page.getByText("SGST", { exact: true })).toBeVisible();
    // Inter-state conditions don't apply, so IGST isn't shown at all.
    await expect(page.getByText("IGST", { exact: true })).toHaveCount(0);

    // Doc 05 P5: compliance identifiers are trust signals.
    await expect(page.getByText("IRN")).toBeVisible();

    // Doc 05 P4: the chain is on every document detail page.
    await expect(page.getByRole("region", { name: "Order to cash progress" })).toBeVisible();
  });

  test("credit notes get their own tab, signed as credits", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/invoices");
    await page.getByRole("link", { name: "Credit & debit notes" }).click();

    await expect(page).toHaveURL(/\/invoices\/notes/);
    await expect(page.getByText("Credit note").first()).toBeVisible();
    await expect(page.getByRole("link", { name: "0090002250" })).toBeVisible();
  });

  test("filters survive a copied link", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/invoices?filter=overdue");
    await expect(page.getByRole("button", { name: "Overdue" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(page.getByRole("link", { name: OVERDUE_INVOICE })).toBeVisible();
  });
});

test.describe("payments", () => {
  test("the statement shows a running balance and the credit note as a credit", async ({
    page,
  }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/payments");
    await expect(page.getByRole("heading", { name: "Payments" })).toBeVisible();
    await expect(page.getByText("Closing balance")).toBeVisible();
    await expect(page.getByRole("table", { name: "Account statement" })).toBeVisible();
  });

  test("a buyer pays an open invoice and it clears in SAP", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/payments/pay");
    await expect(page.getByRole("heading", { name: "Make a payment" })).toBeVisible();

    // --- Step 1: choose an invoice, and pay part of it -------------------
    const row = page.getByRole("row", { name: new RegExp(OVERDUE_INVOICE) });
    await row.getByRole("checkbox").check();

    const amount = row.getByRole("spinbutton");
    // Defaults to the full outstanding balance.
    await expect(amount).toHaveValue("143252.00");
    await amount.fill("43252");

    // --- Step 2: mode ----------------------------------------------------
    await page.getByRole("radio", { name: /UPI/ }).check();

    // The CTA is honest about what pressing it does.
    await page.getByRole("button", { name: "Continue to payment" }).click();

    // --- Step 3: the gateway hand-off ------------------------------------
    await page.waitForURL(/\/payments\/[^/]+\/receipt/);
    await expect(page.getByText("Waiting for your bank")).toBeVisible();

    // Completing sends a signed webhook through the real handler.
    await page.getByRole("button", { name: "Complete payment" }).click();

    await expect(page.getByRole("heading", { name: "Payment recorded" })).toBeVisible();
    await expect(page.getByText(/part-paid/i)).toBeVisible();

    // --- SAP agrees ------------------------------------------------------
    await page.goto("/payments");
    // A partial payment leaves a residual, so the invoice is still listed —
    // for the remaining 100000, not the original 143252.
    await page.goto("/payments/pay");
    const remaining = page.getByRole("row", { name: new RegExp(OVERDUE_INVOICE) });
    await expect(remaining.getByRole("spinbutton")).toHaveValue("100000.00");
  });

  test("a declined payment says plainly that nothing was charged", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/payments/pay");
    const row = page.getByRole("row", { name: new RegExp(OPEN_INVOICE) });
    await row.getByRole("checkbox").check();
    // .13 paise makes the mock gateway decline (see outcomeFor).
    await row.getByRole("spinbutton").fill("100.13");

    await page.getByRole("button", { name: "Continue to payment" }).click();
    await page.waitForURL(/\/payments\/[^/]+\/receipt/);
    await page.getByRole("button", { name: "Complete payment" }).click();

    await expect(page.getByRole("heading", { name: /didn't go through/i })).toBeVisible();
    await expect(page.getByText(/You have not been charged/)).toBeVisible();
    await expect(page.getByRole("link", { name: "Try again" })).toBeVisible();
  });

  test("the form refuses to overpay an invoice before it ever reaches the API", async ({
    page,
  }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/payments/pay");
    const row = page.getByRole("row", { name: new RegExp(OPEN_INVOICE) });
    await row.getByRole("checkbox").check();
    await row.getByRole("spinbutton").fill("99999999");

    await expect(page.getByText(/You can pay at most/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Continue to payment" })).toBeDisabled();
  });
});
