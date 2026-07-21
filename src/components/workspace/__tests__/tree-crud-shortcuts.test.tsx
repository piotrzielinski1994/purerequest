import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Main } from "@/components/workspace/main";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { findConflict, resolveShortcuts } from "@/lib/shortcuts/resolve";
import type { TreeNode } from "@/lib/workspace/model";
import { fixtureTree } from "./fixtures";

// =========================================================================
// Registry: the four new actions exist with the spec defaults (AC-009).
// Mirrors new-actions-registry.test.ts (pure registry style).
// =========================================================================

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS tree-crud actions (AC-009)", () => {
  // AC-009 - behavior: new-folder defaults to Mod+Shift+N.
  it("should register new-folder with the Mod+Shift+N default", () => {
    const action = findAction("new-folder");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+N");
  });

  // AC-009, TC-011 - behavior: duplicate-node defaults to Mod+D, is labelled
  // "Duplicate" with the request-or-folder description, and the old
  // duplicate-request id is gone.
  it("should register duplicate-node with the Mod+D default, 'Duplicate' label, and no legacy duplicate-request", () => {
    const action = findAction("duplicate-node");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+D");
    expect(action!.name).toBe("Duplicate");
    expect(action!.description).toBe(
      "Duplicate the selected request or folder.",
    );
    // the legacy request-only id must be gone (renamed, not additive).
    expect(
      SHORTCUT_ACTIONS.some((a) => (a.id as string) === "duplicate-request"),
    ).toBe(false);
  });

  // AC-009 - behavior: rename-node defaults to F2.
  it("should register rename-node with the F2 default", () => {
    const action = findAction("rename-node");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("F2");
  });

  // AC-009 - behavior: delete-node defaults to Mod+Backspace.
  it("should register delete-node with the Mod+Backspace default", () => {
    const action = findAction("delete-node");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Backspace");
  });

  // AC-009 - behavior: each new action has a non-empty name + description.
  it("should give each new action a non-empty name and description", () => {
    const ids: ShortcutActionId[] = [
      "new-folder",
      "duplicate-node",
      "rename-node",
      "delete-node",
    ];

    ids.forEach((id) => {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(action!.name.length).toBeGreaterThan(0);
      expect(action!.description.length).toBeGreaterThan(0);
    });
  });

  // AC-009 - behavior: the defaults flow through resolveShortcuts.
  it("should expose the new defaults via resolveShortcuts when no overrides are set", () => {
    const effective = resolveShortcuts({});

    expect(effective["new-folder"]).toEqual(["Mod+Shift+N"]);
    expect(effective["duplicate-node"]).toEqual(["Mod+D"]);
    expect(effective["rename-node"]).toEqual(["F2"]);
    expect(effective["delete-node"]).toEqual(["Mod+Backspace"]);
  });

  // AC-009 - behavior: the new bindings participate in conflict checking.
  it("should report rename-node as the owner if F2 is recorded for another action", () => {
    const effective = resolveShortcuts({});

    expect(findConflict("F2", "duplicate-node", effective)).toBe("rename-node");
  });
});

// =========================================================================
// Main wiring: handlers act on selectedNodeId; no-op without a target;
// delete-node guards while an editable surface is focused (AC-009, TC-013/014).
// jsdom resolves Mod -> Control (learnings), so Mod+D = Control+d etc.
// =========================================================================

const collect = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) =>
    node.kind === "folder" ? [node, ...collect(node.children)] : [node],
  );

type ProbeSurface = ReturnType<typeof useWorkspace> & {
  selectNode: (id: string) => void;
};

// A sibling probe under the same provider as Main: reads tree counts + offers a
// focusable input (for the editable-focus guard) and a select button.
function TreeProbe() {
  const ctx = useWorkspace() as ProbeSurface;
  const { tree, selectNode } = ctx;
  const nodes = collect(tree);
  const requestCount = nodes.filter((n) => n.kind === "request").length;
  return (
    <div>
      <span data-testid="request-count">{requestCount}</span>
      <span data-testid="tree-ids">{nodes.map((n) => n.id).join(",")}</span>
      <button type="button" onClick={() => selectNode("req-profile")}>
        select profile
      </button>
      <button type="button" onClick={() => selectNode("req-session")}>
        select session
      </button>
      <input data-testid="guard-input" aria-label="guard field" />
    </div>
  );
}

function renderMainWithProbe(initialActiveRequestId?: string) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={["[12:00:00] Ready."]}
        initialExpandedIds={["folder-users"]}
        initialActiveRequestId={initialActiveRequestId}
      >
        <TreeProbe />
        <Main />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

describe("tree-crud shortcut wiring in Main (AC-009)", () => {
  // AC-009, TC-013 - behavior: with a request selected, duplicate-node adds a
  // node to the tree.
  it("should duplicate the selected request if duplicate-node fires", async () => {
    const user = userEvent.setup();
    renderMainWithProbe("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.click(screen.getByRole("button", { name: /select profile/i }));
    const before = Number(
      screen.getByTestId("request-count").textContent ?? "0",
    );

    await user.keyboard("{Control>}d{/Control}");

    await waitFor(() => {
      expect(screen.getByTestId("request-count")).toHaveTextContent(
        String(before + 1),
      );
    });
  });

  // AC-009, TC-013 - behavior: with nothing selected, duplicate-node no-ops.
  it("should not change the tree if duplicate-node fires with no selection", async () => {
    const user = userEvent.setup();
    // RED guard: the action must be registered for this to be a meaningful test
    // (else it passes trivially because the hotkey isn't wired at all).
    expect(findAction("duplicate-node")).toBeDefined();
    renderMainWithProbe();
    await screen.findByRole("region", { name: /console/i });

    const before = screen.getByTestId("request-count").textContent;

    await user.keyboard("{Control>}d{/Control}");

    // give the (no-op) handler a tick; count is unchanged.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(screen.getByTestId("request-count")).toHaveTextContent(before ?? "");
  });

  // AC-009, TC-013 - behavior: delete-node removes the selected request. Uses
  // req-session (a unique id in the fixture - req-profile appears twice) so the
  // assertion proves exactly that node is gone, not an ambiguous count drop.
  it("should delete the selected request if delete-node fires", async () => {
    const user = userEvent.setup();
    renderMainWithProbe("req-session");
    await screen.findByRole("region", { name: /console/i });

    await user.click(screen.getByRole("button", { name: /select session/i }));
    expect(screen.getByTestId("tree-ids").textContent).toContain("req-session");

    // req-session deletes immediately - no confirm dialog (a leaf request).
    await user.keyboard("{Control>}{Backspace}{/Control}");

    await waitFor(() => {
      expect(screen.getByTestId("tree-ids").textContent).not.toContain(
        "req-session",
      );
    });
  });

  // AC-009, TC-014 - behavior: delete-node does NOT delete while a text input is
  // focused (the editable-focus guard keeps Mod+Backspace for text editing).
  it("should not delete the selected node if delete-node fires while a text input is focused", async () => {
    const user = userEvent.setup();
    // RED guard: the action must be registered for the guard to be meaningful
    // (else this passes trivially because delete-node isn't wired at all).
    expect(findAction("delete-node")).toBeDefined();
    renderMainWithProbe("req-profile");
    await screen.findByRole("region", { name: /console/i });

    await user.click(screen.getByRole("button", { name: /select profile/i }));
    const before = screen.getByTestId("request-count").textContent;

    // Focus the input directly. (user.click inside Main's ResizablePanelGroup
    // lets the panel separator steal focus under jsdom - a known resizable-panels
    // focus quirk - so .focus() establishes the "text input focused" precondition
    // this guard test needs.)
    screen.getByTestId("guard-input").focus();
    await user.keyboard("{Control>}{Backspace}{/Control}");

    await new Promise((resolve) => setTimeout(resolve, 0));
    // nothing deleted - the count is unchanged.
    expect(screen.getByTestId("request-count")).toHaveTextContent(before ?? "");
  });
});
