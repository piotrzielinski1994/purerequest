import { describe, expect, it } from "vitest";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { resolveTreeKey, treeMoveTarget } from "@/lib/workspace/tree-keyboard";

const request = (id: string): RequestNode => ({
  kind: "request",
  id,
  name: id,
  method: "GET",
  url: `https://x/${id}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const folder = (id: string, children: TreeNode[]): FolderNode => ({
  kind: "folder",
  id,
  name: id,
  config: {},
  children,
});

//   f1 (folder)
//     c1 (request)
//     c2 (request)
//   f2 (folder, empty)
//   r1 (request)
const tree: TreeNode[] = [
  folder("f1", [request("c1"), request("c2")]),
  folder("f2", []),
  request("r1"),
];

const expandedAll = new Set(["f1", "f2"]);
const collapsed = new Set<string>();

// The default binding map (registry defaults, no overrides).
const defaultBindings = resolveShortcuts({});

// Build a KeyboardEvent that matches how TanStack reads events: it uses
// `event.key` plus the modifier booleans.
function keyEvent(
  key: string,
  mods: { shift?: boolean; alt?: boolean; meta?: boolean; ctrl?: boolean } = {},
): KeyboardEvent {
  return new KeyboardEvent("keydown", {
    key,
    shiftKey: mods.shift ?? false,
    altKey: mods.alt ?? false,
    metaKey: mods.meta ?? false,
    ctrlKey: mods.ctrl ?? false,
  });
}

const resolve = (
  event: KeyboardEvent,
  focusedId: string,
  expandedIds: Set<string> = expandedAll,
  bindings = defaultBindings,
) => resolveTreeKey({ tree, expandedIds, focusedId, event, bindings });

describe("resolveTreeKey - navigation (default bindings)", () => {
  it("should focus the next visible row if the tree-nav-down key fires", () => {
    expect(resolve(keyEvent("ArrowDown"), "f1")).toEqual({
      type: "focus",
      id: "c1",
    });
  });

  it("should focus the previous visible row if the tree-nav-up key fires", () => {
    expect(resolve(keyEvent("ArrowUp"), "c1")).toEqual({
      type: "focus",
      id: "f1",
    });
  });

  it("should be a no-op if ArrowUp on the first visible row", () => {
    expect(resolve(keyEvent("ArrowUp"), "f1")).toEqual({ type: "none" });
  });

  it("should be a no-op if ArrowDown on the last visible row", () => {
    expect(resolve(keyEvent("ArrowDown"), "r1")).toEqual({ type: "none" });
  });

  it("should skip a collapsed folder's children if ArrowDown", () => {
    expect(resolve(keyEvent("ArrowDown"), "f1", collapsed)).toEqual({
      type: "focus",
      id: "f2",
    });
  });
});

describe("resolveTreeKey - activate/toggle (default bindings)", () => {
  it("should activate a request if Enter on a request row", () => {
    expect(resolve(keyEvent("Enter"), "r1")).toEqual({
      type: "activate",
      id: "r1",
    });
  });

  it("should toggle a folder if Enter on a folder row", () => {
    expect(resolve(keyEvent("Enter"), "f1")).toEqual({
      type: "toggle",
      id: "f1",
    });
  });
});

describe("resolveTreeKey - expand/collapse (default bindings)", () => {
  it("should expand a collapsed folder if ArrowRight", () => {
    expect(resolve(keyEvent("ArrowRight"), "f1", collapsed)).toEqual({
      type: "expand",
      id: "f1",
    });
  });

  it("should focus the first child if ArrowRight on an expanded folder", () => {
    expect(resolve(keyEvent("ArrowRight"), "f1", expandedAll)).toEqual({
      type: "focus",
      id: "c1",
    });
  });

  it("should collapse an expanded folder if ArrowLeft", () => {
    expect(resolve(keyEvent("ArrowLeft"), "f1", expandedAll)).toEqual({
      type: "collapse",
      id: "f1",
    });
  });

  it("should focus the parent if ArrowLeft on a child", () => {
    expect(resolve(keyEvent("ArrowLeft"), "c1", expandedAll)).toEqual({
      type: "focus",
      id: "f1",
    });
  });
});

describe("resolveTreeKey - Home/End (default bindings)", () => {
  it("should focus the first visible row if Home", () => {
    expect(resolve(keyEvent("Home"), "r1")).toEqual({
      type: "focus",
      id: "f1",
    });
  });

  it("should focus the last visible row if End", () => {
    expect(resolve(keyEvent("End"), "f1")).toEqual({
      type: "focus",
      id: "r1",
    });
  });
});

describe("resolveTreeKey - shift range extend (default bindings)", () => {
  it("should extend selection to the next row if Shift+ArrowDown", () => {
    expect(resolve(keyEvent("ArrowDown", { shift: true }), "f1")).toEqual({
      type: "extend",
      id: "c1",
    });
  });

  it("should extend selection to the previous row if Shift+ArrowUp", () => {
    expect(resolve(keyEvent("ArrowUp", { shift: true }), "c1")).toEqual({
      type: "extend",
      id: "f1",
    });
  });
});

describe("resolveTreeKey - alt move (default bindings)", () => {
  it("should return a move command if Alt+ArrowDown on a movable row", () => {
    const command = resolve(keyEvent("ArrowDown", { alt: true }), "f1");
    expect(command.type).toBe("move");
    expect(command).toMatchObject({ id: "f1" });
  });

  it("should be a no-op if Alt+ArrowUp on the first sibling", () => {
    expect(resolve(keyEvent("ArrowUp", { alt: true }), "c1")).toEqual({
      type: "none",
    });
  });

  it("should be a no-op if Alt+ArrowLeft on a root node (cannot outdent)", () => {
    expect(resolve(keyEvent("ArrowLeft", { alt: true }), "f1")).toEqual({
      type: "none",
    });
  });

  it("should be a no-op if Alt+ArrowRight with no preceding sibling folder", () => {
    expect(resolve(keyEvent("ArrowRight", { alt: true }), "c1")).toEqual({
      type: "none",
    });
  });
});

describe("resolveTreeKey - modifier leak guard (bug #3)", () => {
  it("should be a no-op if a bare Cmd/Meta+ArrowRight fires (matches no tree binding)", () => {
    expect(
      resolve(keyEvent("ArrowRight", { meta: true }), "f1", collapsed),
    ).toEqual({ type: "none" });
  });

  it("should be a no-op if a bare Ctrl+ArrowDown fires", () => {
    expect(resolve(keyEvent("ArrowDown", { ctrl: true }), "f1")).toEqual({
      type: "none",
    });
  });

  it("should be a no-op if the focused id is not in the tree", () => {
    expect(resolve(keyEvent("ArrowDown"), "ghost")).toEqual({ type: "none" });
  });
});

describe("resolveTreeKey - custom bindings", () => {
  it("should honour a rebound tree-move-up key", () => {
    const custom = resolveShortcuts({ "tree-move-up": ["Mod+Shift+ArrowUp"] });
    // Default Alt+ArrowUp must no longer trigger the move.
    expect(
      resolve(keyEvent("ArrowUp", { alt: true }), "c2", expandedAll, custom),
    ).toEqual({ type: "none" });
    // The custom combo does. The vitest env detects as "windows", so Mod == Ctrl.
    const command = resolve(
      keyEvent("ArrowUp", { shift: true, ctrl: true }),
      "c2",
      expandedAll,
      custom,
    );
    expect(command.type).toBe("move");
    expect(command).toMatchObject({ id: "c2" });
  });

  it("should honour a rebound tree-activate key", () => {
    const custom = resolveShortcuts({ "tree-activate": ["Mod+Enter"] });
    // Bare Enter no longer activates.
    expect(resolve(keyEvent("Enter"), "r1", expandedAll, custom)).toEqual({
      type: "none",
    });
    expect(
      resolve(keyEvent("Enter", { ctrl: true }), "r1", expandedAll, custom),
    ).toEqual({ type: "activate", id: "r1" });
  });

  // E-2 — behavior: a disabled ([]) tree action never fires, and its old default
  // key resolves to none.
  it("should be a no-op for a disabled tree action's former default key", () => {
    const custom = resolveShortcuts({ "tree-nav-down": [] });
    expect(resolve(keyEvent("ArrowDown"), "f1", expandedAll, custom)).toEqual({
      type: "none",
    });
  });

  // AC-002 — behavior: a tree action bound to several keys fires on any of them.
  it("should honour any binding in a multi-binding tree action", () => {
    const custom = resolveShortcuts({
      "tree-nav-down": ["ArrowDown", "Mod+ArrowDown"],
    });
    // The vitest env detects as "windows", so Mod == Ctrl.
    expect(resolve(keyEvent("ArrowDown"), "f1", expandedAll, custom)).toEqual({
      type: "focus",
      id: "c1",
    });
    expect(
      resolve(keyEvent("ArrowDown", { ctrl: true }), "f1", expandedAll, custom),
    ).toEqual({ type: "focus", id: "c1" });
  });
});

describe("treeMoveTarget - direction math", () => {
  it("should target the slot after the next sibling if moving down among siblings", () => {
    expect(treeMoveTarget(tree, "c1", "down")).toEqual({
      parentId: "f1",
      index: 1,
    });
  });

  it("should target the earlier slot if moving up among siblings", () => {
    expect(treeMoveTarget(tree, "c2", "up")).toEqual({
      parentId: "f1",
      index: 0,
    });
  });

  it("should return null if moving up the first sibling", () => {
    expect(treeMoveTarget(tree, "c1", "up")).toBeNull();
  });

  it("should return null if moving down the last sibling", () => {
    expect(treeMoveTarget(tree, "c2", "down")).toBeNull();
  });

  it("should place a node just after its parent in the grandparent if outdenting", () => {
    expect(treeMoveTarget(tree, "c1", "outdent")).toEqual({
      parentId: null,
      index: 1,
    });
  });

  it("should return null if outdenting a root node", () => {
    expect(treeMoveTarget(tree, "r1", "outdent")).toBeNull();
  });

  it("should append into the preceding sibling folder if nesting", () => {
    expect(treeMoveTarget(tree, "r1", "nest")).toEqual({
      parentId: "f2",
      index: 0,
    });
  });

  it("should return null if nesting with no preceding sibling folder", () => {
    expect(treeMoveTarget(tree, "f1", "nest")).toBeNull();
  });

  it("should return null if nesting when the preceding sibling is a request", () => {
    const t: TreeNode[] = [request("a"), request("b")];
    expect(treeMoveTarget(t, "b", "nest")).toBeNull();
  });
});
