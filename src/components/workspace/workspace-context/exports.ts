import { toast } from "sonner";
import { findNode } from "@/lib/workspace/tree-locate";
import { slugify } from "@/lib/workspace/slug";
import {
  treeToBrunoFiles,
  type BrunoExportRoot,
} from "@/lib/bruno/tree-to-bruno";
import {
  treeToPostmanFiles,
  type PostmanExportRoot,
} from "@/lib/postman/tree-to-postman";
import {
  treeToOpenapiDoc,
  type OpenapiExportRoot,
} from "@/lib/openapi/tree-to-openapi";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";

export type ExportsApi = {
  exportBruno: (nodeId?: string) => void;
  exportPostman: (nodeId?: string) => void;
  exportOpenapi: (nodeId?: string) => void;
};

export function createExports(internals: WorkspaceInternals): ExportsApi {
  const {
    tree,
    workspaceName,
    brunoWriterRef,
    postmanWriterRef,
    openapiWriterRef,
  } = internals;

  const brunoRootFor = (nodeId: string | undefined): BrunoExportRoot => {
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

  const postmanRootFor = (nodeId: string | undefined): PostmanExportRoot => {
    const node = nodeId !== undefined ? findNode(tree, nodeId) : null;
    if (node && node.kind === "folder") {
      return { name: node.name, config: node.config, children: node.children };
    }
    return { name: workspaceName, config: {}, children: tree };
  };

  const openapiRootFor = (nodeId: string | undefined): OpenapiExportRoot => {
    const node = nodeId !== undefined ? findNode(tree, nodeId) : null;
    if (node && node.kind === "folder") {
      return { name: node.name, config: node.config, children: node.children };
    }
    return { name: workspaceName, config: {}, children: tree };
  };

  const exportBruno = (nodeId?: string) => {
    const root = brunoRootFor(nodeId);
    brunoWriterRef.current
      .save(treeToBrunoFiles(root), root.name)
      .then((saved) => {
        if (saved) {
          toast("Exported Bruno collection");
        }
      })
      .catch(() => {
        toast("Failed to export Bruno collection");
      });
  };

  const exportPostman = (nodeId?: string) => {
    const root = postmanRootFor(nodeId);
    postmanWriterRef.current
      .save(treeToPostmanFiles(root), root.name)
      .then((saved) => {
        if (saved) {
          toast("Exported Postman collection");
        }
      })
      .catch(() => {
        toast("Failed to export Postman collection");
      });
  };

  const exportOpenapi = (nodeId?: string) => {
    const root = openapiRootFor(nodeId);
    const files = {
      [`${slugify(root.name)}.openapi.json`]: JSON.stringify(
        treeToOpenapiDoc(root),
        null,
        2,
      ),
    };
    openapiWriterRef.current
      .save(files, root.name)
      .then((saved) => {
        if (saved) {
          toast("Exported OpenAPI document");
        }
      })
      .catch(() => {
        toast("Failed to export OpenAPI document");
      });
  };

  return { exportBruno, exportPostman, exportOpenapi };
}
