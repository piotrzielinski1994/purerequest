import { expect, test } from "@playwright/test";

test.describe("command palette", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    // Wait for the demo workspace to render before driving shortcuts.
    await expect(page.getByText("billing")).toBeVisible();
  });

  // AC-007c, TC-008 - Mod+K opens the palette; running "New request" opens a
  // new request tab.
  test("should open the palette with Mod+K and run New request", async ({
    page,
  }) => {
    await page.keyboard.press("ControlOrMeta+KeyK");

    const palette = page.getByPlaceholder("Type a command…");
    await expect(palette).toBeVisible();

    await palette.fill("New request");
    await page
      .getByRole("option", { name: /New request/ })
      .first()
      .click();

    // A new untitled request tab opens (the new node focuses its URL input).
    await expect(page.getByRole("textbox", { name: "URL" })).toBeFocused();
  });
});
