import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { formatForDisplay } from "@tanstack/hotkeys";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";
import { fixtureTree } from "./fixtures";

function renderShell(initialActiveRequestId = "req-profile") {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId={initialActiveRequestId}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

const PALETTE_ACTIONS = SHORTCUT_ACTIONS.filter(
  (action) => action.id !== "open-command-palette",
);

describe("command palette open/close (Mod+K)", () => {
  // AC-002, TC-001 — behavior
  it("should open the palette overlay if Mod+K fires and close it on Escape", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // AC-003, TC-002 — behavior
  it("should list every wired action except open-command-palette with its shortcut", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    for (const action of PALETTE_ACTIONS) {
      expect(within(dialog).getByText(action.name)).toBeInTheDocument();
      expect(
        within(dialog).getByText(formatForDisplay(action.defaultHotkey)),
      ).toBeInTheDocument();
    }

    const palette = SHORTCUT_ACTIONS.find(
      (a) => a.id === "open-command-palette",
    )!;
    expect(within(dialog).queryByText(palette.name)).not.toBeInTheDocument();
  });
});

describe("command palette run actions", () => {
  // AC-006, TC-004 — side-effect-contract
  it("should toggle the console and close the palette if Toggle console is run from it", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByRole("combobox"), "console");
    await within(dialog).findByText("Toggle console");
    await user.keyboard("{Enter}");

    // The console pane disappears and the palette closes.
    await waitFor(() => {
      expect(
        screen.queryByRole("region", { name: /console/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  // AC-007, TC-006 — side-effect-contract
  it("should toggle the sidebar and close the palette if Toggle sidebar is clicked", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    await user.click(within(dialog).getByText("Toggle sidebar"));

    await waitFor(() => {
      expect(
        screen.queryByRole("tree", { name: /collection/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
});
