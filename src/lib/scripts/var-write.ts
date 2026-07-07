import type { Scope } from "@/lib/workspace/resolve";
import { findScopePath } from "@/lib/workspace/resolve";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { findNode } from "@/lib/workspace/tree-edit";
import type { TreeNode } from "@/lib/workspace/model";

// Where a `requi.setVar(name, ...)` write lands: the nearest scope (leaf-first
// along the resolved folder chain) that already defines `name` in its plain
// `config.variables`, else the request's own node. Mirrors resolveConfig's
// nearest-wins fold so a script updates the var "where it logically lives".
export function findVarWriteTarget(
  tree: TreeNode[],
  requestId: string,
  name: string,
): string {
  const path = findScopePath(tree, requestId, []) ?? [];
  const nearest = [...path]
    .reverse()
    .find((scope: Scope) =>
      scope.config.variables?.some((row) => row.key === name),
    );
  return nearest?.id ?? requestId;
}

// Immutable: returns a new tree with `name` set to `value` in the target node's
// `config.variables` rows - updating the row in place if it exists, else appending.
export function setNodeVar(
  tree: TreeNode[],
  nodeId: string,
  name: string,
  value: string,
): TreeNode[] {
  const node = findNode(tree, nodeId);
  if (!node) {
    return tree;
  }
  const rows = node.config.variables ?? [];
  const variables = rows.some((row) => row.key === name)
    ? rows.map((row) => (row.key === name ? { ...row, value } : row))
    : [...rows, { key: name, value }];
  return updateNodeConfig(tree, nodeId, { ...node.config, variables });
}
