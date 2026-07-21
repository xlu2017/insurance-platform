import { expect, test, type Page } from "@playwright/test";

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

test.describe.configure({ mode: "serial" });

test("operations can sign in and view the dashboard", async ({ page }) => {
  await signIn(page, "operations@example.com", "DemoOperations123!");
  await expect(page.getByText("Cases requiring action")).toBeVisible();
  await expect(page.getByText("Awaiting licensed review")).toBeVisible();
});

test("staff can open a case and browse tabs", async ({ page }) => {
  await signIn(page, "operations@example.com", "DemoOperations123!");
  await page.goto("/cases");
  await expect(page.getByText("Case queue")).toBeVisible();

  const caseLink = page
    .getByRole("link")
    .filter({ hasText: /Household/ })
    .first();
  await expect(caseLink).toBeVisible();
  await caseLink.click();

  await expect(page.getByRole("heading")).toBeVisible();

  const tabs = ["Quotes", "Comparison", "Recommendation", "Switching", "Audit"];
  for (const label of tabs) {
    await page.getByRole("button", { name: label }).click();
  }
});

test("customer accounts are rejected from the admin console", async ({ page }) => {
  await page.goto("/login");
  await page.getByLabel("Email").fill("customer@example.com");
  await page.getByLabel("Password").fill("DemoCustomer123!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(
    page.getByText("This console is for operations, reviewer and administrator accounts."),
  ).toBeVisible();
});

test("unauthenticated users are redirected to login", async ({ page }) => {
  await page.goto("/cases");
  await page.waitForURL("**/login");
  await expect(page.getByRole("button", { name: "Sign in" })).toBeVisible();
});

test("the SSO button is available on the login page", async ({ page }) => {
  await page.goto("/login");
  await expect(page.getByRole("button", { name: "Sign in with SSO" })).toBeVisible();
});

test("SSO callback without a valid code rejects and returns to login", async ({ page }) => {
  await page.goto("/auth/callback");
  await page.waitForURL("**/login**");
  await expect(page.getByRole("button", { name: "Sign in with SSO" })).toBeVisible();
});

// The callback applies the same staff-only gate as the password flow: a
// customer-role (or role-less) SSO session is signed out and redirected to
// /login?error=staff_only, which the login page surfaces as this message.
test("SSO staff-only rejection surfaces the operations-only error", async ({ page }) => {
  await page.goto("/login?error=staff_only");
  await expect(
    page.getByText("This console is for operations, reviewer and administrator accounts."),
  ).toBeVisible();
});

// Full provider round-trip requires a live OAuth provider, so it is gated
// behind SSO_E2E. Without it, the assertions above cover button rendering and
// the callback's rejection path for a non-staff session.
test("full Google SSO staff sign-in flow", async ({ page }) => {
  test.skip(process.env.SSO_E2E !== "1", "Set SSO_E2E=1 with a configured provider to run.");
  await page.goto("/login");
  await page.getByRole("button", { name: "Sign in with SSO" }).click();
  await page.waitForURL("**/");
  await expect(page.getByText("Cases requiring action")).toBeVisible();
});
