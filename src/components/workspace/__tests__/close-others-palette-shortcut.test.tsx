import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

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

async function openTwoMoreTabs(user: ReturnType<typeof userEvent.setup>) {
  const tree = screen.getByRole("tree", { name: /collection/i });
  await user.click(within(tree).getByRole("treeitem", { name: "POST token" }));
  await user.click(
    within(tree).getByRole("treeitem", { name: "DELETE session" }),
  );
}

describe("close-other-requests via command palette (AC-010)", () => {
  // AC-010, TC-007 — behavior: the palette command runs and the action is wired
  // (the existing palette-integration test already requires every registered
  // action to be wired; this pins the actual close-others side effect).
  it("should expose a Close other request tabs command in the palette", () => {
    const action = SHORTCUT_ACTIONS.find(
      (a) => a.id === "close-other-requests",
    );
    expect(action).toBeDefined();
  });

  // AC-010, TC-007 — side-effect-contract: running the command closes all but the
  // active request tab.
  it("should close every tab except the active one if Close other request tabs is run from the palette", async () => {
    const user = userEvent.setup();
    renderShell("req-profile");
    await screen.findByRole("region", { name: /console/i });

    // Open token + session so three request tabs are open; session is active last.
    await openTwoMoreTabs(user);
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(3);

    const action = SHORTCUT_ACTIONS.find(
      (a) => a.id === "close-other-requests",
    );
    expect(action).toBeDefined();

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("combobox"), "other request");
    await user.click(await within(dialog).findByText(action!.name));

    await waitFor(() => {
      expect(within(tablist).getAllByRole("tab")).toHaveLength(1);
    });
    // session was the last activated tab, so it is the kept/active one.
    expect(
      within(tablist).getByRole("tab", { name: "session" }),
    ).toHaveAttribute("aria-selected", "true");
  });
});
