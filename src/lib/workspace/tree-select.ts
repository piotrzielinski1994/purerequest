import type { TreeNode } from "@/lib/workspace/model";

// The selectable rows (folders + requests) in visible DFS order: a folder's
// children are listed only when the folder is expanded. This order is what
// shift-click ranges over.
export function flattenSelectable(
  nodes: TreeNode[],
  expandedIds: Set<string>,
): string[] {
  return nodes.flatMap((node) => {
    if (node.kind === "folder") {
      const children = expandedIds.has(node.id)
        ? flattenSelectable(node.children, expandedIds)
        : [];
      return [node.id, ...children];
    }
    return [node.id];
  });
}

// Every folder id in the tree at any depth (requests excluded), independent of
// expand state - drives expand-all (add them all) and collapse-all (the tree
// clears its expanded set to empty, so this is only needed for expand).
export function allFolderIds(nodes: TreeNode[]): string[] {
  return nodes.flatMap((node) =>
    node.kind === "folder"
      ? [node.id, ...allFolderIds(node.children)]
      : [],
  );
}

// The inclusive range of ids between `anchor` and `target` in the visible order,
// direction-independent. Falls back to just `target` if either endpoint is not
// visible (e.g. a stale anchor inside a since-collapsed folder).
export function rangeBetween(
  ordered: string[],
  anchor: string,
  target: string,
): string[] {
  const anchorIndex = ordered.indexOf(anchor);
  const targetIndex = ordered.indexOf(target);
  if (anchorIndex === -1 || targetIndex === -1) {
    return [target];
  }
  const start = Math.min(anchorIndex, targetIndex);
  const end = Math.max(anchorIndex, targetIndex);
  return ordered.slice(start, end + 1);
}
