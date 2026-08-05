import { expect, test, type Page } from "@playwright/test";

import { signIn } from "./helpers";

/**
 * Doc 09 §5, the first two acceptance criteria, asserted per role:
 * "each role's nav shows only permitted tabs" and "the API returns 403/404
 * for everything else regardless of the UI".
 *
 * The expected tab lists below are written out rather than computed from
 * `visibleNavItems`. That is deliberate: an expectation generated from the
 * registry the app renders from would agree with a registry that is wrong.
 * The registry-against-itself checks already exist as unit tests
 * (`navigation.test.ts`, `api-routes.test.ts`); what is worth asserting from
 * a browser is the answer a human would read off the screen.
 *
 * The four tenant-plane roles live here. `super_admin` and `sap_manager`
 * never appear in a web-app JWT (doc 09 §1) — their console is a separate
 * app with a separate session, and their equivalent assertions are the
 * `apps/ops` authz sweep and ADR-052's two.
 */

/**
 * The sidebar's items in order, planned ones included — a "Soon" module is a
 * tab the role can see, and the criterion is about what is shown.
 */
async function navLabels(page: Page): Promise<string[]> {
  const items = page.getByRole("navigation", { name: "Main" }).getByRole("listitem");
  await expect(items.first()).toBeVisible();
  return (await items.allTextContents()).map((text) => text.replace(/Soon$/, "").trim());
}

async function apiStatus(page: Page, path: string): Promise<number> {
  return page.evaluate(async (target) => {
    const response = await fetch(target);
    return response.status;
  }, path);
}

const PORTAL_TABS = [
  "Dashboard",
  "Catalogue",
  "Inquiries",
  "Quotations",
  "Orders",
  "Deliveries",
  "Invoices",
  "Payments",
  "Support",
  "Account",
  "Reports",
];

const CLIENT_ADMIN_TABS = [
  "Overview",
  "Onboarding Queue",
  "Quotation Workbench",
  "Credit Desk",
  "Ticket Workbench",
  "Customers",
  "Accounts Payable",
  "Accounts Receivable",
  "Tenant Settings",
];

test.describe("role model (doc 09 §5)", () => {
  test("customer sees the whole portal and none of the back office", async ({ page }) => {
    await signIn(page, "buyer@acme.example");
    await page.goto("/");

    expect(await navLabels(page)).toEqual(PORTAL_TABS);

    // The admin shell is a 403 for a customer — they exist in this tenant and
    // simply may not (doc 09 §1: 404 is reserved for cross-tenant).
    const page403 = await page.goto("/admin");
    expect(page403?.status()).toBe(403);
    await expect(page.getByText(/don't have access/i)).toBeVisible();

    // And hiding the tab is not what stopped them: the API says so too.
    expect(await apiStatus(page, "/api/admin/customers")).toBe(403);
  });

  test("client_admin sees every back-office tab", async ({ page }) => {
    await signIn(page, "admin@acme.example");
    await page.goto("/admin");

    expect(await navLabels(page)).toEqual(CLIENT_ADMIN_TABS);

    // Cross-*customer* is the denial that matters for a role that may see
    // every customer of its own tenant: 0010001003 is Globex's, and the
    // answer must not distinguish it from one that does not exist.
    expect(await apiStatus(page, "/api/admin/customers/0010001003")).toBe(404);
  });

  // Same shape for both desks: overview plus one tab, none of the other
  // desk's screens, and no `customer:register`. `deniedPaths` covers the
  // permissions each desk conspicuously lacks — always the customer master,
  // plus (for AR) `credit:decide-limit` vs its own `credit:release`.
  const desks: Array<{ email: string; tab: string; deniedPaths: string[] }> = [
    { email: "ap@acme.example", tab: "Accounts Payable", deniedPaths: ["/api/admin/customers"] },
    {
      email: "ar@acme.example",
      tab: "Accounts Receivable",
      deniedPaths: ["/api/admin/credit/requests", "/api/admin/customers"],
    },
  ];

  for (const { email, tab, deniedPaths } of desks) {
    test(`${tab} desk sees the overview and its own desk, nothing else`, async ({ page }) => {
      await signIn(page, email);
      await page.goto("/admin");

      expect(await navLabels(page)).toEqual(["Overview", tab]);

      // Holds `admin:view`, so the shell is theirs; holds neither
      // `customer:register` nor the other desk's permission, so those are not.
      for (const path of deniedPaths) {
        expect(await apiStatus(page, path)).toBe(403);
      }

      // The buyer plane is not theirs either: they hold `order:view`/
      // `invoice:view` as desk reads and have no KUNNR, so the portal shell
      // sends them back to their own (ADR-062) rather than rendering a nav
      // over an account they lack.
      await page.goto("/");
      await expect(page).toHaveURL(/\/admin$/);
    });
  }
});
