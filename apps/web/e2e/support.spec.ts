import { expect, test, type Page } from "@playwright/test";

/**
 * Module 8 happy path: a buyer raises a ticket, the back office picks it up
 * and resolves it, the buyer rates it — plus the authorisation cases that
 * matter (a view-only buyer cannot raise or reply, another account's ticket
 * is a 404, and the customer plane cannot reach the workbench).
 *
 * Tickets are portal-owned, so unlike the delivery suite nothing here depends
 * on the mock SAP landscape's state. Every spec raises its own ticket, which
 * makes the file safely re-runnable against a database that already has rows.
 */

const PASSWORD = "portal-dev-password";

async function signIn(page: Page, email: string) {
  // Cleared first: a signed-in session is redirected away from /login, so the
  // second half of the end-to-end spec (agent, then customer again) would
  // otherwise wait forever for a form it is never shown.
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

/** Raises a ticket through the form and returns the URL it landed on. */
async function raiseTicket(page: Page, subject: string) {
  await page.goto("/support/new");
  await page.getByRole("button", { name: "Billing" }).click();
  await page.getByLabel("Subject").fill(subject);
  await page
    .getByLabel("What happened?")
    .fill("The tax on this invoice looks wrong and we need it checked before we pay.");
  await page.getByRole("button", { name: "Raise ticket" }).click();
  // Not `/support/[^/]+$` — that also matches the form's own `/support/new`,
  // so it would resolve instantly and hand back "new" as the ticket id.
  await page.waitForURL(
    (url) => /^\/support\/.+/.test(url.pathname) && !url.pathname.endsWith("/new"),
  );
  return page.url();
}

test.describe("support", () => {
  test("a buyer raises a ticket and sees it tracked with an SLA", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();

    const subject = `GST wrong on 90000123 ${Date.now() % 100000}`;
    await raiseTicket(page, subject);

    await expect(page.getByRole("heading", { name: subject })).toBeVisible();

    // Docs/05 §7.8: the status timeline and the SLA countdown chip.
    const timeline = page.getByRole("list", { name: "Ticket progress" });
    await expect(timeline.getByText("Open")).toBeVisible();
    await expect(timeline.getByText("Resolved")).toBeVisible();
    // `high` is not the default — medium is — so an 8-hour promise would be
    // wrong here; what matters is that a deadline is shown at all.
    await expect(page.getByText(/Due/)).toBeVisible();

    // And it is on the list, which counts it as open.
    await page.goto("/support?filter=open");
    await expect(page.getByRole("link", { name: subject })).toBeVisible();
  });

  test("the subject is held to QMTXT's 40 characters while typing", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/support/new");

    const subject = page.getByLabel("Subject");
    await subject.fill("x".repeat(60));

    // The maxlength is the courtesy; the schema is the control. Both agree.
    await expect(subject).toHaveValue("x".repeat(40));
    await expect(page.getByText("40/40")).toBeVisible();
  });

  test("the SLA hint on screen comes from the registry, so it matches the clock", async ({
    page,
  }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/support/new");

    await page.getByLabel("Priority").selectOption("critical");
    await expect(page.getByText("Response within 4 hours.")).toBeVisible();

    await page.getByLabel("Priority").selectOption("low");
    await expect(page.getByText("Response within 3 days.")).toBeVisible();
  });

  test("a view-only buyer can read tickets but cannot raise one", async ({ page }) => {
    await signIn(page, "viewer@acme.example");

    await page.goto("/support");
    await expect(page.getByRole("heading", { name: "Support" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Raise a ticket" })).toHaveCount(0);

    // Hiding the CTA is presentation; the API is the control (docs/05 §4.3).
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/support", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          category: "general",
          priority: "low",
          subject: "Should not be allowed",
          description: "A view-only buyer must not be able to commit the account to a query.",
        }),
      });
      return response.status;
    });
    expect(status).toBe(403);
  });

  test("a ticket that isn't yours is not found, not forbidden", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    const status = await page.evaluate(async () => {
      const response = await fetch("/api/support/ticket-that-does-not-exist");
      return response.status;
    });
    // 404 either way — the portal must not distinguish "someone else's" from
    // "nobody's" (CLAUDE.md rule 5).
    expect(status).toBe(404);
  });

  test("a buyer cannot resolve their own ticket, however they ask", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    const url = await raiseTicket(page, `Self-resolve probe ${Date.now() % 100000}`);
    const id = url.split("/").pop()!;

    // Self-resolution would let the SLA be met by the person it protects.
    const status = await page.evaluate(async (ticketId) => {
      const response = await fetch(`/api/support/${ticketId}/status`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ to: "resolved" }),
      });
      return response.status;
    }, id);
    expect(status).toBe(409);
  });

  test("a buyer cannot reach the back-office workbench", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    // `support:view` buys the customer's own tickets. The workbench returns
    // every account's, which is exactly what it must never buy.
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/admin/tickets");
      return response.status;
    });
    expect(status === 403 || status === 401).toBeTruthy();
  });

  test("the back office picks a ticket up, notes internally, resolves — and the buyer rates it", async ({
    page,
  }) => {
    const subject = `End to end ${Date.now() % 100000}`;

    await signIn(page, "buyer@acme.example");
    const ticketUrl = await raiseTicket(page, subject);

    // --- the agent's side ---
    await signIn(page, "admin@acme.example");
    await page.goto("/admin/tickets");
    await expect(page.getByRole("heading", { name: "Ticket Workbench" })).toBeVisible();

    await page.getByRole("link", { name: subject }).click();
    await page.waitForURL((url) => /^\/admin\/tickets\/.+/.test(url.pathname));

    await page.getByRole("button", { name: "Assign to me" }).click();
    await expect(page.getByRole("button", { name: "Return to queue" })).toBeVisible();

    // An internal note, which the customer must never see.
    await page.getByLabel("Reply").fill("Checking KONV before we answer — do not promise a date.");
    await page.getByLabel(/Internal note/).check();
    await page.getByRole("button", { name: "Post internal note" }).click();
    await expect(page.getByText(/Internal — not visible to the customer/)).toBeVisible();

    await page.getByRole("button", { name: "Resolve", exact: true }).click();
    await page
      .getByLabel(/What was done\?/)
      .fill("IGST was applied in error; credit note 91000045 has been issued.");
    await page.getByRole("button", { name: "Resolve ticket" }).click();
    await expect(page.getByText("91000045")).toBeVisible();

    // --- back to the customer ---
    await signIn(page, "buyer@acme.example");
    await page.goto(ticketUrl);

    await expect(page.getByRole("heading", { name: "How we resolved it" })).toBeVisible();
    await expect(page.getByText("91000045")).toBeVisible();
    // The internal note is excluded in the query, so it is not on this page
    // at all — not hidden by CSS, absent.
    await expect(page.getByText("do not promise a date")).toHaveCount(0);

    // CSAT (docs/05 §7.8), available now that there is a resolution to judge.
    await page.getByRole("radio", { name: "4 out of 5" }).click();
    await page.getByRole("button", { name: "Submit rating" }).click();
    await expect(page.getByText("4 of 5")).toBeVisible();

    // Rated once, and only once.
    await expect(page.getByRole("button", { name: "Submit rating" })).toHaveCount(0);
  });
});
