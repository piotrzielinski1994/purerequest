import type { TreeNode } from "@/lib/workspace/model";

// Replace a folder's whole env border-color map at once (an empty map drops the
// field so disk-format omits it). Used by the folder Settings JSON editor, which
// edits config + colors together; `setFolderEnvColor`'s per-env write stays for
// the live Env-tab accent picker.
export function setFolderEnvironmentColors(
  tree: TreeNode[],
  folderId: string,
  colors: Record<string, string>,
): TreeNode[] {
  return tree.map((node) => {
    if (node.kind !== "folder") {
      return node;
    }
    if (node.id === folderId) {
      const next = { ...node };
      if (Object.keys(colors).length > 0) {
        next.environmentColors = colors;
      } else {
        delete next.environmentColors;
      }
      return next;
    }
    return {
      ...node,
      children: setFolderEnvironmentColors(node.children, folderId, colors),
    };
  });
}

// Set or clear one env's border color on a folder. A null color removes that
// env's entry; emptying the map drops the field so disk-format omits it.
export function updateFolderEnvColor(
  tree: TreeNode[],
  folderId: string,
  env: string,
  color: string | null,
): TreeNode[] {
  return tree.map((node) => {
    if (node.kind !== "folder") {
      return node;
    }
    if (node.id === folderId) {
      const rest = { ...(node.environmentColors ?? {}) };
      if (color === null) {
        delete rest[env];
      } else {
        rest[env] = color;
      }
      const next = { ...node };
      if (Object.keys(rest).length > 0) {
        next.environmentColors = rest;
      } else {
        delete next.environmentColors;
      }
      return next;
    }
    return {
      ...node,
      children: updateFolderEnvColor(node.children, folderId, env, color),
    };
  });
}
