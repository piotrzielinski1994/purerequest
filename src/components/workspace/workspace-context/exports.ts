import { findNode } from "@/lib/workspace/tree-locate";
import { treeToBrunoFiles, type BrunoExportRoot } from "@/lib/bruno/tree-to-bruno";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";

export type ExportsApi = {
  exportBruno: (nodeId?: string) => void;
};

export function createExports(internals: WorkspaceInternals): ExportsApi {
  const { tree, workspaceName, brunoWriterRef, showToastRef } = internals;

  const rootFor = (nodeId: string | undefined): BrunoExportRoot => {
    const node = nodeId !== undefined ? findNode(tree, nodeId) : null;
    if (node && node.kind === "folder") {
      return {
        name: node.name,
        config: node.config,
        ...(node.dotenv !== undefined ? { dotenv: node.dotenv } : {}),
        children: node.children,
      };
    }
    return { name: workspaceName, config: {}, children: tree };
  };

  const exportBruno = (nodeId?: string) => {
    const root = rootFor(nodeId);
    brunoWriterRef.current
      .save(treeToBrunoFiles(root), root.name)
      .then((saved) => {
        if (saved) {
          showToastRef.current("Exported Bruno collection");
        }
      })
      .catch(() => {
        showToastRef.current("Failed to export Bruno collection");
      });
  };

  return { exportBruno };
}
