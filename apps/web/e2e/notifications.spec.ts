import { expect, test, type Page } from "@playwright/test";

/**
 * A7 happy path: the bell in the top bar opens, reports its state, and
 * closes.
 *
 * What this suite deliberately does **not** do is assert that a specific
 * notification arrived. A notification exists because the relay in
 * `@cc/workers` published an outbox row and a handler fanned it out — a
 * separate process this suite does not run, by design (ADR-022: nothing may
 * import workers, and the web app cannot enqueue). A test that reached
 * around that to write an inbox row directly would assert the fixture rather
 * than the system; the fan-out itself is covered against a real database in
 * `@cc/service-notification`'s integration suite.
 *
 * So what is checked here is the half that is genuinely the app's: the bell
 * is wired to the API, an authenticated user gets an answer rather than an
 * error, and the panel says something honest when there is nothing in it.
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

test.describe("notifications", () => {
  test("the bell opens, loads the inbox and reports its state", async ({ page }) => {
    await signIn(page, "buyer@acme.example");

    const inbox = page.waitForResponse(
      (response) => response.url().includes("/api/notifications") && response.status() === 200,
    );

    await page.getByRole("button", { name: /Notifications/ }).click();
    await inbox;

    const panel = page.getByRole("menu", { name: "Notifications" });
    await expect(panel).toBeVisible();
    // Either there is something in it or the empty state says what will land
    // there; a blank panel would be the failure.
    await expect(panel).toContainText(/Nothing yet|ago/);

    await page.keyboard.press("Escape");
    await expect(panel).toBeHidden();
  });

  test("the back office has a bell of its own", async ({ page }) => {
    // The desk is notified about inquiries, credit requests and SLA breaches,
    // so the admin shell wires the same component.
    await signIn(page, "admin@acme.example");
    await page.goto("/admin");

    await page.getByRole("button", { name: /Notifications/ }).click();
    await expect(page.getByRole("menu", { name: "Notifications" })).toBeVisible();
  });

  test("the inbox refuses an unauthenticated request", async ({ page }) => {
    await page.context().clearCookies();
    // Navigated rather than fetched through `page.request`: the API is on the
    // tenant subdomain, which only the browser's resolver knows about.
    const response = await page.goto("/api/notifications");
    expect(response?.status()).toBe(401);
  });
});
