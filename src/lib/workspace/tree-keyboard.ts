import { matchesKeyboardEvent, type Hotkey } from "@tanstack/hotkeys";
import type { TreeNode } from "@/lib/workspace/model";
import type { MoveTarget } from "@/lib/workspace/move";
import type { ShortcutActionId } from "@/lib/shortcuts/registry";
import { findNode, locateNode } from "@/lib/workspace/tree-locate";
import { flattenSelectable } from "@/lib/workspace/tree-select";

export type TreeKeyCommand =
  | { type: "focus"; id: string }
  | { type: "activate"; id: string }
  | { type: "toggle"; id: string }
  | { type: "expand"; id: string }
  | { type: "collapse"; id: string }
  | { type: "extend"; id: string }
  | { type: "move"; id: string; target: MoveTarget }
  | { type: "none" };

export type TreeMoveDirection = "up" | "down" | "outdent" | "nest";

// The effective bindings for each tree action (from resolveShortcuts). Only the
// tree-scoped ids are read here; the map may carry every action. Each action
// maps to a LIST of hotkeys (empty = disabled).
export type TreeBindings = Partial<Record<ShortcutActionId, string[]>>;

const NONE: TreeKeyCommand = { type: "none" };

function childrenOf(tree: TreeNode[], parentId: string | null): TreeNode[] {
  if (parentId === null) {
    return tree;
  }
  const parent = findNode(tree, parentId);
  return parent && parent.kind === "folder" ? parent.children : [];
}

// The MoveTarget for a reorder, expressed in `moveNode`'s post-removal index
// basis (it removes the node first, then inserts at target.index). Returns null
// when the move is impossible (no sibling / already root / no preceding folder).
export function treeMoveTarget(
  tree: TreeNode[],
  id: string,
  direction: TreeMoveDirection,
): MoveTarget | null {
  const location = locateNode(tree, id);
  if (!location) {
    return null;
  }
  const siblings = childrenOf(tree, location.parentId);

  if (direction === "up") {
    if (location.index === 0) {
      return null;
    }
    return { parentId: location.parentId, index: location.index - 1 };
  }

  if (direction === "down") {
    if (location.index >= siblings.length - 1) {
      return null;
    }
    return { parentId: location.parentId, index: location.index + 1 };
  }

  if (direction === "outdent") {
    if (location.parentId === null) {
      return null;
    }
    const parentLocation = locateNode(tree, location.parentId);
    if (!parentLocation) {
      return null;
    }
    return {
      parentId: parentLocation.parentId,
      index: parentLocation.index + 1,
    };
  }

  // nest: append into the immediately-preceding sibling, which must be a folder.
  const preceding = siblings[location.index - 1];
  if (!preceding || preceding.kind !== "folder") {
    return null;
  }
  return { parentId: preceding.id, index: preceding.children.length };
}

// The tree actions, in resolution priority. A reorder (Alt+*) is checked before
// plain nav so that even if a user binds overlapping keys the move wins; in
// practice findConflict keeps bindings distinct.
const TREE_ACTION_ORDER: ShortcutActionId[] = [
  "tree-move-up",
  "tree-move-down",
  "tree-outdent",
  "tree-nest",
  "tree-extend-up",
  "tree-extend-down",
  "tree-nav-up",
  "tree-nav-down",
  "tree-nav-first",
  "tree-nav-last",
  "tree-activate",
  "tree-expand",
  "tree-collapse",
];

function commandFor(
  action: ShortcutActionId,
  tree: TreeNode[],
  expandedIds: Set<string>,
  focusedId: string,
  node: TreeNode,
): TreeKeyCommand {
  const visible = flattenSelectable(tree, expandedIds);
  const index = visible.indexOf(focusedId);

  if (action === "tree-move-up") {
    const target = treeMoveTarget(tree, focusedId, "up");
    return target ? { type: "move", id: focusedId, target } : NONE;
  }
  if (action === "tree-move-down") {
    const target = treeMoveTarget(tree, focusedId, "down");
    return target ? { type: "move", id: focusedId, target } : NONE;
  }
  if (action === "tree-outdent") {
    const target = treeMoveTarget(tree, focusedId, "outdent");
    return target ? { type: "move", id: focusedId, target } : NONE;
  }
  if (action === "tree-nest") {
    const target = treeMoveTarget(tree, focusedId, "nest");
    return target ? { type: "move", id: focusedId, target } : NONE;
  }
  if (action === "tree-extend-down") {
    const next = visible[index + 1];
    return next ? { type: "extend", id: next } : NONE;
  }
  if (action === "tree-extend-up") {
    const prev = index > 0 ? visible[index - 1] : undefined;
    return prev ? { type: "extend", id: prev } : NONE;
  }
  if (action === "tree-nav-down") {
    const next = visible[index + 1];
    return next ? { type: "focus", id: next } : NONE;
  }
  if (action === "tree-nav-up") {
    const prev = index > 0 ? visible[index - 1] : undefined;
    return prev ? { type: "focus", id: prev } : NONE;
  }
  if (action === "tree-nav-first") {
    const first = visible[0];
    return first ? { type: "focus", id: first } : NONE;
  }
  if (action === "tree-nav-last") {
    const last = visible[visible.length - 1];
    return last ? { type: "focus", id: last } : NONE;
  }
  if (action === "tree-activate") {
    return node.kind === "folder"
      ? { type: "toggle", id: focusedId }
      : { type: "activate", id: focusedId };
  }
  if (action === "tree-expand") {
    if (node.kind !== "folder") {
      return NONE;
    }
    if (!expandedIds.has(focusedId)) {
      return { type: "expand", id: focusedId };
    }
    const firstChild = node.children[0];
    return firstChild ? { type: "focus", id: firstChild.id } : NONE;
  }
  if (action === "tree-collapse") {
    if (node.kind === "folder" && expandedIds.has(focusedId)) {
      return { type: "collapse", id: focusedId };
    }
    const parentId = locateNode(tree, focusedId)?.parentId ?? null;
    return parentId ? { type: "focus", id: parentId } : NONE;
  }
  return NONE;
}

// Resolve a tree-row keydown into a command by matching the event against the
// user's effective bindings (not hardcoded keys), so every tree shortcut is
// reconfigurable. An event that matches no tree binding - including a stray
// modifier combo like a bare Cmd/Ctrl+Arrow - resolves to `none`.
export function resolveTreeKey(input: {
  tree: TreeNode[];
  expandedIds: Set<string>;
  focusedId: string;
  event: KeyboardEvent;
  bindings: TreeBindings;
}): TreeKeyCommand {
  const { tree, expandedIds, focusedId, event, bindings } = input;
  const node = findNode(tree, focusedId);
  if (!node) {
    return NONE;
  }
  const action = TREE_ACTION_ORDER.find((id) => {
    const actionBindings = bindings[id];
    return (
      Array.isArray(actionBindings) &&
      actionBindings.some((binding) =>
        matchesKeyboardEvent(event, binding as Hotkey),
      )
    );
  });
  if (!action) {
    return NONE;
  }
  return commandFor(action, tree, expandedIds, focusedId, node);
}
