import type { PersistApi } from "@/components/workspace/workspace-context/persist";
import type { SelectionApi } from "@/components/workspace/workspace-context/selection";
import type { TabsApi } from "@/components/workspace/workspace-context/tabs";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { MoveTarget } from "@/lib/workspace/move";
import {
  moveNode as applyMove,
  moveNodes as applyMoveNodes,
} from "@/lib/workspace/move";
import { untitledName } from "@/lib/workspace/request-name";
import {
  duplicateNode as applyDuplicate,
  collectRequestIds,
  containsId,
  insertNode,
  removeNode,
  renameNode,
} from "@/lib/workspace/tree-edit";
import { findNode, locateNode } from "@/lib/workspace/tree-locate";

type CreateRequestNodeOptions = {
  target?: MoveTarget;
  autoName?: boolean;
  mode: "draft" | "persist";
};

export type TreeCrudApi = {
  derivePlacement: (target?: MoveTarget) => MoveTarget;
  createRequestNode: (
    partial: Pick<RequestNode, "name" | "method" | "url"> &
      Partial<RequestNode>,
    options: CreateRequestNodeOptions,
  ) => void;
  newRequest: (target?: MoveTarget) => void;
  newFolder: (target?: MoveTarget) => void;
  duplicateNode: (id: string) => void;
  beginRename: (id: string) => void;
  commitRename: (id: string, name: string) => void;
  cancelRename: () => void;
  requestDeleteNode: (id: string) => void;
  confirmPendingDelete: () => void;
  cancelPendingDelete: () => void;
  moveNode: (dragId: string, target: MoveTarget) => void;
  moveNodes: (dragIds: string[], target: MoveTarget) => void;
};

export function createTreeCrud(
  internals: WorkspaceInternals,
  deps: {
    persistTree: PersistApi["persistTree"];
    selectSingle: SelectionApi["selectSingle"];
    closeRequest: TabsApi["closeRequest"];
  },
): TreeCrudApi {
  const {
    tree,
    requestsById,
    draftRequests,
    selectedNodeId,
    selectedIds,
    renamingNodeId,
    pendingDelete,
    nodeCounter,
    autoNameIds,
    onTreeChangeRef,
    setTree,
    setConsoleLines,
    setExpandedFolderIds,
    setOpenRequestIds,
    setActiveRequestId,
    setIsEditorActive,
    setRenamingNodeId,
    setDraftRequests,
    setRequestOverrides,
    setPendingDelete,
  } = internals;
  const { persistTree, selectSingle, closeRequest } = deps;

  // Placement for a new node: an explicit target wins; else inside a selected
  // folder (appended), else as the next sibling of a selected request, else
  // at workspace root (appended).
  const derivePlacement = (target?: MoveTarget): MoveTarget => {
    if (target) {
      return target;
    }
    const selected =
      selectedNodeId !== null ? findNode(tree, selectedNodeId) : null;
    if (selected?.kind === "folder") {
      return { parentId: selected.id, index: selected.children.length };
    }
    if (selected?.kind === "request") {
      const location = locateNode(tree, selected.id);
      if (location) {
        return { parentId: location.parentId, index: location.index + 1 };
      }
    }
    return { parentId: null, index: tree.length };
  };

  // Create a request node and open its tab. `mode: "draft"` keeps it in memory
  // only (a "+"/new-request tab that is not written to disk until edited AND
  // saved); `mode: "persist"` writes it to the tree immediately (curl import,
  // which arrives fully formed). `autoName` keeps the name tracking the URL and
  // focuses the URL input (the new-request flow).
  const createRequestNode = (
    partial: Pick<RequestNode, "name" | "method" | "url"> &
      Partial<RequestNode>,
    options: CreateRequestNodeOptions,
  ) => {
    nodeCounter.current += 1;
    const id = `new-${nodeCounter.current}`;
    const request: RequestNode = {
      kind: "request",
      body: emptyBody(),
      params: emptyParams(),
      config: {},
      ...partial,
      id,
    };
    const placement = derivePlacement(options.target);
    if (placement.parentId !== null) {
      setExpandedFolderIds((current) =>
        new Set(current).add(placement.parentId!),
      );
    }
    if (options.autoName) {
      autoNameIds.current.set(id, request.name);
    }
    setIsEditorActive(false);
    setOpenRequestIds((current) => [...current, id]);
    setActiveRequestId(id);
    selectSingle(id);
    setRenamingNodeId(null);
    if (options.autoName) {
      internals.setFocusUrlNonce((nonce) => nonce + 1);
    }
    if (options.mode === "draft") {
      setDraftRequests((current) =>
        new Map(current).set(id, { request, placement }),
      );
      return;
    }
    persistTree(
      insertNode(tree, placement.parentId, placement.index, request),
      "create",
    );
  };

  const newRequest = (target?: MoveTarget) => {
    const existingNames = [...requestsById.values()].map(
      (request) => request.name,
    );
    createRequestNode(
      { name: untitledName(existingNames), method: "GET", url: "" },
      { target, autoName: true, mode: "draft" },
    );
  };

  const beginRename = (id: string) => {
    // Stop the URL from driving the name (the user is naming it now), but keep
    // the last auto-derived name as the rename seed.
    autoNameIds.current.delete(id);
    setRenamingNodeId(id);
  };
  const cancelRename = () => setRenamingNodeId(null);
  const commitRename = (id: string, name: string) => {
    setRenamingNodeId(null);
    autoNameIds.current.delete(id);
    if (name.trim() === "") {
      return;
    }
    // A draft is not on disk: rename it in place on its own request (and clear
    // any name override so the new name shows through). No tree write.
    if (draftRequests.has(id)) {
      setDraftRequests((current) => {
        const entry = current.get(id);
        if (!entry) {
          return current;
        }
        const next = new Map(current);
        next.set(id, {
          ...entry,
          request: { ...entry.request, name },
        });
        return next;
      });
      setRequestOverrides((current) => {
        const existing = current.get(id);
        if (!existing || existing.name === undefined) {
          return current;
        }
        const rest = { ...existing };
        delete rest.name;
        const next = new Map(current);
        next.set(id, rest);
        return next;
      });
      return;
    }
    // Drop any name override so the persisted (renamed) tree value shows through
    // instead of being masked by the auto-name override.
    setRequestOverrides((current) => {
      const existing = current.get(id);
      if (!existing || existing.name === undefined) {
        return current;
      }
      const rest = { ...existing };
      delete rest.name;
      const next = new Map(current);
      next.set(id, rest);
      return next;
    });
    const node = findNode(tree, id);
    if (!node || node.name === name) {
      return;
    }
    persistTree(renameNode(tree, id, name), "rename");
  };

  const newFolder = (target?: MoveTarget) => {
    nodeCounter.current += 1;
    const id = `new-${nodeCounter.current}`;
    const folder: TreeNode = {
      kind: "folder",
      id,
      name: "New Folder",
      config: {},
      children: [],
    };
    const placement = derivePlacement(target);
    if (placement.parentId !== null) {
      setExpandedFolderIds((current) =>
        new Set(current).add(placement.parentId!),
      );
    }
    setIsEditorActive(false);
    selectSingle(id);
    setRenamingNodeId(id);
    persistTree(
      insertNode(tree, placement.parentId, placement.index, folder),
      "create",
    );
  };

  const duplicateNode = (id: string) => {
    const node = findNode(tree, id);
    if (!node) {
      return;
    }
    // The lib mints the top copy first, then its descendants; capture that first
    // id to select (folder) or open+activate (request) the copy.
    let topId: string | null = null;
    const mint = () => {
      nodeCounter.current += 1;
      const minted = `new-${nodeCounter.current}`;
      if (topId === null) {
        topId = minted;
      }
      return minted;
    };
    const next = applyDuplicate(tree, id, mint);
    if (topId === null) {
      return;
    }
    setIsEditorActive(false);
    if (node.kind === "folder") {
      selectSingle(topId);
      setExpandedFolderIds((current) => new Set(current).add(topId!));
      persistTree(next, "duplicate");
      return;
    }
    setOpenRequestIds((current) =>
      current.includes(topId!) ? current : [...current, topId!],
    );
    setActiveRequestId(topId);
    selectSingle(topId);
    persistTree(next, "duplicate");
  };

  // The delete target set for a clicked row: the whole multi-selection when the
  // clicked node is part of it, else just that node. Reduced to ids that exist
  // and pruned of any id nested under another target (its ancestor's removal
  // already takes it), returned in tree document order.
  const deleteTargetsFor = (id: string): string[] => {
    const base =
      selectedIds.has(id) && selectedIds.size > 1 ? [...selectedIds] : [id];
    const present = base.filter((each) => findNode(tree, each) !== null);
    const roots = present.filter((each) => {
      const ancestorAlsoTarget = present.some((other) => {
        if (other === each) {
          return false;
        }
        const otherNode = findNode(tree, other);
        return otherNode !== null && containsId(otherNode, each);
      });
      return !ancestorAlsoTarget;
    });
    const rootSet = new Set(roots);
    const ordered: string[] = [];
    const walk = (nodes: TreeNode[]) => {
      nodes.forEach((node) => {
        if (rootSet.has(node.id)) {
          ordered.push(node.id);
          return;
        }
        if (node.kind === "folder") {
          walk(node.children);
        }
      });
    };
    walk(tree);
    return ordered;
  };

  const deleteNodes = (ids: string[]) => {
    const nodes = ids
      .map((id) => findNode(tree, id))
      .filter((node): node is TreeNode => node !== null);
    if (nodes.length === 0) {
      return;
    }
    if (ids.includes(renamingNodeId ?? "")) {
      setRenamingNodeId(null);
    }
    nodes
      .flatMap((node) => collectRequestIds(node))
      .forEach((requestId) => {
        closeRequest(requestId);
      });
    const next = ids.reduce((acc, id) => removeNode(acc, id), tree);
    persistTree(next, "delete");
  };

  const requestDeleteNode = (id: string) => {
    const ids = deleteTargetsFor(id);
    if (ids.length === 0) {
      return;
    }
    // A dialog guards a destructive delete: more than one target, or a single
    // non-empty folder. A lone request or empty folder deletes immediately.
    const needsConfirm =
      ids.length > 1 ||
      ids.some((each) => {
        const node = findNode(tree, each);
        return node?.kind === "folder" && node.children.length > 0;
      });
    if (needsConfirm) {
      setPendingDelete({ ids });
      return;
    }
    deleteNodes(ids);
  };

  const confirmPendingDelete = () => {
    if (pendingDelete === null) {
      return;
    }
    deleteNodes(pendingDelete.ids);
    setPendingDelete(null);
  };

  const cancelPendingDelete = () => setPendingDelete(null);

  const persistMove = (next: TreeNode[]) => {
    setTree(next);
    onTreeChangeRef.current?.(next).then((result) => {
      if (!result.ok) {
        setConsoleLines((lines) => [
          ...lines,
          `[workspace] failed to persist move: ${result.error}`,
        ]);
      }
    });
  };

  const moveNode = (dragId: string, target: MoveTarget) => {
    const next = applyMove(tree, dragId, target);
    if (next === tree) {
      return;
    }
    persistMove(next);
  };

  const moveNodes = (dragIds: string[], target: MoveTarget) => {
    const next = applyMoveNodes(tree, dragIds, target);
    if (next === tree) {
      return;
    }
    persistMove(next);
  };

  return {
    derivePlacement,
    createRequestNode,
    newRequest,
    newFolder,
    duplicateNode,
    beginRename,
    commitRename,
    cancelRename,
    requestDeleteNode,
    confirmPendingDelete,
    cancelPendingDelete,
    moveNode,
    moveNodes,
  };
}
