import { expect, test, type Page } from "@playwright/test";

/**
 * Module 1 happy path: a company registers through the 4-step wizard, and a
 * tenant admin approves it, which creates the customer in (mock) SAP.
 *
 * Everything external is a mock driver, so this runs anywhere the app and a
 * seeded database run — no SAP, no GSTN, no object store.
 */

/** The mock GSTN registry's Maharashtra fixture — used where an echo of the
 * registered legal name is what's being asserted. */
const SEEDED_GSTIN = "27AAPFU0939F1ZV";
const SEEDED_PAN = "AAPFU0939F";

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

/**
 * A fresh applicant per run.
 *
 * The GSTIN has to be new every time, not just the company name: the service
 * refuses a second application for a GSTIN it already holds, and a suite that
 * reused one would pass exactly once per database. The mock GSTN driver
 * synthesizes an Active taxpayer for any valid number, which is what makes
 * this possible without touching the DB from the app layer.
 */
function uniqueApplicant() {
  const digits = String(Date.now()).slice(-4);
  const pan = `AAPFU${digits}F`;
  const body = `27${pan}1Z`;

  return {
    legalEntityName: `Vertex Polymers ${digits} Pvt Ltd`,
    email: `rhea${digits}@vertexpolymers.example`,
    pan,
    gstin: `${body}${gstinCheckDigit(body)}`,
  };
}

async function fillByLabel(page: Page, label: string, value: string) {
  await page.getByLabel(label, { exact: true }).fill(value);
}

test.describe("customer onboarding", () => {
  test("a company registers and a tenant admin approves it", async ({ page, context }) => {
    const applicant = uniqueApplicant();

    // --- Step 1: company information ------------------------------------
    await page.goto("/register");
    await expect(page.getByRole("heading", { name: "Company Information" })).toBeVisible();

    await fillByLabel(page, "Legal Entity Name", applicant.legalEntityName);
    await page.getByLabel("Customer Type", { exact: true }).selectOption("Z002");
    await fillByLabel(page, "Street/Area", "Plot 14, MIDC Industrial Area");
    await fillByLabel(page, "City", "Pune");
    await page.getByLabel("State", { exact: true }).selectOption("27");
    await fillByLabel(page, "PIN Code", "411018");
    await page.getByLabel("Country", { exact: true }).selectOption("IN");
    await fillByLabel(page, "Contact Person", "Rhea Kulkarni");
    await fillByLabel(page, "Email", applicant.email);
    await fillByLabel(page, "Phone", "9820098200");

    await page.getByRole("button", { name: "Save & continue" }).click();

    // --- Step 2: tax & regulatory, with a live GSTN verify ---------------
    await expect(page.getByRole("heading", { name: "Tax & Regulatory" })).toBeVisible();
    await fillByLabel(page, "PAN", applicant.pan);
    await fillByLabel(page, "GSTIN", applicant.gstin);
    await page.getByLabel("GST Registration Type", { exact: true }).selectOption("01");

    await page.getByRole("button", { name: "Verify GSTIN" }).click();
    // GSTN answered, and the wizard echoes the registered legal name back for
    // the applicant to check (docs/05 §7.1).
    await expect(page.getByText(/GSTN has this registration as/)).toBeVisible();

    await page.getByRole("button", { name: "Save & continue" }).click();

    // --- Step 3: credit & commercial -------------------------------------
    await expect(page.getByRole("heading", { name: "Credit & Commercial" })).toBeVisible();
    await fillByLabel(page, "Requested Credit Limit ₹", "500000");
    await page.getByRole("button", { name: "Save & continue" }).click();

    // --- Step 4: documents ------------------------------------------------
    await expect(page.getByRole("heading", { name: "Documents" })).toBeVisible();

    for (const label of ["PAN Card Copy", "GST Certificate"]) {
      await page.getByLabel(label, { exact: true }).setInputFiles({
        name: `${label}.pdf`,
        mimeType: "application/pdf",
        buffer: Buffer.from("%PDF-1.4 mock document"),
      });
      await expect(page.getByText(`${label}.pdf`)).toBeVisible();
    }

    await page.getByRole("button", { name: "Submit application" }).click();

    // --- Status page ------------------------------------------------------
    await expect(page).toHaveURL(/\/register\/status$/);
    await expect(page.getByText("Under review")).toBeVisible();
    await expect(page.getByText("Pending Approval")).toBeVisible();

    // --- Back office: approve --------------------------------------------
    const admin = await context.newPage();
    await admin.goto("/login");
    await admin.getByLabel("Email").fill("admin@acme.example");
    await admin.getByLabel("Password").fill("portal-dev-password");
    await admin.getByRole("button", { name: "Sign in" }).click();
    // Wait for the session to actually land: navigating before the login POST
    // completes means no cookie, and middleware bounces straight back here.
    await admin.waitForURL((url) => !url.pathname.startsWith("/login"));

    await admin.goto("/admin/onboarding");
    await admin.getByRole("link", { name: applicant.legalEntityName }).click();

    await expect(admin.getByText("GSTIN verified with GSTN")).toBeVisible();

    await admin.getByLabel("Sales Org (KNVV-VKORG)").fill("1000");
    await admin.getByLabel("Distribution Channel (KNVV-VTWEG)").fill("10");
    await admin.getByRole("button", { name: "Approve & create in SAP" }).click();

    // The confirmation names the SAP consequence (docs/05 §6.2).
    await expect(admin.getByText("This creates the customer in SAP immediately")).toBeVisible();
    await admin.getByRole("button", { name: "Yes, create in SAP" }).click();

    await expect(admin.getByText("Customer created in SAP")).toBeVisible();
    // The KUNNR SAP assigned, echoed back to the reviewer (docs/05 §7.1).
    await expect(admin.getByText(/SAP assigned customer code\s+\d{10}/)).toBeVisible();

    // --- And the applicant sees the decision ------------------------------
    await page.reload();
    await expect(page.getByText("Your account is ready")).toBeVisible();
  });

  test("a wrong GSTIN state blocks the applicant with an explanation", async ({ page }) => {
    await page.goto("/register");

    await fillByLabel(page, "Legal Entity Name", "Bluepeak Components Pvt Ltd");
    await page.getByLabel("Customer Type", { exact: true }).selectOption("Z002");
    await fillByLabel(page, "Street/Area", "42 Peenya Industrial Area");
    await fillByLabel(page, "City", "Bengaluru");
    // Karnataka billing address...
    await page.getByLabel("State", { exact: true }).selectOption("29");
    await fillByLabel(page, "PIN Code", "560058");
    await page.getByLabel("Country", { exact: true }).selectOption("IN");
    await fillByLabel(page, "Contact Person", "Anil Rao");
    await fillByLabel(page, "Email", "anil@bluepeak.example");
    await fillByLabel(page, "Phone", "9812098120");
    await page.getByRole("button", { name: "Save & continue" }).click();

    // ...but a Maharashtra GSTIN.
    await fillByLabel(page, "PAN", SEEDED_PAN);
    await fillByLabel(page, "GSTIN", SEEDED_GSTIN);
    await page.getByLabel("GST Registration Type", { exact: true }).selectOption("01");
    await page.getByRole("button", { name: "Save & continue" }).click();

    await expect(page.getByText(/doesn't match your billing state/)).toBeVisible();
    await expect(page.getByRole("heading", { name: "Tax & Regulatory" })).toBeVisible();
  });
});
