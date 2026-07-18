import type { Scope } from "@/lib/workspace/resolve";
import { findScopePath } from "@/lib/workspace/resolve";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { findNode } from "@/lib/workspace/tree-locate";
import { upsertRow } from "@/lib/workspace/model";
import type { TreeNode } from "@/lib/workspace/model";

// Where a `purerequest.setVar(name, ...)` write lands: the nearest scope (leaf-first
// along the resolved folder chain) that already defines `name` in its plain
// `config.variables`, else the request's own node. Mirrors resolveConfig's
// nearest-wins fold so a script updates the var "where it logically lives".
export function findVarWriteTarget(
  tree: TreeNode[],
  requestId: string,
  name: string,
): string {
  const path = findScopePath(tree, requestId, []) ?? [];
  const nearest = nearestDefiningScope(path, name);
  return nearest?.id ?? requestId;
}

function nearestDefiningScope(path: Scope[], name: string): Scope | undefined {
  return [...path]
    .reverse()
    .find((scope) => scope.config.variables?.some((row) => row.key === name));
}

const PURE_PROCESS_ENV_REF = /^\s*\{\{\s*process\.env\.([^}\s]+)\s*\}\}\s*$/;

// The `KEY` iff `value` is a single, pure `{{process.env.KEY}}` reference (only
// whitespace around it) - the pointer-to-`.env` shape. Anything embedded, a
// second token, or a non-`process.env.` token returns null. Mirrors the
// `process.env.` lookup in `interpolate.ts` so detection matches resolution.
export function processEnvRefKey(value: string): string | null {
  return PURE_PROCESS_ENV_REF.exec(value)?.[1] ?? null;
}

// Where a `setVar` actually persists, following one hop of indirection: if the
// nearest scope defining `name` holds a pure `{{process.env.KEY}}` pointer, the
// write targets that `.env` key (leaving the pointer row untouched); otherwise
// it overwrites the `config.variables` row at `findVarWriteTarget`'s node.
export type VarWriteTarget =
  | { kind: "config"; nodeId: string }
  | { kind: "dotenv"; key: string };

export function resolveVarWriteTarget(
  tree: TreeNode[],
  requestId: string,
  name: string,
): VarWriteTarget {
  const path = findScopePath(tree, requestId, []) ?? [];
  const nearest = nearestDefiningScope(path, name);
  const rowValue = nearest?.config.variables?.find(
    (row) => row.key === name,
  )?.value;
  const key = rowValue === undefined ? null : processEnvRefKey(rowValue);
  if (key !== null) {
    return { kind: "dotenv", key };
  }
  return { kind: "config", nodeId: nearest?.id ?? requestId };
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
  const variables = upsertRow(node.config.variables ?? [], name, value);
  return updateNodeConfig(tree, nodeId, { ...node.config, variables });
}
