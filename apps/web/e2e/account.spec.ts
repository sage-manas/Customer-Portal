import { expect, test, type Page } from "@playwright/test";

/**
 * Module 9 happy path: a buyer reads their credit position and loyalty tier,
 * asks for a bigger limit, the credit desk decides it — plus the cases that
 * matter (a `buyer_user` cannot ask, the desk is unreachable from the customer
 * plane, and an approval does not move the customer's actual limit).
 *
 * The credit and loyalty figures come from the mock SAP landscape and are
 * derived on every read, so nothing here depends on a database state; the
 * request half raises its own row each time, which keeps the file re-runnable.
 */

const PASSWORD = "portal-dev-password";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Withdraws any request left pending, so each spec starts from a clean desk. */
async function clearPendingRequest(page: Page) {
  await page.goto("/account");
  const withdraw = page.getByRole("button", { name: "Withdraw" });
  if ((await withdraw.count()) > 0) {
    await withdraw.first().click();
    await expect(page.getByRole("link", { name: "Request an increase" }).first()).toBeVisible();
  }
}

test.describe("account", () => {
  test("a buyer sees their credit position with utilisation and DSO", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/account");
    await expect(page.getByRole("heading", { name: "Account" })).toBeVisible();

    // Docs/05 §7.9: the gauge, the three figures and the DSO metric. The
    // seeded account is at 1,842,500 of 5,000,000 — comfortably healthy.
    const gauge = page.getByRole("region", { name: "Credit position" });
    await expect(gauge.getByText("36.9%")).toBeVisible();
    await expect(gauge.getByText("Healthy")).toBeVisible();
    await expect(gauge.getByText("Approved limit")).toBeVisible();
    await expect(gauge.getByText(/DSO \(90-day\)/)).toBeVisible();

    // Nothing about the position is stored, so the page declares its freshness
    // rather than presenting it as fact (ADR-007).
    // By role, not by text: "Live" also appears in the "Deliveries" nav item.
    await expect(page.getByRole("status", { name: /real time/ })).toBeVisible();
  });

  test("the loyalty tab shows a fiscal-year tier and the live rebate", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/account");
    await page.getByRole("link", { name: "Loyalty & rebates" }).click();
    await page.waitForURL(/\/account\/loyalty$/);

    const tier = page.getByRole("region", { name: "Loyalty tier" });
    await expect(tier.getByText("Silver")).toBeVisible();
    await expect(tier.getByText(/FY 2026-27/)).toBeVisible();
    await expect(tier.getByText(/more this year to reach Gold/)).toBeVisible();

    // KONA-KAWRT as SAP holds it, and only the agreement that is still running
    // — the lapsed FY 2025-26 one is filtered out.
    await expect(page.getByText("0000801234")).toBeVisible();
    await expect(page.getByText("0000800987")).toHaveCount(0);
  });

  test("a buyer_user can read the account but cannot ask for a bigger limit", async ({ page }) => {
    // `multi@acme.example` is buyer_user: everyday transactions, but the
    // credit ask is a buyer_admin's to make.
    await signIn(page, "multi@acme.example");

    await page.goto("/account");
    await expect(page.getByRole("region", { name: "Credit position" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Request an increase" })).toHaveCount(0);

    // Hiding the CTA is presentation; the API is the control (docs/05 §4.3).
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/account/credit/requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requestedLimit: 99_000_000,
          justification: "A buyer_user must not be able to commit the account to this ask.",
        }),
      });
      return response.status;
    });
    expect(status).toBe(403);
  });

  test("the form refuses an ask that isn't an increase, using the domain's own rule", async ({
    page,
  }) => {
    await signIn(page, "buyer@acme.example");
    await clearPendingRequest(page);

    await page.goto("/account/credit/request");
    await page.getByLabel(/New limit you'd like/).fill("4000000");

    // Below the seeded 5,000,000 limit — the same function the service refuses
    // on says so here, while the customer is still typing.
    await expect(page.getByText(/Your limit is already/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Send request" })).toBeDisabled();

    // And an extra zero is caught by the multiple cap rather than by a credit
    // manager reading a request for ten times the exposure.
    await page.getByLabel(/New limit you'd like/).fill("75000000");
    await expect(page.getByText(/current limit/)).toBeVisible();
  });

  test("a buyer asks, the credit desk decides, and the SAP limit does not move", async ({
    page,
  }) => {
    await signIn(page, "buyer@acme.example");
    await clearPendingRequest(page);

    // --- the customer's ask ---
    await page.goto("/account/credit/request");
    await page.getByLabel(/New limit you'd like/).fill("7500000");
    await page
      .getByLabel("Why do you need it?")
      .fill("We're commissioning a second line in October and expect to double monthly volumes.");
    await page.getByRole("button", { name: "Send request" }).click();
    await page.waitForURL(/\/account$/);

    await expect(page.getByText("Pending Approval")).toBeVisible();
    // One open ask at a time: the CTA is gone while the desk has it.
    await expect(page.getByRole("link", { name: "Request an increase" })).toHaveCount(0);

    // --- the desk's side ---
    await signIn(page, "credit@acme.example");
    await page.goto("/admin/credit");
    await expect(page.getByRole("heading", { name: "Credit Desk" })).toBeVisible();
    // The screen says plainly what a decision here does and does not do.
    await expect(page.getByText(/does not change KNKK/)).toBeVisible();

    await expect(page.getByText("0010001001").first()).toBeVisible();
    await expect(page.getByText(/second line in October/).first()).toBeVisible();

    // Counter-offer rather than agreeing in full.
    await page
      .getByLabel(/Approve up to/)
      .first()
      .fill("6000000");
    await page
      .getByLabel(/Note to the customer/)
      .first()
      .fill("Approved to 60 lakh pending Q3 accounts.");
    await page.getByRole("button", { name: "Approve" }).first().click();

    // Decided work leaves the queue — the desk's default view is what is still
    // waiting, so the decision is confirmed on the "Decided" tab.
    await expect(page.getByText("Nothing waiting.")).toBeVisible();
    await page.getByRole("button", { name: /Decided/ }).click();
    await page.waitForURL(/filter=decided/);
    // `.first()`: the suite is re-runnable against a database that already has
    // decided requests, so the newest is what this spec asserts on.
    await expect(page.getByText(/Approved at/).first()).toBeVisible();

    // --- back to the customer ---
    await signIn(page, "buyer@acme.example");
    await page.goto("/account");

    // The customer's own list is newest first, so the row just decided is at
    // the top whatever earlier runs left behind.
    await expect(page.getByText("Approved").first()).toBeVisible();
    await expect(
      page.getByText(/takes effect once our credit team applies it/).first(),
    ).toBeVisible();
    await expect(page.getByText(/pending Q3 accounts/).first()).toBeVisible();

    // The point of ADR-035, on screen: the gauge above still reads the SAP
    // limit, which nobody has changed.
    const gauge = page.getByRole("region", { name: "Credit position" });
    await expect(gauge.getByText("36.9%")).toBeVisible();
  });

  test("a buyer cannot reach the credit desk's queue", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    // `account:view` buys this customer's own position. The desk's queue is
    // every account's, which is exactly what it must never buy.
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/admin/credit/requests");
      return response.status;
    });
    expect(status === 403 || status === 401).toBeTruthy();
  });
});
