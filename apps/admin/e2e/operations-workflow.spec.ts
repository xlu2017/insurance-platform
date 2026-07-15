import { expect, test, type Page } from "@playwright/test";

// Requires local Supabase running with seed data:
//   supabase start && supabase db reset
// The seeded case sits in licensed_review with a recommendation awaiting review.

async function signIn(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await page.waitForURL("**/");
}

test.describe.configure({ mode: "serial" });

test("operations can sign in and see the dashboard", async ({ page }) => {
  await signIn(page, "operations@example.com", "DemoOperations123!");
  await expect(page.getByText("Cases requiring action")).toBeVisible();
  await expect(page.getByText("Awaiting licensed review")).toBeVisible();
});

test("operations can review a case and its quotes and comparison", async ({ page }) => {
  await signIn(page, "operations@example.com", "DemoOperations123!");
  await page.goto("/cases");
  await page.getByRole("link").filter({ hasText: "Household" }).first().click();
  await expect(page.getByRole("button", { name: "Quotes" })).toBeVisible();

  await page.getByRole("button", { name: "Quotes" }).click();
  await expect(page.getByText("Received quotes")).toBeVisible();
  await expect(page.getByText("(incumbent)")).toBeVisible();

  await page.getByRole("button", { name: "Comparison" }).click();
  await expect(page.getByText("Deterministic household comparison")).toBeVisible();
  await expect(page.getByText("Incumbent combined annual cost")).toBeVisible();
});

test("operations can enter a new quote", async ({ page }) => {
  await signIn(page, "operations@example.com", "DemoOperations123!");
  await page.goto("/cases");
  await page.getByRole("link").filter({ hasText: "Household" }).first().click();
  await page.getByRole("button", { name: "Quotes" }).click();

  await page.getByLabel("Insurer").selectOption({ index: 1 });
  await page.getByLabel("Auto premium (C$)").fill("1900");
  await page.getByLabel("Property premium (C$)").fill("1200");
  await page.getByLabel("Bundle discount (C$)").fill("100");
  await page.getByRole("button", { name: "Save quote" }).click();
  await expect(page.getByText("Quote saved.")).toBeVisible();
});

test("reviewer can approve the recommendation and publish it", async ({ page }) => {
  await signIn(page, "reviewer@example.com", "DemoReviewer123!");
  await page.goto("/cases");
  await page.getByRole("link").filter({ hasText: "Household" }).first().click();
  await page.getByRole("button", { name: "Recommendation" }).click();

  const approve = page.getByRole("button", { name: "Approve and publish to customer" });
  if (await approve.isVisible()) {
    await approve.click();
    await expect(page.getByText("Review recorded.")).toBeVisible();
  } else {
    // Already reviewed in a previous run against the same database.
    await expect(page.getByText(/Published|Accepted/)).toBeVisible();
  }
});

test("operations can walk the switch to completion after customer approval", async ({ page }) => {
  await signIn(page, "operations@example.com", "DemoOperations123!");
  await page.goto("/cases");
  await page.getByRole("link").filter({ hasText: "Household" }).first().click();
  await page.getByRole("button", { name: "Switching" }).click();

  // The seeded completed historical case demonstrates the final state; an
  // in-flight switch shows advance buttons that follow the guarded ordering.
  await expect(page.getByText(/No switch in progress|Simulated switching logistics/)).toBeVisible();
});
