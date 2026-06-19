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

// An empty folder has no child rows to drop near, so during a drag it renders
// a dedicated child-area drop zone with this id. Hovering it always means
// "drop inside the folder", giving a large, reliable target.
const EMPTY_ZONE_PREFIX = "empty-zone:";

export function emptyZoneId(folderId: string): string {
  return `${EMPTY_ZONE_PREFIX}${folderId}`;
}

export function parseEmptyZoneId(id: string): string | null {
  return id.startsWith(EMPTY_ZONE_PREFIX)
    ? id.slice(EMPTY_ZONE_PREFIX.length)
    : null;
}

// Pointer-relative drop projection.
// - Request row: top half = before, bottom half = after (reorder).
// - Expanded folder row: only a thin top strip = before (reorder above it);
//   the rest = inside. "After an open folder" visually IS its children area,
//   so the whole non-top row reliably reparents - no narrow middle band.
// - Collapsed folder row: top/bottom quarters reorder, middle 50% = inside.
export function projectDropPosition({
  pointerY,
  rectTop,
  rectHeight,
  isOverFolder,
  isExpandedFolder = false,
}: {
  pointerY: number;
  rectTop: number;
  rectHeight: number;
  isOverFolder: boolean;
  isExpandedFolder?: boolean;
}): DropPosition {
  if (rectHeight <= 0) {
    return "before";
  }
  const fraction = (pointerY - rectTop) / rectHeight;
  if (isOverFolder) {
    if (isExpandedFolder) {
      return fraction < 0.3 ? "before" : "inside";
    }
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
  const emptyZoneFolderId = parseEmptyZoneId(overId);
  if (emptyZoneFolderId !== null) {
    const folder = findNode(tree, emptyZoneFolderId);
    if (!folder || folder.kind !== "folder") {
      return null;
    }
    return { parentId: emptyZoneFolderId, index: folder.children.length };
  }
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
