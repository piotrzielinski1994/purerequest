import {
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { fixtureTree } from "./fixtures";

// A probe rendered inside the provider so a test can set the single-selection
// (focusNode = select without toggling) and read the expanded-folder set as a
// stable, assertable string.
function SelectionProbe() {
  const { focusNode, clearSelection, expandedFolderIds } = useWorkspace();
  return (
    <div>
      <span data-testid="expanded">
        {[...expandedFolderIds].sort().join(",") || "none"}
      </span>
      <button type="button" onClick={() => focusNode("folder-auth")}>
        select auth folder
      </button>
      <button type="button" onClick={() => focusNode("folder-oauth")}>
        select oauth folder
      </button>
      <button type="button" onClick={() => focusNode("req-token")}>
        select token request
      </button>
      <button type="button" onClick={() => focusNode("req-session")}>
        select root request
      </button>
      <button type="button" onClick={() => clearSelection()}>
        clear selection
      </button>
    </div>
  );
}

function renderShell(initialExpandedIds: string[] = []) {
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
      >
        <WorkspaceLayout />
        <SelectionProbe />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

async function runFromPalette(
  user: ReturnType<typeof userEvent.setup>,
  actionName: string,
) {
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog");
  await user.type(within(dialog).getByRole("combobox"), actionName);
  await user.click(await within(dialog).findByText(actionName));
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });
}

async function clickProbe(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  await user.click(await screen.findByRole("button", { name }));
}

describe("collapse-folder / expand-folder command palette", () => {
  // AC-002 - side-effect-contract: both single-folder commands are listed in the
  // Mod+K palette.
  it("should list Collapse folder and Expand folder in the command palette", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText("Collapse folder")).toBeInTheDocument();
    expect(within(dialog).getByText("Expand folder")).toBeInTheDocument();
  });

  // AC-003, TC-003 - behavior: running Collapse folder with a folder selected
  // collapses that folder only.
  it("should collapse the selected folder if Collapse folder runs with a folder selected", async () => {
    const user = userEvent.setup();
    renderShell(["folder-auth", "folder-oauth", "folder-users"]);

    await clickProbe(user, /select auth folder/i);
    await runFromPalette(user, "Collapse folder");

    const expanded = screen.getByTestId("expanded").textContent ?? "";
    expect(expanded).not.toContain("folder-auth");
    // AC-006: sibling + descendant folders are untouched.
    expect(expanded).toContain("folder-oauth");
    expect(expanded).toContain("folder-users");
  });

  // AC-003, TC-004 - behavior: running Collapse folder with a request selected
  // collapses that request's PARENT folder.
  it("should collapse the parent folder if Collapse folder runs with a request selected", async () => {
    const user = userEvent.setup();
    renderShell(["folder-auth", "folder-oauth", "folder-users"]);

    await clickProbe(user, /select token request/i);
    await runFromPalette(user, "Collapse folder");

    const expanded = screen.getByTestId("expanded").textContent ?? "";
    // req-token's parent is folder-oauth -> collapsed.
    expect(expanded).not.toContain("folder-oauth");
    // its ancestor folder-auth and unrelated folder-users stay expanded.
    expect(expanded).toContain("folder-auth");
    expect(expanded).toContain("folder-users");
  });

  // AC-003, TC-005 - behavior: running Collapse folder with a top-level request
  // selected (parent is the root) is a no-op.
  it("should do nothing if Collapse folder runs with a top-level request selected", async () => {
    const user = userEvent.setup();
    renderShell(["folder-auth", "folder-oauth", "folder-users"]);

    await clickProbe(user, /select root request/i);
    await runFromPalette(user, "Collapse folder");

    const expanded = screen.getByTestId("expanded").textContent ?? "";
    expect(expanded).toContain("folder-auth");
    expect(expanded).toContain("folder-oauth");
    expect(expanded).toContain("folder-users");
  });

  // AC-003, TC-005 - behavior: running Collapse folder with nothing selected is a
  // no-op.
  it("should do nothing if Collapse folder runs with no selection", async () => {
    const user = userEvent.setup();
    renderShell(["folder-auth", "folder-oauth", "folder-users"]);

    await clickProbe(user, /clear selection/i);
    await runFromPalette(user, "Collapse folder");

    const expanded = screen.getByTestId("expanded").textContent ?? "";
    expect(expanded).toContain("folder-auth");
    expect(expanded).toContain("folder-oauth");
    expect(expanded).toContain("folder-users");
  });

  // AC-004, TC-006 - behavior: Collapse folder on an already-collapsed folder is
  // idempotent (never toggles it back to expanded).
  it("should keep the folder collapsed if Collapse folder runs on an already-collapsed folder", async () => {
    const user = userEvent.setup();
    renderShell([]);

    await clickProbe(user, /select auth folder/i);
    await runFromPalette(user, "Collapse folder");

    const expanded = screen.getByTestId("expanded").textContent ?? "";
    expect(expanded).not.toContain("folder-auth");
  });

  // AC-004, TC-007 - behavior: Expand folder on an already-expanded folder is
  // idempotent (stays expanded).
  it("should keep the folder expanded if Expand folder runs on an already-expanded folder", async () => {
    const user = userEvent.setup();
    renderShell(["folder-auth"]);

    await clickProbe(user, /select auth folder/i);
    await runFromPalette(user, "Expand folder");

    const expanded = screen.getByTestId("expanded").textContent ?? "";
    expect(expanded).toContain("folder-auth");
  });

  // AC-003, AC-004 - behavior: Expand folder on a collapsed selected folder
  // expands it.
  it("should expand the selected folder if Expand folder runs on a collapsed folder", async () => {
    const user = userEvent.setup();
    renderShell([]);

    await clickProbe(user, /select auth folder/i);
    await runFromPalette(user, "Expand folder");

    const expanded = screen.getByTestId("expanded").textContent ?? "";
    expect(expanded).toContain("folder-auth");
  });
});

describe("collapse-folder / expand-folder row context menu", () => {
  // AC-001, TC-001 - render-contract: an expanded folder row's menu offers
  // "Collapse folder".
  it("should show Collapse folder in the menu if the folder is expanded", async () => {
    renderShell(["folder-auth", "folder-oauth", "folder-users"]);
    const tree = await screen.findByRole("tree", { name: /collection/i });

    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: /^auth$/i }),
    );

    expect(
      await screen.findByRole("menuitem", { name: /^collapse folder$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /^expand folder$/i }),
    ).not.toBeInTheDocument();
  });

  // AC-001, TC-002 - render-contract: a collapsed folder row's menu offers
  // "Expand folder".
  it("should show Expand folder in the menu if the folder is collapsed", async () => {
    renderShell([]);
    const tree = await screen.findByRole("tree", { name: /collection/i });

    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: /^auth$/i }),
    );

    expect(
      await screen.findByRole("menuitem", { name: /^expand folder$/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /^collapse folder$/i }),
    ).not.toBeInTheDocument();
  });

  // AC-001, AC-006, TC-001 - behavior: selecting Collapse folder from a folder
  // row collapses that folder (its nested rows disappear).
  it("should collapse the folder if Collapse folder is selected from its menu", async () => {
    const user = userEvent.setup();
    renderShell(["folder-auth", "folder-oauth", "folder-users"]);
    const tree = await screen.findByRole("tree", { name: /collection/i });

    expect(
      within(tree).getByRole("treeitem", { name: /oauth/i }),
    ).toBeInTheDocument();

    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: /^auth$/i }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /^collapse folder$/i }),
    );

    await waitFor(() => {
      expect(
        within(tree).queryByRole("treeitem", { name: /oauth/i }),
      ).not.toBeInTheDocument();
    });
    // AC-006: the unrelated Users folder stays expanded.
    const expanded = screen.getByTestId("expanded").textContent ?? "";
    expect(expanded).toContain("folder-users");
  });

  // AC-007, TC-009 - render-contract: a request row's menu offers neither
  // Collapse folder nor Expand folder.
  it("should show no Collapse/Expand folder item on a request row", async () => {
    renderShell(["folder-auth", "folder-oauth"]);
    const tree = await screen.findByRole("tree", { name: /collection/i });

    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: /token/i }),
    );

    await screen.findByRole("menuitem", { name: /rename/i });
    expect(
      screen.queryByRole("menuitem", { name: /^collapse folder$/i }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole("menuitem", { name: /^expand folder$/i }),
    ).not.toBeInTheDocument();
  });
});
