import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { findConflict, resolveShortcuts } from "@/lib/shortcuts/resolve";
import { fixtureTree } from "./fixtures";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

// The fixture tree has nested folders Auth > OAuth (+ Users). A collapsed tree
// hides descendant rows; expanding all reveals them. Actions are driven from the
// Mod+K palette (userEvent's keyboard parser treats a literal [ / ] as
// key-descriptor syntax, so firing the bracket chord directly is impractical).
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

describe("SHORTCUT_ACTIONS collapse/expand all folders", () => {
  // behavior: collapse-all-folders registered with the Mod+Shift+[ default.
  it("should register collapse-all-folders with the Mod+Shift+[ default", () => {
    const action = findAction("collapse-all-folders");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+[");
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // behavior: expand-all-folders registered with the Mod+Shift+] default.
  it("should register expand-all-folders with the Mod+Shift+] default", () => {
    const action = findAction("expand-all-folders");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+]");
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // behavior: resolveShortcuts exposes both defaults.
  it("should expose both defaults when no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["collapse-all-folders"]).toEqual(["Mod+Shift+["]);
    expect(effective["expand-all-folders"]).toEqual(["Mod+Shift+]"]);
  });

  // behavior: findConflict reports the owner of each bracket default.
  it("should report the owner of each bracket default", () => {
    const effective = resolveShortcuts({});

    expect(findConflict("Mod+Shift+[", "toggle-console", effective)).toBe(
      "collapse-all-folders",
    );
    expect(findConflict("Mod+Shift+]", "toggle-console", effective)).toBe(
      "expand-all-folders",
    );
  });
});

describe("expand / collapse all", () => {
  // side-effect-contract: expand-all reveals a deeply nested folder row that a
  // collapsed tree hides.
  it("should reveal all nested rows if expand-all-folders runs", async () => {
    const user = userEvent.setup();
    renderShell([]);
    const tree = await screen.findByRole("tree", { name: /collection/i });

    // Collapsed: the OAuth folder (nested under Auth) is not visible.
    expect(
      within(tree).queryByRole("treeitem", { name: /oauth/i }),
    ).not.toBeInTheDocument();

    await runFromPalette(user, findAction("expand-all-folders")!.name);

    expect(
      within(tree).getByRole("treeitem", { name: /oauth/i }),
    ).toBeInTheDocument();
  });

  // side-effect-contract: collapse-all hides descendant rows an expanded tree shows.
  it("should hide all nested rows if collapse-all-folders runs", async () => {
    const user = userEvent.setup();
    renderShell(["folder-auth", "folder-oauth", "folder-users"]);
    const tree = await screen.findByRole("tree", { name: /collection/i });

    expect(
      within(tree).getByRole("treeitem", { name: /oauth/i }),
    ).toBeInTheDocument();

    await runFromPalette(user, findAction("collapse-all-folders")!.name);

    expect(
      within(tree).queryByRole("treeitem", { name: /oauth/i }),
    ).not.toBeInTheDocument();
  });

  // side-effect-contract: both actions are runnable from the Mod+K palette.
  it("should list collapse-all and expand-all in the command palette", async () => {
    const user = userEvent.setup();
    renderShell();

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(findAction("collapse-all-folders")!.name),
    ).toBeInTheDocument();
    expect(
      within(dialog).getByText(findAction("expand-all-folders")!.name),
    ).toBeInTheDocument();
  });
});
