import { chromium } from "playwright";

export const BASE_URL = "http://localhost:3000";

/** Mirrors packages/services/identity.ts DEMO_ACCOUNTS. */
export const ACCOUNTS = {
  customer: { label: "Customer", email: "buyer@acme-industrial.example", kunnr: "0010001001" },
  client_admin: { label: "Client Admin", email: "admin@acme-industrial.example" },
  ap_manager: { label: "AP Manager", email: "ap@acme-industrial.example" },
  ar_manager: { label: "AR Manager", email: "ar@acme-industrial.example" },
  super_admin: { label: "Super Admin", email: "ops@customerconnect.example" },
  sap_manager: { label: "SAP Manager", email: "sap@customerconnect.example" },
};

export const RESULTS = { pass: 0, fail: 0, failures: [] };

export function ok(group, name, condition, detail) {
  if (condition) {
    RESULTS.pass++;
    console.log(`  ok    ${name}`);
  } else {
    RESULTS.fail++;
    RESULTS.failures.push({ group, name, detail });
    console.log(`  FAIL  ${name}${detail ? " -- " + detail : ""}`);
  }
}

export function section(title) {
  console.log(`\n${title}`);
}

/** Attaches console/page-error collectors and returns an array that fills as events occur. */
export function trackErrors(page) {
  const errors = [];
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") {
      const text = msg.text();
      // React DevTools / Next dev-only advisory noise we don't care about.
      if (/Download the React DevTools/.test(text)) return;
      // Expected: the browser logs a devtools-console entry for any 4xx/5xx
      // network response, including the intentional 403s the RBAC sweep
      // provokes on purpose. A real bug is a *thrown* error, not this.
      if (/Failed to load resource: the server responded with a status of (403|404)/.test(text))
        return;
      errors.push(`console.error: ${text}`);
    }
  });
  return errors;
}

export async function launch() {
  const browser = await chromium.launch();
  return browser;
}

/** Logs in as the given role via the real login UI (account picker), returns a fresh page. */
export async function loginAs(browser, roleKey) {
  const account = ACCOUNTS[roleKey];
  const context = await browser.newContext();
  const page = await context.newPage();
  // This VM runs a Turbopack dev server (on-demand route compilation) and
  // headless Chromium side by side; under load, ordinary interactions can
  // occasionally exceed Playwright's 30s default. Give them more room rather
  // than let environmental slowness read as a product bug.
  page.setDefaultTimeout(45000);
  const errors = trackErrors(page);
  // "domcontentloaded" fires once the SSR HTML is parsed, before React has
  // hydrated and attached the picker button's onClick -- a click that lands
  // in that gap is a silent no-op (native DOM click, no listener yet), which
  // surfaced as intermittent "still on /login" failures all over this suite.
  // "networkidle" is a reliable proxy for "the client bundle has run".
  await page.goto(`${BASE_URL}/login`, { waitUntil: "networkidle" });
  const picker = page.getByRole("button", { name: new RegExp(`^${account.label}\\b`) });
  await picker.waitFor({ state: "visible" });

  // Belt and suspenders: retry the click until the cookie actually lands,
  // rather than trust a single click on a page that may not be interactive
  // yet even after networkidle (e.g. a slow hydrate under load).
  for (let attempt = 0; attempt < 5; attempt++) {
    await picker.click();
    await page.waitForTimeout(300);
    const cookie = await page.evaluate(() => document.cookie);
    if (cookie.includes("cc_demo_account=")) break;
  }

  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
  return { page, context, errors };
}

export async function logout(page) {
  // RoleSwitcher / header exposes a logout action; fall back to clearing cookies.
  const logoutBtn = page.getByRole("button", { name: /log ?out/i }).first();
  if (await logoutBtn.count()) {
    await logoutBtn.click();
    await page.waitForLoadState("networkidle").catch(() => {});
  } else {
    await page.context().clearCookies();
  }
}

/** Classifies where a navigation to `path` actually landed. */
export async function classify(page, path) {
  const response = await page.goto(`${BASE_URL}${path}`, { waitUntil: "domcontentloaded" }).catch(
    (e) => ({ __navError: e }),
  );
  if (response && response.__navError) {
    return { outcome: "nav-error", status: null, url: page.url(), detail: String(response.__navError) };
  }
  await page.waitForLoadState("networkidle").catch(() => {});
  const status = response ? response.status() : null;
  const url = new URL(page.url());
  const pathname = url.pathname;

  if (pathname === "/login") return { outcome: "login-redirect", status, url: pathname };
  // Two distinct 403 shapes exist: the web app's layouts `redirect("/403")`
  // to a shared page, while the ops console uses Next's `forbidden()`
  // boundary, which renders in place with a real 403 status and no redirect.
  if (pathname === "/403" || status === 403) return { outcome: "403", status, url: pathname };
  if (pathname === "/404" || status === 404) return { outcome: "404", status, url: pathname };
  if (status && status >= 500) return { outcome: "server-error", status, url: pathname };
  if (pathname === path) return { outcome: "ok", status, url: pathname };
  return { outcome: "redirect", status, url: pathname };
}
