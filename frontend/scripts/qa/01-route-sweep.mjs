/**
 * Route sweep: for every role, visit every route and assert the outcome
 * (ok / redirect / 403 / 404) matches the documented RBAC matrix
 * (MIGRATION-PHASE-1.md section 3), verified live against the running app
 * rather than assumed.
 *
 * The matrix itself lives in route-matrix.mjs, shared with
 * e2e/route-sweep.spec.ts (REMEDIATION-PLAN §7 Tier 3) so the two never
 * drift apart.
 */
import { fileURLToPath } from "node:url";
import { launch, loginAs, classify, ok, section, RESULTS } from "./helpers.mjs";
import { GROUPS, ROLES, matches } from "./route-matrix.mjs";

export async function run() {
  const consoleErrorsByRoute = [];

  section("=== Route sweep: unauthenticated ===");
  {
    // A fresh browser per leg: a single Chromium process pushed through
    // 270+ full navigations in a row was observed to degrade late in the
    // run (net::ERR_INSUFFICIENT_RESOURCES, cookies silently not sticking)
    // — an artifact of this harness, not the app. Recycling the browser
    // keeps each leg's result trustworthy.
    const browser = await launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    for (const g of GROUPS) {
      for (const path of g.paths) {
        const result = await classify(page, path);
        ok("anon", `${path} -> login`, result.outcome === "login-redirect", JSON.stringify(result));
      }
    }
    await browser.close();
  }

  for (const roleKey of ROLES) {
    section(`=== Route sweep: ${roleKey} ===`);
    const browser = await launch();
    const { page, context, errors } = await loginAs(browser, roleKey);
    for (const g of GROUPS) {
      const expected = g.expect[roleKey];
      for (const path of g.paths) {
        errors.length = 0;
        const result = await classify(page, path);
        const pass = matches(result, expected, roleKey);
        ok(
          roleKey,
          `${path} -> expected ${expected}, got ${result.outcome}${result.url ? " (" + result.url + ")" : ""}`,
          pass,
          pass ? undefined : JSON.stringify(result),
        );
        if (errors.length) {
          consoleErrorsByRoute.push({ roleKey, path, errors: [...errors] });
        }
      }
    }
    await context.close();
    await browser.close();
  }

  section("=== Console/page errors observed during sweep ===");
  if (consoleErrorsByRoute.length === 0) {
    console.log("  none");
  } else {
    for (const entry of consoleErrorsByRoute) {
      console.log(`  ${entry.roleKey} ${entry.path}:`);
      for (const e of entry.errors) console.log(`    - ${e}`);
    }
  }

  return { RESULTS, consoleErrorsByRoute };
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  run().then(() => {
    console.log(`\nRoute sweep: ${RESULTS.pass} passed, ${RESULTS.fail} failed`);
    process.exit(RESULTS.fail > 0 ? 1 : 0);
  });
}
