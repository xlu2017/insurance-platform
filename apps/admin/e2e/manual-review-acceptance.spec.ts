import { expect, test, type Page } from "@playwright/test";

test.use({ video: "on" });
test.describe.configure({ mode: "serial" });
test.setTimeout(120_000);

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await page.waitForURL("**/");
  await expect(page.getByText("Cases requiring action")).toBeVisible();
}

async function waitForToast(page: Page, text: string | RegExp) {
  await expect(page.getByText(text).first()).toBeVisible();
}

function inputByLabel(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=..").locator("input");
}

function selectByLabel(page: Page, label: string) {
  return page.getByText(label, { exact: true }).locator("xpath=..").locator("select");
}

test("admin logs in, completes a manual review, and returns after logout", async ({ page }) => {
  const suffix = Date.now().toString();
  const vehicleLabel = `Browser Vehicle ${suffix}`;
  const vehicleModel = `Civic-${suffix}`;

  // 1. Password authentication and staff role authorization.
  await signIn(page, "admin@example.com", "DemoAdmin123!");
  await expect(page.getByText("Cases requiring action")).toBeVisible();

  // 2. Open the case queue and select the active browser-acceptance household.
  await page.goto("/cases");
  await expect(page.getByText("Case queue")).toBeVisible();
  await page
    .locator("tr")
    .filter({ hasText: /Awaiting Documents/ })
    .getByRole("link", { name: /Miller Household/ })
    .click();
  await expect(page.getByRole("heading", { name: /Miller Household/ })).toBeVisible();
  const caseUrl = page.url();

  // 3. Open the Manual Review tab.
  await page.getByRole("button", { name: "Manual Review", exact: true }).click();
  await expect(page.getByText("Record manual candidate")).toBeVisible();

  // 4. Fill in a source document, identity, policy and coverage, then save the candidate.
  const sourceDocLabel = page.locator("label", { hasText: /browser-test-document/ });
  await expect(sourceDocLabel).toBeVisible({ timeout: 30_000 });
  await sourceDocLabel.locator("input").check();

  await selectByLabel(page, "Asset type").selectOption("vehicle");
  await inputByLabel(page, "Display label").fill(vehicleLabel);
  await inputByLabel(page, "Year").fill("2020");
  await inputByLabel(page, "Make").fill("Honda");
  await inputByLabel(page, "Model").fill(vehicleModel);
  await inputByLabel(page, "Insurer name").fill("Browser Acceptance Insurer");
  await inputByLabel(page, "Annual premium (C$)").fill("1200");
  await inputByLabel(page, "Expiry date").fill("2027-09-01");

  await page.getByRole("button", { name: "Save manual candidate", exact: true }).click();
  await waitForToast(page, /Manual candidate saved/);
  await expect(page.getByText(vehicleLabel)).toBeVisible();

  // 5. Mark the source document as reviewed.
  await page.getByRole("button", { name: "Reviewed", exact: true }).click();
  await expect(page.getByText("reviewed", { exact: true })).toBeVisible();

  // 6. Complete the staff manual review.
  await page.getByRole("button", { name: "Complete manual review", exact: true }).click();
  await waitForToast(page, /Manual review completed/);

  // 7. Sign out.
  await page.getByRole("button", { name: "Sign out", exact: true }).click();
  await page.waitForURL("**/login");
  await expect(page.getByRole("button", { name: "Sign in", exact: true })).toBeVisible();

  // 8. Sign in again and verify the completed candidate is still present.
  await signIn(page, "admin@example.com", "DemoAdmin123!");
  await page.goto(caseUrl);
  await page.getByRole("button", { name: "Manual Review", exact: true }).click();
  await expect(page.getByText(vehicleLabel)).toBeVisible();
});
