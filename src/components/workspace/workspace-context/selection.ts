import {
  type SelectMode,
  toggleInSet,
  type WorkspaceInternals,
} from "@/components/workspace/workspace-context/types";
import { ancestorIds, findNode } from "@/lib/workspace/tree-locate";
import {
  allFolderIds,
  flattenSelectable,
  rangeBetween,
} from "@/lib/workspace/tree-select";

export type SelectionApi = {
  selectSingle: (id: string) => void;
  focusNode: (id: string) => void;
  selectNode: (id: string) => void;
  revealNode: (id: string) => void;
  selectInTree: (id: string, mode: SelectMode) => void;
  clearSelection: () => void;
  toggleFolder: (id: string) => void;
  collapseFolder: (id: string) => void;
  expandFolder: (id: string) => void;
  collapseAllFolders: () => void;
  expandAllFolders: () => void;
};

export function createSelection(internals: WorkspaceInternals): SelectionApi {
  const {
    tree,
    requestsById,
    expandedFolderIds,
    selectAnchorId,
    setSelectedNodeId,
    setSelectedIds,
    setSelectAnchorId,
    setExpandedFolderIds,
    setOpenRequestIds,
    setIsEditorActive,
    setActiveRequestId,
    setRevealRowId,
  } = internals;

  // Set the primary (CRUD/placement) node AND collapse the multi-selection to
  // just it, so the sidebar highlight (driven off selectedIds) tracks the
  // single active node whenever selection is set outside a modifier-click.
  const selectSingle = (id: string) => {
    setSelectedNodeId(id);
    setSelectedIds(new Set([id]));
    setSelectAnchorId(id);
  };

  // Move the single-selection to a row without opening/toggling it - the
  // keyboard-navigation seam (ArrowUp/Down/Home/End) moves focus + selection
  // but must not open a request tab or collapse a folder.
  const focusNode = (id: string) => {
    selectSingle(id);
  };

  const selectNode = (id: string) => {
    selectSingle(id);
    const request = requestsById.get(id);
    if (!request) {
      setExpandedFolderIds((current) => toggleInSet(current, id));
      return;
    }
    setOpenRequestIds((current) =>
      current.includes(id) ? current : [...current, id],
    );
    setIsEditorActive(false);
    setActiveRequestId(id);
  };

  // Reveal a node from outside the tree (quick-open). Expand every ancestor
  // folder (plus the node itself when it is a folder) so the row is visible,
  // single-select it, open+activate a request's tab, and flag its row for the
  // sidebar to scroll into view.
  const revealNode = (id: string) => {
    const node = findNode(tree, id);
    if (!node) {
      return;
    }
    const toExpand = ancestorIds(tree, id);
    setExpandedFolderIds((current) => {
      const next = new Set(current);
      toExpand.forEach((folderId) => {
        next.add(folderId);
      });
      if (node.kind === "folder") {
        next.add(id);
      }
      return next;
    });
    selectSingle(id);
    if (node.kind === "request") {
      setOpenRequestIds((current) =>
        current.includes(id) ? current : [...current, id],
      );
      setIsEditorActive(false);
      setActiveRequestId(id);
    }
    setRevealRowId(id);
  };

  const selectInTree = (id: string, mode: SelectMode) => {
    if (mode === "toggle") {
      setSelectedIds((current) => toggleInSet(current, id));
      setSelectAnchorId(id);
      return;
    }
    if (mode === "range" && selectAnchorId !== null) {
      const ordered = flattenSelectable(tree, expandedFolderIds);
      setSelectedIds(new Set(rangeBetween(ordered, selectAnchorId, id)));
      return;
    }
    setSelectedIds(new Set([id]));
    setSelectAnchorId(id);
  };

  const clearSelection = () => {
    setSelectedIds(new Set());
    setSelectAnchorId(null);
    // Also drop the primary node so placement (new request/folder) falls back
    // to the workspace root instead of the just-deselected folder.
    setSelectedNodeId(null);
  };

  const toggleFolder = (id: string) =>
    setExpandedFolderIds((current) => toggleInSet(current, id));

  const collapseFolder = (id: string) =>
    setExpandedFolderIds((current) => {
      if (!current.has(id)) {
        return current;
      }
      const next = new Set(current);
      next.delete(id);
      return next;
    });

  const expandFolder = (id: string) =>
    setExpandedFolderIds((current) => {
      if (current.has(id)) {
        return current;
      }
      return new Set(current).add(id);
    });

  const collapseAllFolders = () => setExpandedFolderIds(new Set());

  const expandAllFolders = () =>
    setExpandedFolderIds(new Set(allFolderIds(tree)));

  return {
    selectSingle,
    focusNode,
    selectNode,
    revealNode,
    selectInTree,
    clearSelection,
    toggleFolder,
    collapseFolder,
    expandFolder,
    collapseAllFolders,
    expandAllFolders,
  };
}
