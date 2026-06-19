import type { TreeNode } from "@/lib/workspace/model";
import type { MoveTarget } from "@/lib/workspace/move";

export type NodeLocation = { parentId: string | null; index: number };

export function locateNode(
  nodes: TreeNode[],
  id: string,
  parentId: string | null = null,
): NodeLocation | null {
  const index = nodes.findIndex((node) => node.id === id);
  if (index !== -1) {
    return { parentId, index };
  }
  for (const node of nodes) {
    if (node.kind === "folder") {
      const found = locateNode(node.children, id, node.id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export function findNode(nodes: TreeNode[], id: string): TreeNode | null {
  for (const node of nodes) {
    if (node.id === id) {
      return node;
    }
    if (node.kind === "folder") {
      const found = findNode(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
}

export type DropPosition = "before" | "after" | "inside";

// Pointer-relative drop projection. For a folder the middle 50% reparents
// (drop inside), so even an empty/collapsed folder has a large, reliable
// target; the top/bottom 25% reorder around it. A request splits 50/50.
export function projectDropPosition({
  pointerY,
  rectTop,
  rectHeight,
  isOverFolder,
}: {
  pointerY: number;
  rectTop: number;
  rectHeight: number;
  isOverFolder: boolean;
}): DropPosition {
  if (rectHeight <= 0) {
    return "before";
  }
  const fraction = (pointerY - rectTop) / rectHeight;
  if (isOverFolder) {
    if (fraction < 0.25) {
      return "before";
    }
    if (fraction > 0.75) {
      return "after";
    }
    return "inside";
  }
  return fraction < 0.5 ? "before" : "after";
}

export function dropTarget(
  tree: TreeNode[],
  dragId: string,
  overId: string,
  position: DropPosition,
): MoveTarget | null {
  if (position === "inside") {
    const over = findNode(tree, overId);
    if (!over || over.kind !== "folder") {
      return null;
    }
    return { parentId: overId, index: over.children.length };
  }
  const location = locateNode(tree, overId);
  if (!location) {
    return null;
  }
  const dragLocation = locateNode(tree, dragId);
  const rawIndex =
    position === "before" ? location.index : location.index + 1;
  // moveNode evaluates index AFTER removing the dragged node; if it shared the
  // target parent and sat before the drop point, that removal shifts it down 1.
  const isSameParent =
    dragLocation !== null && dragLocation.parentId === location.parentId;
  const index =
    isSameParent && dragLocation.index < rawIndex ? rawIndex - 1 : rawIndex;
  return { parentId: location.parentId, index };
}
