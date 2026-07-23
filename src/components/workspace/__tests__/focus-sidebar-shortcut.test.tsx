import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureTree } from "./fixtures";

// jsdom reports a non-mac platform, so Mod resolves to Control (learnings):
// focus-sidebar = Control+E, focus-toggle-sidebar = Control+0.

function renderShell(overrides: Partial<Settings> = {}) {
  const seeded: Settings = { ...DEFAULT_SETTINGS, shortcuts: {}, ...overrides };
  const store = createInMemorySettingsStore(seeded);
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

function rovingRow(): HTMLElement | undefined {
  return screen
    .getAllByRole("treeitem")
    .find((row) => row.getAttribute("tabindex") === "0");
}

describe("focus-sidebar (Mod+E)", () => {
  it("should reveal the hidden sidebar and focus its roving row", async () => {
    const user = userEvent.setup();
    renderShell({ sidebarHidden: true });
    expect(screen.queryByRole("tree", { name: /collection/i })).toBeNull();

    await user.keyboard("{Control>}e{/Control}");

    await screen.findByRole("tree", { name: /collection/i });
    await waitFor(() => {
      const row = rovingRow();
      expect(row).toBeDefined();
      expect(document.activeElement).toBe(row);
    });
  });

  it("should focus the roving row when the sidebar is already visible but unfocused", async () => {
    const user = userEvent.setup();
    renderShell({ sidebarHidden: false });
    await screen.findByRole("tree", { name: /collection/i });
    // Move focus away from the sidebar first.
    screen.getByTestId("content-region").focus();
    expect(document.activeElement).toBe(screen.getByTestId("content-region"));

    await user.keyboard("{Control>}e{/Control}");

    await waitFor(() => {
      expect(document.activeElement).toBe(rovingRow());
    });
    // Sidebar stays visible - focus-sidebar never hides.
    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
  });

  it("should never hide the sidebar even when it is already focused", async () => {
    const user = userEvent.setup();
    renderShell({ sidebarHidden: false });
    const tree = await screen.findByRole("tree", { name: /collection/i });
    await user.click(
      within(tree).getByRole("treeitem", { name: "POST token" }),
    );

    await user.keyboard("{Control>}e{/Control}");
    await user.keyboard("{Control>}e{/Control}");

    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
  });
});

describe("focus-toggle-sidebar (Mod+0)", () => {
  it("should reveal the hidden sidebar and focus its roving row", async () => {
    const user = userEvent.setup();
    renderShell({ sidebarHidden: true });
    expect(screen.queryByRole("tree", { name: /collection/i })).toBeNull();

    await user.keyboard("{Control>}0{/Control}");

    await screen.findByRole("tree", { name: /collection/i });
    await waitFor(() => {
      expect(document.activeElement).toBe(rovingRow());
    });
  });

  it("should focus the sidebar (not hide it) when visible but unfocused", async () => {
    const user = userEvent.setup();
    renderShell({ sidebarHidden: false });
    await screen.findByRole("tree", { name: /collection/i });
    screen.getByTestId("content-region").focus();

    await user.keyboard("{Control>}0{/Control}");

    await waitFor(() => {
      expect(document.activeElement).toBe(rovingRow());
    });
    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
  });

  it("should hide the sidebar when it is already focused", async () => {
    const user = userEvent.setup();
    renderShell({ sidebarHidden: false });
    await screen.findByRole("tree", { name: /collection/i });
    // Put focus inside the sidebar panel by focusing its roving row.
    rovingRow()?.focus();
    await waitFor(() => {
      expect(document.activeElement?.closest("[data-panel]")?.id).toBe(
        "sidebar",
      );
    });

    await user.keyboard("{Control>}0{/Control}");

    await waitFor(() => {
      expect(
        screen.queryByRole("tree", { name: /collection/i }),
      ).not.toBeInTheDocument();
    });
    // Focus falls back to the content region.
    await waitFor(() => {
      expect(document.activeElement).toBe(screen.getByTestId("content-region"));
    });
  });
});
