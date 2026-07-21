import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureTree } from "./fixtures";

function renderShell(
  initialActiveRequestId = "req-profile",
  initialExpandedIds: string[] = ["folder-auth", "folder-oauth"],
) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={initialExpandedIds}
        initialActiveRequestId={initialActiveRequestId}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

describe("quick-open open/close (Mod+P)", () => {
  // AC-009, TC-008 — behavior: Mod+P opens the quick-open dialog; Escape closes it.
  it("should open the quick-open dialog if Mod+P fires and close it on Escape", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}p{/Control}");

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByPlaceholderText(/search requests/i),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
  });

  // AC-009, TC-008 — behavior: the quick-open dialog is distinct from the Mod+K
  // command palette (Mod+K still lists a command-palette-only action).
  it("should still open the command palette on Mod+K, distinct from quick-open", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    // Mod+P opens the quick-open dialog: no command-palette action row.
    await user.keyboard("{Control>}p{/Control}");
    const quickOpen = await screen.findByRole("dialog");
    expect(
      within(quickOpen).getByPlaceholderText(/search requests/i),
    ).toBeInTheDocument();
    expect(
      within(quickOpen).queryByText("Toggle console"),
    ).not.toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    // Mod+K opens the command palette: the command-palette-only row is present.
    await user.keyboard("{Control>}k{/Control}");
    const palette = await screen.findByRole("dialog");
    expect(within(palette).getByText("Toggle console")).toBeInTheDocument();
  });
});

describe("quick-open selecting a request (Mod+P)", () => {
  // AC-006/AC-009, TC-008 — side-effect-contract: selecting a request row that is
  // not already open opens + activates its tab.
  it("should open and activate a request tab if its quick-open row is selected", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    // "session" (req-session) is a root request that is not open initially.
    expect(
      within(tablist).queryByRole("tab", { name: "session" }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Control>}p{/Control}");
    const dialog = await screen.findByRole("dialog");

    await user.type(
      within(dialog).getByPlaceholderText(/search requests/i),
      "session",
    );
    await within(dialog).findByText("session");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const sessionTab = within(tablist).getByRole("tab", { name: "session" });
    expect(sessionTab).toHaveAttribute("aria-selected", "true");
  });

  // AC-008, TC-007 — side-effect-contract: revealing a DEEPLY NESTED request from
  // a fully-collapsed tree expands its ancestor folders so the row becomes
  // visible (the load-bearing revealNode clause) and opens+activates its tab.
  it("should expand ancestor folders if a nested request is selected from a collapsed tree", async () => {
    const user = userEvent.setup();
    // Nothing expanded: token (under Auth > OAuth) is hidden in the tree.
    renderShell("req-profile", []);
    const treeRegion = await screen.findByRole("tree", { name: /collection/i });
    expect(
      within(treeRegion).queryByRole("treeitem", { name: /oauth/i }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Control>}p{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(
      within(dialog).getByPlaceholderText(/search requests/i),
      "token",
    );
    await within(dialog).findByText("token");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    // Ancestor folders (Auth, OAuth) are now expanded, so the nested row shows.
    expect(
      within(treeRegion).getByRole("treeitem", { name: /oauth/i }),
    ).toBeInTheDocument();
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getByRole("tab", { name: "token" })).toHaveAttribute(
      "aria-selected",
      "true",
    );
  });
});

describe("quick-open selecting a folder (Mod+P)", () => {
  // AC-007, TC-008 — side-effect-contract: selecting a folder row opens its
  // config edit card (a selected editor tab named after the folder).
  it("should open the folder edit card if its quick-open row is selected", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    // "Users" (folder-users) is a collapsed root folder, not open as an editor.
    expect(
      within(tablist).queryByRole("tab", { name: /users/i }),
    ).not.toBeInTheDocument();

    await user.keyboard("{Control>}p{/Control}");
    const dialog = await screen.findByRole("dialog");

    await user.type(
      within(dialog).getByPlaceholderText(/search requests/i),
      "Users",
    );
    await within(dialog).findAllByText("Users");
    await user.keyboard("{Enter}");

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    const folderTab = within(tablist).getByRole("tab", { name: /users/i });
    expect(folderTab).toHaveAttribute("aria-selected", "true");
  });
});
