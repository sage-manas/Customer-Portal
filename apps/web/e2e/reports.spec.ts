import { expect, test, type Page } from "@playwright/test";

/**
 * Module 10 happy path: a buyer opens the sales dashboard, changes the
 * period, reads a chart as a table, and drills into an aging bucket.
 *
 * Every figure comes from the mock SAP landscape and is composed on read, so
 * nothing here depends on database state and the file is re-runnable. The
 * one piece of state involved is the report cache, which is why the
 * freshness assertions accept either a live or a cached read — a second run
 * against a warm cache is a correct outcome, not a failure.
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

test.describe("reports", () => {
  test("a buyer reads the sales dashboard with its KPI row and three charts", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/reports");
    await expect(page.getByRole("heading", { name: "Reports" })).toBeVisible();

    // Doc 03 Module 10's KPI row.
    await expect(page.getByText(/Purchases FY 2026-27/)).toBeVisible();
    await expect(page.getByText("Open orders")).toBeVisible();
    await expect(page.getByText("Pending invoices")).toBeVisible();
    await expect(page.getByText("On-time delivery")).toBeVisible();

    // Doc 05 §7.10's three charts, each a labelled region.
    await expect(page.getByRole("region", { name: "Orders by month" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Top products" })).toBeVisible();
    await expect(page.getByRole("region", { name: "Average order value" })).toBeVisible();

    // The seed carries two late shipments and one with no planned date, so a
    // flat 100% here would mean the comparison never ran.
    await expect(page.getByText("On-time delivery").locator("..")).not.toContainText("100%");
    await expect(page.getByText(/no planned goods-issue date in SAP/)).toBeVisible();
  });

  test("the page declares where its numbers came from", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/reports");

    // ADR-036: a report is usually served from cache, and the screen says so
    // rather than presenting a cached aggregate as a live read. Either state
    // is correct; silence would not be.
    const freshness = page.getByRole("status").first();
    await expect(freshness).toBeVisible();
    await expect(freshness).toHaveText(/Live|Synced/);

    await expect(page.getByRole("button", { name: /Refresh from SAP/ })).toBeVisible();
  });

  test("the period is URL state, so a filtered view can be forwarded", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/reports");

    await page.getByRole("button", { name: "Last 3 months" }).click();
    await page.waitForURL(/period=last-3-months/);
    await expect(page.getByText(/Last 3 months\./)).toBeVisible();

    // Straight to the URL, as a forwarded link would arrive.
    await page.goto("/reports?period=fiscal-year");
    await expect(page.getByText(/FY 2026-27\./)).toBeVisible();
  });

  test("every chart can be read as a table (docs/05 §9)", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/reports");

    const chart = page.getByRole("region", { name: "Orders by month" });
    await chart.getByRole("button", { name: "Table" }).click();

    const table = chart.getByRole("table");
    await expect(table).toBeVisible();
    // Twelve months by default, including the ones with nothing in them.
    await expect(table.locator("tbody tr")).toHaveCount(12);

    await chart.getByRole("button", { name: "Chart" }).click();
    await expect(chart.getByRole("table")).toHaveCount(0);
  });

  test("the AR summary drills from a bucket into its documents", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    await page.goto("/reports");
    await page.getByRole("link", { name: "AR summary" }).click();
    await page.waitForURL(/\/reports\/ar$/);

    await expect(page.getByText("Total outstanding")).toBeVisible();
    await expect(page.getByText("Of which overdue")).toBeVisible();

    // The aging bar is the same component and the same `buildAging` the
    // invoice list uses (ADR-018), so the buckets agree by construction.
    const aging = page.getByRole("region", { name: "Outstanding balance by age" });
    await expect(aging).toBeVisible();

    await aging.getByText("0–30 days").first().click();
    const drilldown = page.getByRole("table").first();
    await expect(drilldown).toBeVisible();
    // The drill-down deep-links to the invoice it came from.
    await expect(drilldown.getByRole("link").first()).toHaveAttribute("href", /\/invoices\//);
  });

  test("the report names the account it is about", async ({ page }) => {
    // Every read behind this page is KUNNR-scoped, and there is deliberately
    // no tenant-wide variant (ADR-032). The account is also part of the cache
    // key, so two customers on one tenant cannot share an entry (ADR-036) —
    // the screen naming the account is what makes that visible to a reader.
    await signIn(page, "buyer@acme.example");
    await page.goto("/reports");
    await expect(page.getByText(/account 0010001001/)).toBeVisible();
  });
});
