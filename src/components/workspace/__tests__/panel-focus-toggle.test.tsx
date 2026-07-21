import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureTree } from "./fixtures";

// Panel focus-on-toggle is an integration behavior: a toggle hotkey both flips
// the panel's visibility AND moves keyboard focus. jsdom reports a non-mac
// platform, so the defaults resolve via Mod -> Control (learnings): toggle
// sidebar = Control+B, toggle console = Control+J.
//
// ASSUMPTION FOR THE IMPL: the content region test targeted by TC-014 is queried
// via data-testid="content-region"; the plan adds tabIndex=-1 + a ref to the
// Content root <div>, and the main agent must also stamp that data-testid on the
// same element so this test can locate it.

function renderShell(overrides: Partial<Settings> = {}) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, ...overrides };
  const store = createInMemorySettingsStore(seeded);
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

describe("panel focus on toggle", () => {
  // AC-011, TC-012 — side-effect-contract
  it("should focus the roving sidebar tree row if the sidebar is toggled from hidden to visible", async () => {
    const user = userEvent.setup();
    renderShell({ sidebarHidden: true });
    // Sidebar hidden: no tree rows yet.
    expect(screen.queryByRole("tree", { name: /collection/i })).toBeNull();

    await user.keyboard("{Control>}b{/Control}");

    await screen.findByRole("tree", { name: /collection/i });
    await waitFor(() => {
      const rovingRow = screen
        .getAllByRole("treeitem")
        .find((row) => row.getAttribute("tabindex") === "0");
      expect(rovingRow).toBeDefined();
      expect(document.activeElement).toBe(rovingRow);
    });
  });

  // AC-012, TC-013 — side-effect-contract
  it("should focus the console region if the console is toggled from hidden to visible", async () => {
    const user = userEvent.setup();
    renderShell({ consoleHidden: true });
    expect(screen.queryByRole("region", { name: /console/i })).toBeNull();

    await user.keyboard("{Control>}j{/Control}");

    const consoleRegion = await screen.findByRole("region", {
      name: /console/i,
    });
    await waitFor(() => {
      expect(document.activeElement).toBe(consoleRegion);
    });
    expect(consoleRegion).toHaveAttribute("tabindex", "-1");
  });

  // AC-013, TC-014 — side-effect-contract
  it("should focus the content region if a visible panel is toggled hidden", async () => {
    const user = userEvent.setup();
    renderShell({ consoleHidden: false });
    // Console starts visible.
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}j{/Control}");

    // Console gone; focus returns to the content region.
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: /console/i }),
      ).not.toBeInTheDocument();
    });
    const contentRegion = screen.getByTestId("content-region");
    await waitFor(() => {
      expect(document.activeElement).toBe(contentRegion);
    });
  });
});
