import type { TreeNode } from "@/lib/workspace/model";
import {
  containsId,
  findNode,
  insertNode,
  removeNode,
} from "@/lib/workspace/tree-edit";
import { locateNode } from "@/lib/workspace/tree-locate";

export type MoveTarget = { parentId: string | null; index: number };

export function moveNode(
  tree: TreeNode[],
  dragId: string,
  target: MoveTarget,
): TreeNode[] {
  const dragged = findNode(tree, dragId);
  if (!dragged) {
    return tree;
  }
  if (target.parentId !== null) {
    const parent = findNode(tree, target.parentId);
    if (!parent || parent.kind !== "folder") {
      return tree;
    }
    if (containsId(dragged, target.parentId)) {
      return tree;
    }
  }
  const without = removeNode(tree, dragId);
  return insertNode(without, target.parentId, target.index, dragged);
}

// The selectable nodes in `dragIds` reduced to the ones to actually move: a node
// whose ancestor is also dragged is dropped (it rides along inside that
// ancestor), and unknown ids are dropped. Returned in tree document order, so a
// multi-drop preserves the on-screen ordering of the selection.
function movableInOrder(tree: TreeNode[], dragIds: string[]): TreeNode[] {
  const dragSet = new Set(dragIds.filter((id) => findNode(tree, id) !== null));
  const roots = [...dragSet].filter((id) => {
    const ancestorAlsoDragged = [...dragSet].some((other) => {
      if (other === id) {
        return false;
      }
      const otherNode = findNode(tree, other);
      return otherNode !== null && containsId(otherNode, id);
    });
    return !ancestorAlsoDragged;
  });
  const rootSet = new Set(roots);
  const collected: TreeNode[] = [];
  const walk = (nodes: TreeNode[]) => {
    for (const node of nodes) {
      if (rootSet.has(node.id)) {
        collected.push(node);
        continue;
      }
      if (node.kind === "folder") {
        walk(node.children);
      }
    }
  };
  walk(tree);
  return collected;
}

// Move a SET of nodes (a sidebar multi-selection) in one drop. `target.index` is
// the RAW slot in the destination parent's ORIGINAL children; this compensates
// for any dragged siblings removed from that parent before the insertion point,
// then inserts the moved nodes contiguously in document order.
export function moveNodes(
  tree: TreeNode[],
  dragIds: string[],
  target: MoveTarget,
): TreeNode[] {
  const moved = movableInOrder(tree, dragIds);
  if (moved.length === 0) {
    return tree;
  }
  if (target.parentId !== null) {
    const parent = findNode(tree, target.parentId);
    if (!parent || parent.kind !== "folder") {
      return tree;
    }
    // Reject dropping into any dragged folder (its own subtree) - a cycle.
    if (moved.some((node) => containsId(node, target.parentId as string))) {
      return tree;
    }
  }
  const removedBeforeIndex = moved.filter((node) => {
    const location = locateNode(tree, node.id);
    return (
      location !== null &&
      location.parentId === target.parentId &&
      location.index < target.index
    );
  }).length;
  const baseIndex = target.index - removedBeforeIndex;
  const without = moved.reduce((acc, node) => removeNode(acc, node.id), tree);
  return moved.reduce(
    (acc, node, offset) =>
      insertNode(acc, target.parentId, baseIndex + offset, node),
    without,
  );
}
