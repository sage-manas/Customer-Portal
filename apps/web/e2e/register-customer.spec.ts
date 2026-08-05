import { expect, test, type Page } from "@playwright/test";

/**
 * Doc 09 §5, third acceptance criterion, end to end on mocks:
 * "client admin can register a customer from `/admin/customers/new` → the
 * customer receives credentials → can log in and order".
 *
 * The wizard here is the same component `/register` renders (ADR-056), so
 * what this spec proves that `onboarding.spec.ts` does not is the *second
 * entry point*: session-authenticated, no draft token, no review queue, and
 * an assignment decision made on the last step by the person filling it in.
 */

const PASSWORD = "portal-dev-password";

const BASE36 = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/** The published GSTN check-digit algorithm — same one @cc/domain validates with. */
function gstinCheckDigit(first14: string): string {
  let sum = 0;
  for (let index = 0; index < 14; index++) {
    const product = BASE36.indexOf(first14[index]!) * (index % 2 === 0 ? 1 : 2);
    sum += Math.floor(product / 36) + (product % 36);
  }
  return BASE36[(36 - (sum % 36)) % 36]!;
}

/** A fresh customer per run: the GSTIN duplicate guard is not skipped for the
 * back office, which is the point of ADR-056 and would make a reused one pass
 * exactly once per database. */
function uniqueCustomer() {
  const digits = String(Date.now()).slice(-4);
  const pan = `AAQCS${digits}K`;
  const body = `27${pan}1Z`;

  return {
    legalEntityName: `Sahyadri Castings ${digits} Pvt Ltd`,
    email: `accounts${digits}@sahyadricastings.example`,
    pan,
    gstin: `${body}${gstinCheckDigit(body)}`,
  };
}

async function fillByLabel(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}

async function signIn(page: Page, email: string, password: string) {
  await page.context().clearCookies();
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL((url) => !url.pathname.startsWith("/login"));
}

test.describe("back-office customer registration", () => {
  test("a client admin registers a customer who then signs in and orders", async ({ page }) => {
    const customer = uniqueCustomer();

    // --- The desk fills the wizard on the customer's behalf ---------------
    await signIn(page, "admin@acme.example", PASSWORD);

    await page.goto("/admin/customers");
    await page.getByRole("link", { name: "Register customer" }).click();
    await page.waitForURL(/\/admin\/customers\/new$/);

    // Step 1 — the same fields as the applicant's own form, from the same
    // registry. Nothing here is a second field list (doc 10 Phase 5).
    await expect(page.getByRole("heading", { name: "Company Information" })).toBeVisible();
    await fillByLabel(page, "Legal Entity Name", customer.legalEntityName);
    await page.getByLabel("Customer Type", { exact: true }).selectOption("Z002");
    await fillByLabel(page, "Street/Area", "Gat 221, Sanaswadi");
    await fillByLabel(page, "City", "Pune");
    await page.getByLabel("State", { exact: true }).selectOption("27");
    await fillByLabel(page, "PIN Code", "412208");
    await page.getByLabel("Country", { exact: true }).selectOption("IN");
    await fillByLabel(page, "Contact Person", "Meera Deshpande");
    await fillByLabel(page, "Email", customer.email);
    await fillByLabel(page, "Phone", "9822098220");
    await page.getByRole("button", { name: "Save & continue" }).click();

    // Step 2 — validation is not skipped for the back office: the GSTIN is
    // verified against GSTN exactly as an applicant's is.
    await expect(page.getByRole("heading", { name: "Tax & Regulatory" })).toBeVisible();
    await fillByLabel(page, "PAN", customer.pan);
    await fillByLabel(page, "GSTIN", customer.gstin);
    await page.getByLabel("GST Registration Type", { exact: true }).selectOption("01");
    await page.getByRole("button", { name: "Verify GSTIN" }).click();
    await expect(page.getByText(/GSTN has this registration as/)).toBeVisible();
    await page.getByRole("button", { name: "Save & continue" }).click();

    // Step 3
    await expect(page.getByRole("heading", { name: "Credit & Commercial" })).toBeVisible();
    await fillByLabel(page, "Requested Credit Limit ₹", "750000");
    await page.getByRole("button", { name: "Save & continue" }).click();

    // Step 4 — documents, plus the assignment a reviewer would normally
    // supply at approval. That panel *is* the collapsed review gate.
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();
    for (const label of ["PAN Card Copy", "GST Certificate"]) {
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name: `${label}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 mock document"),
      });
      await expect(page.getByText(`${label}.pdf`)).toBeVisible();
    }

    await expect(page.getByText("There is no review queue")).toBeVisible();
    await fillByLabel(page, "Sales Org", "1000");
    await fillByLabel(page, "Distribution Channel", "10");

    await page.getByRole("button", { name: "Create customer in SAP" }).click();

    // --- SAP accepted, and credentials came back once ---------------------
    await expect(page.getByRole("heading", { name: "Customer created" })).toBeVisible();
    await expect(page.getByText(/SAP assigned customer number\s*\d{10}/)).toBeVisible();

    const credentials = page.getByRole("definition");
    const email = (await credentials.nth(0).textContent())?.trim() ?? "";
    const temporaryPassword = (await credentials.nth(1).textContent())?.trim() ?? "";
    expect(email).toBe(customer.email);
    expect(temporaryPassword.length).toBeGreaterThan(8);

    // The directory shows the account, and shows that the back office is
    // where it came from (ADR-057's provenance).
    await page.getByRole("button", { name: "Back to customers" }).click();
    await page.waitForURL(/\/admin\/customers$/);
    await expect(page.getByText(customer.legalEntityName)).toBeVisible();

    // --- The customer signs in with what they were sent -------------------
    await signIn(page, customer.email, temporaryPassword);
    await page.goto("/");

    // One role, the whole portal (ADR-061) — no buyer variant to choose.
    await expect(page.getByRole("navigation", { name: "Main" })).toContainText("Catalogue");

    // --- ...and places an order -------------------------------------------
    await page.goto("/catalogue");
    const pumpCard = page.locator("article", { hasText: "Hydraulic Pump HP-200" });
    await pumpCard.getByRole("button", { name: "Add to Cart" }).click();

    const drawer = page.getByRole("dialog", { name: "Cart" });
    await expect(drawer).toBeVisible();
    await drawer.getByRole("button", { name: "Create Order" }).click();
    await expect(page).toHaveURL(/\/orders\/new\?from=cart/);

    await page.getByLabel("Your PO reference").fill(`REG-${Date.now().toString().slice(-8)}`);
    await page.getByLabel("Requested delivery date").fill("2026-09-15");
    await page.getByRole("button", { name: "Submit order" }).click();

    const dialog = page.getByRole("alertdialog", { name: "Submit this order?" });
    await dialog.getByRole("button", { name: "Submit order" }).click();

    await page.waitForURL(/\/orders\/\d{10}$/);
    await expect(page.getByRole("heading", { name: /^Order \d{10}$/ })).toBeVisible();

    // SAP created it and held it: a customer master created through XD01 has
    // no credit limit until somebody maintains one in FD32 (ADR-035), so the
    // first order of a brand-new account is credit-blocked. That is SAP
    // behaving correctly, not the portal failing — the order exists either
    // way, which is what this criterion is about.
    await expect(page.getByRole("heading", { name: "Order on credit hold" })).toBeVisible();
  });
});
