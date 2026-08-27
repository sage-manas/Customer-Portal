/**
 * Responsive sanity sweep: desktop / tablet / mobile viewports across the
 * highest-traffic screens, checking for horizontal overflow (the one
 * mechanical signal of "this broke on a small screen") and console errors.
 */
import { fileURLToPath } from "node:url";
import { launch, ok, section, RESULTS, BASE_URL, trackErrors } from "./helpers.mjs";

const VIEWPORTS = {
  desktop: { width: 1440, height: 900 },
  tablet: { width: 768, height: 1024 },
  mobile: { width: 375, height: 812 },
};

const PAGES = [
  { path: "/login", auth: null },
  { path: "/", auth: "customer" },
  { path: "/orders", auth: "customer" },
  { path: "/orders/new", auth: "customer" },
  { path: "/catalogue", auth: "customer" },
  { path: "/support/new", auth: "customer" },
  { path: "/admin", auth: "client_admin" },
  { path: "/admin/customers", auth: "client_admin" },
];

async function checkOverflow(page, viewportWidth) {
  return page.evaluate((vw) => {
    const scrollWidth = document.documentElement.scrollWidth;
    // A few px of tolerance for scrollbars/subpixel rounding.
    return scrollWidth <= vw + 4;
  }, viewportWidth);
}

async function signInAt(page, roleKey) {
  const { ACCOUNTS } = await import("./helpers.mjs");
  const label = ACCOUNTS[roleKey].label;
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  const picker = page.getByRole("button", { name: new RegExp(`^${label}\\b`) });
  await picker.waitFor({ state: "visible" });
  for (let attempt = 0; attempt < 5; attempt++) {
    await picker.click();
    await page.waitForTimeout(300);
    const cookie = await page.evaluate(() => document.cookie);
    if (cookie.includes("cc_demo_account=")) break;
  }
}

export async function run() {
  for (const [sizeName, viewport] of Object.entries(VIEWPORTS)) {
    section(`=== Responsive: ${sizeName} (${viewport.width}x${viewport.height}) ===`);
    const browser = await launch();
    // A fresh context per role-group: /login redirects an already-authenticated
    // session straight to its dashboard (correct anti-phishing behaviour), so
    // switching personas mid-context never even sees the picker.
    let context = await browser.newContext({ viewport });
    let page = await context.newPage();
    page.setDefaultTimeout(45000);
    let errors = trackErrors(page);
    let authedAs = null;

    for (const target of PAGES) {
      if (target.auth !== authedAs) {
        await context.close();
        context = await browser.newContext({ viewport });
        page = await context.newPage();
        page.setDefaultTimeout(45000);
        errors = trackErrors(page);
        if (target.auth) await signInAt(page, target.auth);
        authedAs = target.auth;
      }

      errors.length = 0;
      await page.goto(`${BASE_URL}${target.path}`, { waitUntil: "networkidle" });
      const noOverflow = await checkOverflow(page, viewport.width);
      ok(
        `responsive-${sizeName}`,
        `${target.path} has no horizontal overflow at ${viewport.width}px`,
        noOverflow,
      );
      if (errors.length) {
        ok(
          `responsive-${sizeName}`,
          `${target.path} has no console errors at ${viewport.width}px`,
          false,
          errors.join("; "),
        );
      }
    }

    await context.close();
    await browser.close();
  }
  return RESULTS;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().then(() => {
    console.log(`\nResponsive: ${RESULTS.pass} passed, ${RESULTS.fail} failed`);
    process.exit(RESULTS.fail > 0 ? 1 : 0);
  });
}
