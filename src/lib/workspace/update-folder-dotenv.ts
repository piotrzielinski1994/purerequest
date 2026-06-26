import type { TreeNode } from "@/lib/workspace/model";

export function updateFolderDotenv(
  tree: TreeNode[],
  id: string,
  dotenv: string,
): TreeNode[] {
  return tree.map((node) => {
    if (node.kind !== "folder") {
      return node;
    }
    if (node.id === id) {
      return { ...node, dotenv };
    }
    return { ...node, children: updateFolderDotenv(node.children, id, dotenv) };
  });
}
