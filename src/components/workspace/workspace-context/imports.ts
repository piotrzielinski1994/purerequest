import { toast } from "sonner";
import type { PersistApi } from "@/components/workspace/workspace-context/persist";
import type { SelectionApi } from "@/components/workspace/workspace-context/selection";
import type { TreeCrudApi } from "@/components/workspace/workspace-context/tree-crud";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";
import {
  type BrunoFileMap,
  brunoToTree,
  collectDotenv,
} from "@/lib/bruno/bruno-to-tree";
import { type CurlParseResult, parseCurl } from "@/lib/curl/parse-curl";
import { openapiToTree } from "@/lib/openapi/openapi-to-tree";
import {
  type PostmanFileMap,
  postmanToTree,
} from "@/lib/postman/postman-to-tree";
import { mergeDotenv } from "@/lib/workspace/environment";
import { insertNode } from "@/lib/workspace/tree-edit";

export type ImportsApi = {
  importCurl: (text: string) => CurlParseResult;
  importBruno: (files: BrunoFileMap, name: string) => void;
  importPostman: (files: PostmanFileMap, name: string) => void;
  importOpenapi: (text: string, name: string) => void;
  openCurlImport: () => void;
  closeCurlImport: () => void;
};

export function createImports(
  internals: WorkspaceInternals,
  deps: {
    persistTree: PersistApi["persistTree"];
    saveEnv: PersistApi["saveEnv"];
    createRequestNode: TreeCrudApi["createRequestNode"];
    selectSingle: SelectionApi["selectSingle"];
  },
): ImportsApi {
  const {
    tree,
    envText,
    nodeCounter,
    setIsCurlImportOpen,
    setExpandedFolderIds,
    setIsEditorActive,
  } = internals;
  const { persistTree, saveEnv, createRequestNode, selectSingle } = deps;

  const openCurlImport = () => setIsCurlImportOpen(true);
  const closeCurlImport = () => setIsCurlImportOpen(false);

  const importCurl = (text: string): CurlParseResult => {
    const result = parseCurl(text);
    if (!result.ok) {
      return result;
    }
    const { method, url, headers, body, auth } = result.request;
    createRequestNode(
      {
        name: url.trim() || "Imported Request",
        method,
        url,
        body: {
          active: "json",
          types: {
            json: body ?? "",
            form: [],
            multipart: [],
            graphql: { query: "", variables: "" },
          },
        },
        config: {
          ...(headers.length > 0 ? { headers } : {}),
          ...(auth ? { auth } : {}),
        },
      },
      { mode: "persist" },
    );
    setIsCurlImportOpen(false);
    toast("Imported request");
    return result;
  };

  const importBruno = (files: BrunoFileMap, name: string) => {
    const [root] = brunoToTree(files, name);
    if (root?.kind !== "folder" || root.children.length === 0) {
      return;
    }
    nodeCounter.current += 1;
    const folder = { ...root, id: `new-${nodeCounter.current}` };
    setExpandedFolderIds((current) => new Set(current).add(folder.id));
    setIsEditorActive(false);
    selectSingle(folder.id);
    persistTree(insertNode(tree, null, tree.length, folder), "import");
    toast("Imported Bruno collection");
  };

  const importPostman = (files: PostmanFileMap, name: string) => {
    const [root] = postmanToTree(files, name);
    if (root?.kind !== "folder" || root.children.length === 0) {
      return;
    }
    nodeCounter.current += 1;
    const folder = { ...root, id: `new-${nodeCounter.current}` };
    setExpandedFolderIds((current) => new Set(current).add(folder.id));
    setIsEditorActive(false);
    selectSingle(folder.id);
    persistTree(insertNode(tree, null, tree.length, folder), "import");
    const collectionEnv = collectDotenv(files);
    if (collectionEnv.trim() !== "") {
      saveEnv(mergeDotenv(envText, collectionEnv));
    }
    toast("Imported Postman collection");
  };

  const importOpenapi = (text: string, name: string) => {
    const [root] = openapiToTree(text, name);
    if (root?.kind !== "folder" || root.children.length === 0) {
      toast("No importable operations in OpenAPI document");
      return;
    }
    nodeCounter.current += 1;
    const folder = { ...root, id: `new-${nodeCounter.current}` };
    setExpandedFolderIds((current) => new Set(current).add(folder.id));
    setIsEditorActive(false);
    selectSingle(folder.id);
    persistTree(insertNode(tree, null, tree.length, folder), "import");
    toast("Imported OpenAPI document");
  };

  return {
    importCurl,
    importBruno,
    importPostman,
    importOpenapi,
    openCurlImport,
    closeCurlImport,
  };
}
