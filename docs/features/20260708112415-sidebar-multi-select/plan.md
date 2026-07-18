# Plan: Sidebar multi-select + multi-move

From the approved spec. Ports the purequery approach to purerequest's folder/request tree.

## Task breakdown

1. **Pure helpers (red -> green)**
   - New `src/lib/workspace/tree-select.ts`: `flattenSelectable`, `rangeBetween`
     (adapt purequery's: selectable = folder + request; a `RequestNode` is a leaf, so
     it contributes its own id; a folder contributes its id + children only when
     expanded).
   - Extend `src/lib/workspace/move.ts`: add `movableInOrder` + `moveNodes`
     (verbatim from purequery - it is model-agnostic, keys only on `kind === "folder"`).
   - Add `rawDropTarget` to `src/lib/workspace/tree-locate.ts` and refactor
     `dropTarget` to layer single-node compensation on top of it (purequery shape).
   - Unit tests: `tree-select.test.ts`, `move-nodes.test.ts` (or extend existing).

2. **Context state + reducer**
   - `workspace-context.tsx`: add `selectedIds`, `selectAnchorId` state,
     `SelectMode` type, `selectInTree(id, mode)`, `clearSelection()`, and
     `moveNodes(dragIds, target)` (persists via existing path). Export on the value
     + add to the memo deps. Keep `selectedNodeId`/`selectNode` for CRUD targeting;
     a `replace` click updates both.

3. **Row wiring**
   - `tree-row.tsx`: add `selectModeOf(event)`; folder + request `onClick` call
     `selectInTree(node.id, mode)` and only run the open/toggle side effect on
     `replace`. Highlight on `selectedIds.has(node.id)`.

4. **Drag-end multi path + overlay**
   - `sidebar-tree.tsx`: in `handleDragEnd`, branch on
     `selectedIds.has(dragId) && selectedIds.size > 1` -> `rawDropTarget` +
     `moveNodes([...selectedIds], raw)`; else the existing single path.
   - New `src/lib/workspace/drag-overlay-label.ts` + use it in the `DragOverlay`.
   - A plain left-click on the empty tree area clears the selection.

5. **Component tests**
   - `tree-multi-select.test.tsx` (click modes) + `tree-multi-move.test.tsx`
     (moveNodes through context), mirroring purequery's suites against purerequest fixtures.

## Execution order

1 (helpers + unit tests) -> 2 (context) -> 3 (rows) -> 4 (drag/overlay) ->
5 (component tests). Red-green-refactor at each layer.

## File changes

- add `src/lib/workspace/tree-select.ts`
- add `src/lib/workspace/drag-overlay-label.ts`
- edit `src/lib/workspace/move.ts`, `tree-locate.ts`
- edit `src/components/workspace/workspace-context.tsx`, `tree-row.tsx`,
  `sidebar-tree.tsx`
- add tests under `src/lib/workspace/__tests__/` and
  `src/components/workspace/__tests__/`

## Acceptance verification

- AC-001..004 -> `tree-multi-select.test.tsx` (toggle/range/replace, no side
  effect on modifier click).
- AC-005..008 -> `tree-multi-move.test.tsx` + `move-nodes.test.ts` (reparent all,
  cycle/descendant guards, `onTreeChange` fired).
- AC-009 -> `drag-overlay-label` unit test.
- Manual: `npm start`, exercise TC-001..004 in the running app.
