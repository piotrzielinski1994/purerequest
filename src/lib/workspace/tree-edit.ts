import type { RequestNode, TreeNode } from "@/lib/workspace/model";

export function containsId(node: TreeNode, id: string): boolean {
  if (node.id === id) {
    return true;
  }
  if (node.kind === "folder") {
    return node.children.some((child) => containsId(child, id));
  }
  return false;
}

export function removeNode(nodes: TreeNode[], id: string): TreeNode[] {
  return nodes.flatMap<TreeNode>((node) => {
    if (node.id === id) {
      return [];
    }
    if (node.kind === "folder") {
      return [{ ...node, children: removeNode(node.children, id) }];
    }
    return [node];
  });
}

export function insertNode(
  nodes: TreeNode[],
  parentId: string | null,
  index: number,
  toInsert: TreeNode,
): TreeNode[] {
  if (parentId === null) {
    const at = Math.max(0, Math.min(index, nodes.length));
    return [...nodes.slice(0, at), toInsert, ...nodes.slice(at)];
  }
  return nodes.map((node) => {
    if (node.kind !== "folder") {
      return node;
    }
    if (node.id === parentId) {
      const at = Math.max(0, Math.min(index, node.children.length));
      return {
        ...node,
        children: [
          ...node.children.slice(0, at),
          toInsert,
          ...node.children.slice(at),
        ],
      };
    }
    return {
      ...node,
      children: insertNode(node.children, parentId, index, toInsert),
    };
  });
}

export function renameNode(
  nodes: TreeNode[],
  id: string,
  name: string,
): TreeNode[] {
  if (name.trim() === "") {
    return nodes;
  }
  return nodes.map((node) => {
    if (node.id === id) {
      return { ...node, name };
    }
    if (node.kind === "folder") {
      return { ...node, children: renameNode(node.children, id, name) };
    }
    return node;
  });
}

export function duplicateRequest(
  nodes: TreeNode[],
  id: string,
  newId: string,
): TreeNode[] {
  let done = false;
  const recurse = (level: TreeNode[]): TreeNode[] =>
    level.flatMap<TreeNode>((node) => {
      if (!done && node.id === id && node.kind === "request") {
        done = true;
        const copy: RequestNode = {
          ...structuredClone(node),
          id: newId,
          name: `${node.name} copy`,
        };
        return [node, copy];
      }
      if (node.kind === "folder") {
        return [{ ...node, children: recurse(node.children) }];
      }
      return [node];
    });
  return recurse(nodes);
}

export function collectRequestIds(node: TreeNode): string[] {
  if (node.kind === "request") {
    return [node.id];
  }
  return node.children.flatMap(collectRequestIds);
}

export function countDescendants(node: TreeNode): number {
  if (node.kind === "request") {
    return 0;
  }
  return node.children.reduce(
    (total, child) => total + 1 + countDescendants(child),
    0,
  );
}
