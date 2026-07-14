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

// The folder-id chain from the root down to (not including) the node's parent's
// own id - i.e. every ancestor folder of `id`, root-first. `[]` for a root node
// or an unknown id. Used to expand exactly the folders needed to reveal a node.
export function ancestorIds(nodes: TreeNode[], id: string): string[] {
  const walk = (current: TreeNode[], path: string[]): string[] | null => {
    for (const node of current) {
      if (node.id === id) {
        return path;
      }
      if (node.kind === "folder") {
        const found = walk(node.children, [...path, node.id]);
        if (found) {
          return found;
        }
      }
    }
    return null;
  };
  return walk(nodes, []) ?? [];
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

// The empty area below the last row. Dropping there moves the node to the END of
// the workspace root - a reliable escape hatch when every folder is collapsed and
// there is no root row to drop between.
export const ROOT_ZONE_ID = "root-zone";

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

// The drop target as a RAW slot in the over-row's parent's ORIGINAL children -
// no compensation for the dragged node's own removal. `moveNodes` wants this raw
// form (it does its own multi-node compensation); `dropTarget` layers the
// single-node shift on top.
export function rawDropTarget(
  tree: TreeNode[],
  overId: string,
  position: DropPosition,
): MoveTarget | null {
  if (overId === ROOT_ZONE_ID) {
    return { parentId: null, index: tree.length };
  }
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
  const index = position === "before" ? location.index : location.index + 1;
  return { parentId: location.parentId, index };
}

export function dropTarget(
  tree: TreeNode[],
  dragId: string,
  overId: string,
  position: DropPosition,
): MoveTarget | null {
  const raw = rawDropTarget(tree, overId, position);
  if (!raw || position === "inside" || parseEmptyZoneId(overId) !== null) {
    return raw;
  }
  const dragLocation = locateNode(tree, dragId);
  // moveNode evaluates index AFTER removing the dragged node; if it shared the
  // target parent and sat before the drop point, that removal shifts it down 1.
  const isSameParent =
    dragLocation !== null && dragLocation.parentId === raw.parentId;
  const index =
    isSameParent && dragLocation.index < raw.index ? raw.index - 1 : raw.index;
  return { parentId: raw.parentId, index };
}
