import type { RequestNode } from "@/lib/workspace/model";
import { insertNode } from "@/lib/workspace/tree-edit";
import { updateRequest, type RequestPatch } from "@/lib/workspace/update-request";
import {
  indexRequests,
  type WorkspaceInternals,
} from "@/components/workspace/workspace-context/types";
import type { PersistApi } from "@/components/workspace/workspace-context/persist";
import type { TabsApi } from "@/components/workspace/workspace-context/tabs";

export type EditorsApi = {
  openConfigEditor: (id: string) => void;
  requestCloseEditor: () => void;
  saveActiveEditor: () => boolean;
  confirmPendingClose: () => void;
  savePendingClose: () => void;
  cancelPendingClose: () => void;
};

export function createEditors(
  internals: WorkspaceInternals,
  deps: {
    persistTree: PersistApi["persistTree"];
    closeRequest: TabsApi["closeRequest"];
    closeAllRequests: TabsApi["closeAllRequests"];
    closeOthers: TabsApi["closeOthers"];
  },
): EditorsApi {
  const {
    tree,
    requestsById,
    requestOverrides,
    draftRequests,
    openRequestIds,
    editorDirty,
    popupCanSave,
    pendingClose,
    activeEditor,
    setEditTarget,
    setIsEditorActive,
    setOpenRequestIds,
    setActiveRequestId,
    setActiveRequestTab,
    setPendingClose,
    setDraftRequests,
    setRequestOverrides,
  } = internals;
  const { persistTree, closeRequest, closeAllRequests, closeOthers } = deps;

  const openConfigEditor = (id: string) => {
    if (requestsById.has(id)) {
      setEditTarget(null);
      setIsEditorActive(false);
      setOpenRequestIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setActiveRequestId(id);
      setActiveRequestTab("settings");
      return;
    }
    setEditTarget({ kind: "config", id });
    setIsEditorActive(true);
  };

  const requestCloseEditor = () => {
    if (editorDirty) {
      setPendingClose({ kind: "editor" });
      return;
    }
    setEditTarget(null);
    setIsEditorActive(false);
  };

  const saveActiveEditor = (): boolean => {
    if (!activeEditor) {
      return false;
    }
    activeEditor.save();
    return true;
  };

  const applyClose = () => {
    if (pendingClose === null) {
      return;
    }
    if (pendingClose.kind === "all") {
      closeAllRequests();
    } else if (pendingClose.kind === "others") {
      closeOthers(pendingClose.id);
    } else if (pendingClose.kind === "editor") {
      setEditTarget(null);
      setIsEditorActive(false);
    } else {
      closeRequest(pendingClose.id);
    }
    setPendingClose(null);
  };

  const confirmPendingClose = () => applyClose();

  // Persist everything dirty for the pending close in ONE tree write, then
  // close. Folds the active config/request editor (commitToTree) and the saved
  // requests' url/method/body overrides into a single tree so close-all over
  // several dirty tabs can't clobber. The .env editor (no commitToTree) writes
  // its own text via save(). No-op when the active editor can't be saved.
  const savePendingClose = () => {
    if (pendingClose === null || !popupCanSave) {
      return;
    }
    const editor = activeEditor;
    const treeRequests = indexRequests(tree);
    const overrideIdsToFold =
      pendingClose.kind === "one"
        ? [pendingClose.id]
        : pendingClose.kind === "all"
          ? openRequestIds
          : pendingClose.kind === "others"
            ? openRequestIds.filter((id) => id !== pendingClose.id)
            : [];

    let nextTree = tree;
    const foldedOverrideIds: string[] = [];
    const promotedDraftIds: string[] = [];
    overrideIdsToFold.forEach((id) => {
      const draft = draftRequests.get(id);
      if (draft) {
        // A dirty draft being closed-with-save is promoted into the tree.
        const patch = requestOverrides.get(id) as RequestPatch | undefined;
        const node: RequestNode = { ...draft.request, ...(patch ?? {}) };
        nextTree = insertNode(
          nextTree,
          draft.placement.parentId,
          draft.placement.index,
          node,
        );
        promotedDraftIds.push(id);
        if (patch) {
          foldedOverrideIds.push(id);
        }
        return;
      }
      if (!treeRequests.has(id)) {
        return; // not an on-disk request: nothing to write
      }
      const patch = requestOverrides.get(id) as RequestPatch | undefined;
      if (patch) {
        nextTree = updateRequest(nextTree, id, patch);
        foldedOverrideIds.push(id);
      }
    });
    if (editor?.commitToTree) {
      nextTree = editor.commitToTree(nextTree);
    }

    if (promotedDraftIds.length > 0) {
      setDraftRequests((current) => {
        const next = new Map(current);
        promotedDraftIds.forEach((id) => next.delete(id));
        return next;
      });
    }
    if (foldedOverrideIds.length > 0) {
      setRequestOverrides((current) => {
        const nextOverrides = new Map(current);
        foldedOverrideIds.forEach((id) => nextOverrides.delete(id));
        return nextOverrides;
      });
    }
    if (nextTree !== tree) {
      persistTree(nextTree, "edits");
    }
    // The .env editor isn't a tree write - persist it on its own.
    if (editor && !editor.commitToTree) {
      editor.save();
    }

    applyClose();
  };

  const cancelPendingClose = () => setPendingClose(null);

  return {
    openConfigEditor,
    requestCloseEditor,
    saveActiveEditor,
    confirmPendingClose,
    savePendingClose,
    cancelPendingClose,
  };
}
