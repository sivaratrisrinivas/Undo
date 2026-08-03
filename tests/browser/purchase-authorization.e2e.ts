import { expect, test } from "@playwright/test";

test("one Purchase Authorization produces one completed sandbox checkout in Chromium", async ({ page }) => {
  const consoleProblems: Array<string> = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") {
      consoleProblems.push(`${message.type()}: ${message.text()}`);
    }
  });
  page.on("pageerror", (error) => consoleProblems.push(`pageerror: ${error.message}`));

  await page.goto("/");
  await page.evaluate(() => document.fonts.ready);
  expect(await page.evaluate(() => document.fonts.check('520 16px "Manrope Variable"'))).toBe(true);
  expect(await page.getByRole("heading", { name: "Know the way back before you buy." }).evaluate((heading) => getComputedStyle(heading).fontFamily)).toContain("Manrope Variable");
  await page.screenshot({ path: "/tmp/undo-setup-desktop.png", fullPage: true });
  await page.getByRole("button", { name: "Assess this purchase" }).click();
  await expect(page.getByRole("heading", { name: "Your Reversibility Assessment" })).toBeFocused();
  await expect(page.getByRole("heading", { name: "Offer comparison" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Approval Summary" })).toBeVisible();
  await expect(page.getByText("Prava hosted sandbox card")).toBeVisible();

  const authorize = page.getByRole("button", { name: /Authorize ₹14,990 & submit once/ });
  await expect(authorize).toBeDisabled();
  await page.getByRole("checkbox", { name: /I acknowledge every Material Warning/ }).check();
  await expect(authorize).toBeEnabled();
  await page.screenshot({ path: "/tmp/undo-approval-desktop.png", fullPage: true });
  await authorize.click();

  await expect(page.getByRole("heading", { name: "Undo Record" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Undo Record" })).toBeFocused();
  await expect(page.getByText("Purchased")).toBeVisible();
  await expect(page.getByText("sandbox-order-demo-001")).toBeVisible();
  await expect(page.getByText("Used for one checkout attempt")).toBeVisible();
  await page.screenshot({ path: "/tmp/undo-completed-purchase-desktop.png", fullPage: true });
  expect(consoleProblems).toEqual([]);
});

test("Approval Summary remains usable at a mobile viewport", async ({ page }) => {
  await page.setViewportSize({ width: 320, height: 800 });
  await page.goto("/");
  await page.getByRole("button", { name: "Assess this purchase" }).click();
  await expect(page.getByRole("heading", { name: "Approval Summary" })).toBeVisible();
  const warningAcknowledgement = page.getByRole("checkbox", { name: /I acknowledge every Material Warning/ });
  await expect(warningAcknowledgement).toBeVisible();
  await expect(warningAcknowledgement).toHaveAccessibleName(/Product must remain sealed and unopened\./);
  await expect(warningAcknowledgement).toHaveAccessibleName(/No fee stated—cost uncertain\./);
  const viewportWidth = await page.evaluate(() => ({
    client: document.documentElement.clientWidth,
    scroll: document.documentElement.scrollWidth,
  }));
  expect(viewportWidth).toEqual({ client: 320, scroll: 320 });
  await page.screenshot({ path: "/tmp/undo-approval-mobile.png", fullPage: true });
});
