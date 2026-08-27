import { expect, test } from "@playwright/test";

import { loginAs } from "./helpers";

/**
 * REMEDIATION-PLAN §2: a slow navigation must paint a skeleton immediately
 * (loading.tsx is prefetched by Next, so the fallback shows before the
 * server round-trip completes) rather than leaving the old page inert.
 *
 * Requires the server under test to have been started with
 * CC_DEMO_SAP_LATENCY_MS set high enough to observe the skeleton frame
 * (see package.json's "e2e:slow" script, which uses 800ms).
 */
test.skip(
  !Number(process.env.CC_DEMO_SAP_LATENCY_MS),
  "requires the server under test to be started with CC_DEMO_SAP_LATENCY_MS set (npm run e2e:slow)",
);

test("shows a skeleton during a slow navigation", async ({ page }) => {
  await loginAs(page, "customer");
  await page.goto("/catalogue", { waitUntil: "networkidle" });

  await page.getByRole("link", { name: /orders/i }).first().click();

  // The URL flips immediately even though the target page hasn't rendered --
  // that alone is the "did my click register?" fix.
  await expect(page).toHaveURL(/\/orders/);
  await expect(page.locator('[aria-busy="true"]').first()).toBeAttached();
});
