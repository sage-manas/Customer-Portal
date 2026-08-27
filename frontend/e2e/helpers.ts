import type { Page } from "@playwright/test";

/** Mirrors packages/services/identity.ts DEMO_ACCOUNTS (scripts/qa/helpers.mjs). */
export const ACCOUNTS = {
  customer: { label: "Customer", email: "buyer@acme-industrial.example" },
  client_admin: { label: "Client Admin", email: "admin@acme-industrial.example" },
  ap_manager: { label: "AP Manager", email: "ap@acme-industrial.example" },
  ar_manager: { label: "AR Manager", email: "ar@acme-industrial.example" },
  super_admin: { label: "Super Admin", email: "ops@customerconnect.example" },
  sap_manager: { label: "SAP Manager", email: "sap@customerconnect.example" },
} as const;

export type RoleKey = keyof typeof ACCOUNTS;

/** Logs a fresh test-owned page in as the given role via the login UI's account picker. */
export async function loginAs(page: Page, roleKey: RoleKey): Promise<void> {
  const account = ACCOUNTS[roleKey];
  await page.goto("/login", { waitUntil: "networkidle" });
  const picker = page.getByRole("button", { name: new RegExp(`^${account.label}\\b`) });
  await picker.waitFor({ state: "visible" });

  // Retry the click until the session cookie actually lands -- a click that
  // beats hydration is a silent no-op (native DOM click, no listener yet).
  for (let attempt = 0; attempt < 5; attempt++) {
    await picker.click();
    await page.waitForTimeout(300);
    const cookie = await page.evaluate(() => document.cookie);
    if (cookie.includes("cc_demo_account=")) break;
  }

  await page.waitForURL((url) => url.pathname !== "/login", { timeout: 15_000 }).catch(() => {});
  await page.waitForLoadState("networkidle").catch(() => {});
}

export interface RouteOutcome {
  outcome: "ok" | "redirect" | "403" | "404" | "login-redirect" | "server-error" | "nav-error";
  status: number | null;
  url: string;
}

/** Classifies where a navigation to `path` actually landed -- see scripts/qa/helpers.mjs. */
export async function classify(page: Page, path: string): Promise<RouteOutcome> {
  // A guarded route that redirects client-side (e.g. /admin/exceptions ->
  // /admin/ap) can still be mid-navigation when the *next* classify() call
  // starts its own goto, which Playwright surfaces as "interrupted by
  // another navigation". One retry clears it without masking a real hang --
  // an explicit per-call timeout (rather than the whole test's budget) is
  // what turns a stuck route into a fast, isolated failure.
  let response;
  try {
    response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
  } catch (error) {
    if (String(error).includes("interrupted by another navigation")) {
      response = await page.goto(path, { waitUntil: "domcontentloaded", timeout: 20_000 });
    } else {
      throw error;
    }
  }
  await page.waitForLoadState("networkidle", { timeout: 20_000 }).catch(() => {});
  const status = response ? response.status() : null;
  const pathname = new URL(page.url()).pathname;

  if (pathname === "/login") return { outcome: "login-redirect", status, url: pathname };
  // Two distinct 403 shapes: the web app's layouts `redirect("/403")`, while
  // the ops console renders Next's `forbidden()` boundary in place.
  if (pathname === "/403" || status === 403) return { outcome: "403", status, url: pathname };
  if (pathname === "/404" || status === 404) return { outcome: "404", status, url: pathname };
  if (status && status >= 500) return { outcome: "server-error", status, url: pathname };
  if (pathname === path) return { outcome: "ok", status, url: pathname };
  return { outcome: "redirect", status, url: pathname };
}
