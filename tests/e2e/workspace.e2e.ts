import { expect, test } from "@playwright/test";

// Drives the `npm run dev` browser build, which seeds the demo workspace via
// isDevBrowser (in-memory fs + fake HTTP). No native Tauri host.

test.describe("demo workspace", () => {
  test.beforeEach(async ({ page }) => {
    await page.goto("/");
  });

  // AC-007a, TC-006 - the demo tree loads (not the empty state) and clicking a
  // request opens its tab with the url shown in the URL bar.
  test("should load the demo tree and open a request with its url", async ({
    page,
  }) => {
    // A top-level demo folder renders without expansion -> not the empty state.
    await expect(page.getByText("billing")).toBeVisible();
    await expect(page.getByText(/no workspace/i)).toHaveCount(0);

    // The root demo request `/health` opens on a single click.
    await page.getByRole("treeitem", { name: /GET \/health/ }).click();

    await expect(page.getByRole("textbox", { name: "URL" })).toHaveValue(
      /\/health/,
    );
  });

  // AC-007b, TC-007 - Send issues the request through the fake HTTP client and
  // the canned 200 response shows in the response pane.
  test("should show the canned 200 response after Send", async ({ page }) => {
    await page.getByRole("treeitem", { name: /GET \/health/ }).click();

    await page.getByRole("button", { name: "Send" }).click();

    await expect(page.getByText("200")).toBeVisible();
    await expect(page.getByText(/"demo": true/)).toBeVisible();
  });
});
