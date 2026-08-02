import { expect, test } from "@playwright/test";

test("strict Purchase Authorization works in Chromium", async ({ page }) => {
  const consoleProblems: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));

  await page.goto("/");
  await page.getByRole("button", { name: "Start assessment" }).click();
  await page.getByRole("button", { name: "Compare offers" }).click();
  await expect(page.getByRole("heading", { name: "Offer comparison" })).toBeVisible();
  await page.getByRole("button", { name: "Inspect evidence" }).click();
  await page.getByRole("button", { name: "Review approval summary" }).click();

  const authorize = page.getByRole("button", { name: "Create Purchase Authorization" });
  await expect(authorize).toBeDisabled();
  await page.getByRole("checkbox", { name: /sealed and unopened/i }).check();
  await expect(authorize).toBeDisabled();
  await page.getByRole("checkbox", { name: /No fee stated/i }).check();
  await expect(authorize).toBeEnabled();
  await page.screenshot({ path: "/tmp/undo-approval-desktop.png", fullPage: true });
  await authorize.click();

  await expect(page.getByRole("heading", { name: "Checkout decision" })).toBeVisible();
  await expect(page.getByText(/Active/)).toBeVisible();
  await expect(page.getByText(/No checkout has been submitted/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Authorize sandbox checkout" })).toBeDisabled();
  expect(consoleProblems).toEqual([]);
});

test("Approval Summary remains usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Start assessment" }).click();
  await page.getByRole("button", { name: "Compare offers" }).click();
  await page.getByRole("button", { name: "Inspect evidence" }).click();
  await page.getByRole("button", { name: "Review approval summary" }).click();
  await expect(page.getByRole("heading", { name: "Approval Summary" })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /sealed and unopened/i })).toBeVisible();
  await expect(page.getByRole("checkbox", { name: /No fee stated/i })).toBeVisible();
  await page.screenshot({ path: "/tmp/undo-approval-mobile.png", fullPage: true });
});
