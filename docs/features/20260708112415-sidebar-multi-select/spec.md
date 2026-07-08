# Spec: Sidebar multi-select + multi-move

**Version:** 0.1.0
**Created:** 2026-07-08
**Status:** Draft

## 1. Overview

Let the sidebar collection tree hold a **multi-selection** and move it in one drag.
Today selection is a single scalar (`selectedNodeId`): one row highlighted, click
opens/toggles it, drag moves that one node. This adds:

- **Cmd/Ctrl+click** toggles a row in/out of the selection.
- **Shift+click** selects the contiguous range from the anchor to the clicked row,
  over the *visible* (expanded) rows.
- **Plain click** replaces the selection with that one row (unchanged open/toggle
  side effects).
- **Dragging a selected row moves the whole selection** in one drop (reparent or
  reorder); dragging an unselected row moves just that one (unchanged).

Mirrors the approach already shipped in the sibling `dbui` repo (same tree
architecture): a `selectedIds: Set<string>` + `selectAnchorId` in the workspace
context, pure range helpers, and a `moveNodes` tree transform that moves a set
contiguously in document order.

Out of scope (dbui has it, we defer): bulk keyboard delete and the multi-node
delete dialog. Single-node delete is unchanged.

## 2. Acceptance Criteria

- AC-001: Cmd/Ctrl+clicking a row adds it to the selection (both highlighted);
  a second Cmd/Ctrl+click on a selected row removes it.
- AC-002: Shift+click selects the inclusive range from the anchor to the clicked
  row across the currently visible rows (a collapsed folder's hidden children are
  not part of the range).
- AC-003: A plain click resets the selection to that single row and keeps its
  existing behavior (request opens a tab; folder toggles expand).
- AC-004: A modifier (Cmd/Ctrl/Shift) click adjusts only the selection - it does
  NOT open a tab or toggle a folder.
- AC-005: Dragging a row that is part of a multi-selection moves the entire
  selection to the drop target (reparent into a folder, or reorder among
  siblings); the moved nodes keep their on-screen order.
- AC-006: Dragging a row that is NOT selected moves just that one node (existing
  single-drag behavior is unchanged).
- AC-007: A multi-move cannot drop the selection into one of its own dragged
  folders (no cycle); descendants of a dragged folder ride along inside it rather
  than moving twice.
- AC-008: A multi-move persists through the existing `onTreeChange` path so it
  survives reload.
- AC-009: The drag overlay shows "N items" when dragging a multi-selection, and
  the node's name for a single drag.

## 3. User Test Cases

- TC-001: Cmd+click two sibling requests -> both highlighted. Drag one onto a
  folder -> both become that folder's children.
- TC-002: Click a folder, Shift+click a request three rows down -> the whole
  visible run highlights. Drag it above another folder -> the run reorders there.
- TC-003: Cmd+click a row already selected -> it de-highlights (removed from set).
- TC-004: With two rows selected, plain-click a third -> only the third is
  selected and (if a request) its tab opens.

## 4. Data Model

No on-disk change. New in-memory context state only:

- `selectedIds: Set<string>` - the sidebar multi-selection (node ids).
- `selectAnchorId: string | null` - the row a Shift range extends from.

Existing `selectedNodeId` is retained as the "primary" single selection that
drives CRUD/placement targets (`main.tsx`, `derivePlacement`); a plain click keeps
it in sync with the selection, a modifier click leaves it put.

`SelectMode = "replace" | "toggle" | "range"` classifies a click.

Pure helpers:
- `flattenSelectable(tree, expandedIds)` - selectable ids in visible DFS order
  (folders + requests; a collapsed folder's children omitted).
- `rangeBetween(ordered, anchor, target)` - inclusive range, direction-independent.
- `moveNodes(tree, dragIds, target)` - move a set contiguously (document order),
  with descendant/cycle guards; `target.index` is the RAW slot.
- `rawDropTarget(...)` - the uncompensated drop slot `moveNodes` consumes.

## 5. Edge Cases

- Stale anchor inside a since-collapsed folder: `rangeBetween` falls back to just
  the target.
- Dragging onto a member of the selection: rejected (no-op).
- A dragged folder plus one of its own children both selected: the child is
  dropped from the move (rides inside the folder), preserving structure.

## 6. Dependencies

- `@dnd-kit/core` (already used by the tree). No new packages.
- Reuses the existing `onTreeChange` persistence path.
