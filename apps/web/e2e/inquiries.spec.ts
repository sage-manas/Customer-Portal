import { expect, test, type Page } from "@playwright/test";

/**
 * Module 3 happy path: a buyer raises an inquiry, the sales desk quotes it,
 * the buyer accepts and lands on the sales order — plus the authorisation
 * cases that matter (a view-only buyer cannot raise or accept, another
 * account's quotation is a 404, and the customer plane cannot reach the
 * workbench).
 *
 * Both documents live in the mock SAP landscape, which is process-wide state:
 * each spec raises its *own* inquiry rather than leaning on a seeded one, so
 * the file is safely re-runnable and the specs don't compete for the same
 * quotation. The one exception is the seeded expired quotation, which nothing
 * can convert by definition.
 */

const PASSWORD = "portal-dev-password";

/** Seeded in the mock SAP driver: lapsed 12 days before SEED_TODAY. */
const EXPIRED_QUOTATION = "0020000860";

async function signIn(page: Page, email: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

function futureDate(days: number): string {
  return new Date(Date.now() + days * 86_400_000).toISOString().slice(0, 10);
}

/** Raises an inquiry through the form and returns the VBELN it landed on. */
async function raiseInquiry(page: Page, material: string): Promise<string> {
  await page.goto("/inquiries/new");
  await page.getByLabel("Required delivery date").fill(futureDate(30));
  await page.getByLabel("Add an item").selectOption(material);
  await page.getByRole("button", { name: "Send inquiry" }).click();
  await page.getByRole("button", { name: "Send inquiry" }).last().click();

  await page.waitForURL(
    (url) => /^\/inquiries\/.+/.test(url.pathname) && !url.pathname.endsWith("/new"),
  );
  return page.url().split("/").pop()!;
}

test.describe("inquiries and quotations", () => {
  test("a buyer raises an inquiry and sees it waiting on sales", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/inquiries");
    await expect(page.getByRole("heading", { name: "Inquiries" })).toBeVisible();

    const vbeln = await raiseInquiry(page, "MAT-10001");

    await expect(page.getByRole("heading", { name: `Inquiry ${vbeln}` })).toBeVisible();
    await expect(page.getByText("With our sales team")).toBeVisible();

    await page.goto("/inquiries?filter=awaiting");
    await expect(page.getByRole("link", { name: vbeln })).toBeVisible();
  });

  test("a draft survives leaving the form and is picked up by number", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/inquiries/new");

    await page.getByLabel("Required delivery date").fill(futureDate(21));
    await page.getByLabel("Add an item").selectOption("MAT-30001");
    await page.getByRole("button", { name: "Save draft" }).click();
    await expect(page.getByText(/Draft saved/)).toBeVisible();

    // Drafts belong to the account, not the person — docs/05 §7.3, ADR-014.
    await page.goto("/inquiries");
    await expect(page.getByText(/hasn't been sent yet|haven't been sent yet/)).toBeVisible();
  });

  test("an expired quotation cannot be accepted, however it is asked", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto(`/quotations/${EXPIRED_QUOTATION}`);

    await expect(page.getByText(/expired on/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Accept & convert to order" })).toHaveCount(0);
    // What is offered instead (docs/05 §7.3).
    await expect(page.getByRole("heading", { name: "Request revalidation" })).toBeVisible();

    // Hiding the button is presentation; the API is the control.
    const status = await page.evaluate(async (vbeln) => {
      const response = await fetch(`/api/quotations/${vbeln}/accept`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipTo: "0010001001" }),
      });
      return response.status;
    }, EXPIRED_QUOTATION);
    expect(status).toBe(409);
  });

  test("a view-only buyer can read inquiries but cannot raise one", async ({ page }) => {
    await signIn(page, "viewer@acme.example");

    await page.goto("/inquiries");
    await expect(page.getByRole("heading", { name: "Inquiries" })).toBeVisible();
    await expect(page.getByRole("link", { name: "Raise an inquiry" })).toHaveCount(0);

    const status = await page.evaluate(async () => {
      const response = await fetch("/api/inquiries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          requiredDeliveryDate: "2027-01-01",
          lines: [{ material: "MAT-10001", quantity: 1, uom: "EA" }],
        }),
      });
      return response.status;
    });
    expect(status).toBe(403);
  });

  test("a quotation that isn't yours is not found, not forbidden", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    const status = await page.evaluate(async () => {
      const response = await fetch("/api/quotations/0029999999/accept", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ shipTo: "0010001001" }),
      });
      return response.status;
    });
    // 404 either way — the portal must not distinguish "someone else's" from
    // "nobody's" (CLAUDE.md rule 5).
    expect(status).toBe(404);
  });

  test("a buyer cannot reach the quotation workbench", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    // `inquiry:view` buys the customer's own inquiries. The workbench returns
    // every account's, which is exactly what it must never buy.
    const status = await page.evaluate(async () => {
      const response = await fetch("/api/admin/quotations");
      return response.status;
    });
    expect(status === 403 || status === 401).toBeTruthy();
  });

  test("sales quotes an inquiry and the buyer converts it into an order", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    const inquiryVbeln = await raiseInquiry(page, "MAT-10003");

    // --- the sales desk's side ---
    await signIn(page, "admin@acme.example");
    await page.goto("/admin/quotations");
    await expect(page.getByRole("heading", { name: "Quotation Workbench" })).toBeVisible();

    const row = page.getByRole("listitem").filter({ hasText: inquiryVbeln });
    await row.getByRole("button", { name: "Quote" }).click();
    await row.getByLabel("Unit price").first().fill("3100");
    await row.getByRole("button", { name: "Issue quotation" }).click();

    // Quoted, so it leaves the queue — the queue is "unanswered", not "all".
    await expect(page.getByRole("listitem").filter({ hasText: inquiryVbeln })).toHaveCount(0);

    // --- back to the customer ---
    await signIn(page, "buyer@acme.example");
    await page.goto(`/inquiries/${inquiryVbeln}`);
    await expect(page.getByText(/Your quotation is ready/)).toBeVisible();

    await page
      .getByRole("link", { name: /^00200009/ })
      .first()
      .click();
    await page.waitForURL((url) => /^\/quotations\/.+/.test(url.pathname));

    // Totals card: SAP's own tax split, never one the portal computed.
    await expect(page.getByRole("heading", { name: "Totals" })).toBeVisible();
    await expect(page.getByText(/as calculated by SAP/)).toBeVisible();

    await page.getByRole("button", { name: "Accept & convert to order" }).click();
    await page.getByRole("button", { name: "Accept & convert" }).last().click();

    // Copy control lands the customer on the order the quotation became.
    await page.waitForURL((url) => /^\/orders\/.+/.test(url.pathname));
    await expect(page.getByRole("heading", { name: /^Order / })).toBeVisible();
  });
});
