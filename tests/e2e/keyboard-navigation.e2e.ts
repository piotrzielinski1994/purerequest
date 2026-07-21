import { expect, test } from "@playwright/test";

// Drives the `npm run dev` browser build (isDevBrowser: in-memory fs + fake
// HTTP), which seeds the demo workspace. These specs cover the keyboard paths
// that jsdom cannot exercise because it lacks real element rects (dnd-kit
// keyboard reorder) or a native contextmenu-key event.

test.describe("keyboard tree navigation", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("billing")).toBeVisible();
  });

  // AC-001/002 - arrow to a request row and open it with Enter, no mouse.
  test("should navigate the tree and open a request with the keyboard only", async ({
    page,
  }) => {
    const auth = page.getByRole("treeitem", { name: "auth", exact: true });
    await auth.focus();

    // ArrowDown moves selection down the visible rows; /health is the last
    // top-level row (after the auth/users/billing folders, all collapsed).
    await page.keyboard.press("End");
    await expect(
      page.getByRole("treeitem", { name: /GET \/health/ }),
    ).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("textbox", { name: "URL" })).toHaveValue(
      /\/health/,
    );
  });

  // AC-003 - a collapsed folder expands with ArrowRight and reveals its children.
  test("should expand a folder with ArrowRight", async ({ page }) => {
    const auth = page.getByRole("treeitem", { name: "auth", exact: true });
    await auth.focus();
    await expect(auth).toHaveAttribute("aria-expanded", "false");

    await page.keyboard.press("ArrowRight");
    await expect(auth).toHaveAttribute("aria-expanded", "true");
    await expect(
      page.getByRole("treeitem", { name: "oauth", exact: true }),
    ).toBeVisible();
  });
});

test.describe("keyboard tab reorder", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("billing")).toBeVisible();
  });

  // AC-009 - open two request tabs, then reorder them with the keyboard drag
  // (Space to grab, Arrow to move, Space to drop). Needs real rects, hence e2e.
  test("should reorder request tabs with the keyboard", async ({ page }) => {
    // Open /health, then expand billing and open an invoice, so two tabs exist.
    await page.getByRole("treeitem", { name: /GET \/health/ }).click();
    await page.getByRole("treeitem", { name: "billing" }).click();
    await page.getByRole("treeitem", { name: /\/billing\/invoices/ }).click();

    const tablist = page.getByRole("tablist", { name: /open requests/i });
    const tabsBefore = await tablist.getByRole("tab").allInnerTexts();
    expect(tabsBefore.length).toBeGreaterThanOrEqual(2);

    // The dnd-kit keyboard drag lives on the sortable WRAPPER (the element
    // carrying aria-roledescription), not the inner tab button. Grab the first
    // wrapper and move it one slot right.
    const firstHandle = tablist
      .locator('[aria-roledescription="sortable"]')
      .first();
    await firstHandle.focus();
    await page.keyboard.press("Space");
    // Confirm the drag was picked up before moving (dnd-kit sets aria-pressed).
    await expect(firstHandle).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("ArrowRight");
    // dnd-kit recomputes the drop target on the next animation frame. On pickup
    // it announces "moved over <self>"; after ArrowRight it announces moved over
    // the SECOND tab. Wait for that second-tab announcement before dropping,
    // else Space drops the item back on itself (no reorder). Match on the second
    // tab's id (billing-invoices) so we don't fire on the pickup-over-self line.
    await expect(
      page
        .locator('[id^="DndLiveRegion"]')
        .filter({ hasText: /moved over droppable area .*invoices/i }),
    ).toHaveCount(1);
    await page.keyboard.press("Space");

    await expect
      .poll(() => tablist.getByRole("tab").allInnerTexts())
      .not.toEqual(tabsBefore);
    const tabsAfter = await tablist.getByRole("tab").allInnerTexts();
    expect(tabsAfter[0]).toBe(tabsBefore[1]);
  });
});

test.describe("keyboard context menus", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
    await expect(page.getByText("billing")).toBeVisible();
  });

  // AC-008 - Shift+F10 on a focused tree row opens its context menu. This is the
  // browser-native keyboard->contextmenu binding jsdom can't synthesize, so it
  // is only provable end-to-end.
  test("should open a tree row's context menu with Shift+F10", async ({
    page,
  }) => {
    const health = page.getByRole("treeitem", { name: /GET \/health/ });
    await health.focus();
    await page.keyboard.press("Shift+F10");

    await expect(page.getByRole("menuitem", { name: /rename/i })).toBeVisible();
  });

  // AC-010 - Shift+F10 on a focused request tab opens its close menu.
  test("should open a request tab's context menu with Shift+F10", async ({
    page,
  }) => {
    await page.getByRole("treeitem", { name: /GET \/health/ }).click();

    const tablist = page.getByRole("tablist", { name: /open requests/i });
    await tablist.locator('[aria-roledescription="sortable"]').first().focus();
    await page.keyboard.press("Shift+F10");

    await expect(
      page.getByRole("menuitem", { name: /^close$/i }),
    ).toBeVisible();
  });
});
