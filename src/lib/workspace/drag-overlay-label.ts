// The label shown in the drag overlay (the chip following the pointer): the
// selection count ("N items") when the dragged row is part of a multi-selection,
// otherwise the dragged node's own name. A single-item selection shows the name,
// never "1 items".
export function dragOverlayLabel(
  dragId: string,
  dragName: string,
  selectedIds: Set<string>,
): string {
  if (selectedIds.has(dragId) && selectedIds.size > 1) {
    return `${selectedIds.size} items`;
  }
  return dragName;
}
