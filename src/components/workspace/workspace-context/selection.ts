import { flattenSelectable, rangeBetween } from "@/lib/workspace/tree-select";
import {
  toggleInSet,
  type SelectMode,
  type WorkspaceInternals,
} from "@/components/workspace/workspace-context/types";

export type SelectionApi = {
  selectSingle: (id: string) => void;
  focusNode: (id: string) => void;
  selectNode: (id: string) => void;
  selectInTree: (id: string, mode: SelectMode) => void;
  clearSelection: () => void;
  toggleFolder: (id: string) => void;
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

  return {
    selectSingle,
    focusNode,
    selectNode,
    selectInTree,
    clearSelection,
    toggleFolder,
  };
}
