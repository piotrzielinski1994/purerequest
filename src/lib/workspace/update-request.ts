import type { RequestNode, TreeNode } from "@/lib/workspace/model";

export type RequestPatch = Partial<
  Pick<RequestNode, "name" | "url" | "method" | "body" | "config">
>;

export function updateRequest(
  tree: TreeNode[],
  id: string,
  patch: RequestPatch,
): TreeNode[] {
  return tree.map((node) => {
    if (node.kind === "folder") {
      if (node.id === id) {
        return node;
      }
      return { ...node, children: updateRequest(node.children, id, patch) };
    }
    if (node.id === id) {
      return { ...node, ...patch };
    }
    return node;
  });
}
