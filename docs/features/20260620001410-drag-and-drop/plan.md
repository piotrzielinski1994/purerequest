# Plan: Drag-and-Drop (sidebar tree + request tabs)

**Spec:** [spec.md](spec.md)
**Status:** COMPLETE - all 13 ACs verified by a fresh verifier subagent (twice; once after a
fix pass). All gates green: 290 frontend tests, typecheck clean, lint 0 errors, build OK,
`cargo test` green.

## AC traceability (final)

| AC | Proving test |
| -- | ------------ |
| AC-001 | tab-reorder-context: `should set openRequestIds to the given permutation if reorderRequests is called` |
| AC-002 | tab-reorder-context: `should keep the same active tab if reorderRequests moves the active tab`; `should not open or close any tab if reorderRequests is called` |
| AC-003 | tab-reorder-context: `should call onTabsChange with the reordered ids if reorderRequests is called` |
| AC-004 | tab-reorder-context: `should keep the Settings tab rendered and out of openRequestIds if request tabs are reordered` |
| AC-005 | move: `should move a request into a folder at the given index if reparented`; move-node-context: `should reparent a root request into a folder if moveNode targets that folder` |
| AC-006 | move: `should move a folder with its whole subtree intact if reparented into another folder` |
| AC-007 | move: `should put the second child first…`; `should evaluate the index after removal…`; `should clamp an out-of-range index…` |
| AC-008 | move: `should return the original tree unchanged if a folder is dropped into itself`; `…into its own descendant`; move-node-context: `should not change the tree or call onTreeChange if the move is illegal` |
| AC-009 | tree-drop-indicator: `should render a drop line if the indicator points before this row`; `should highlight a folder row if the indicator points inside it`; (+ no-indicator / wrong-row negatives) |
| AC-010 | in-memory-fs: `should round-trip a serialized tree if written then read back`; `should persist a reparented request if a move is serialized and written` |
| AC-011 | disk-format-order: `should preserve a deliberately non-alphabetical sibling order through serialize then deserialize`; `should sort siblings by ascending order…`; `should fall back to folders-first-then-name…`; `should emit a manifest with schemaVersion 2` |
| AC-012 | move-node-context: `should keep a reparented request open and active…`; `should keep a folder expanded…`; `should keep the current selection…` |
| AC-013 | move-node-context: `should keep the in-memory move and log the failure if onTreeChange rejects the move` |

Supporting pure-layer coverage: `tree-locate` (dropTarget projection incl. same-parent
off-by-one fix, locateNode, findNode), `reconcile` (planReconcile write/remove diff +
emptyDirsAfterRemoval ordering/survival).

## 0. Shape of the work

Two subsystems, one library. Ship **A (tabs)** first - it's small, in-memory, and proves the
dnd-kit setup - then **B (sidebar + disk write)**, the larger half. Within each, TDD:
RED (fresh test-writer subagent) -> GREEN per AC -> REFACTOR -> VERIFY (fresh verifier).

Pure-function-first: the hard logic (`moveNode`, `planReconcile`, `serialize`/`deserialize`
`order`) is plain functions in `lib/workspace`, fully unit-testable without dnd-kit or jsdom
drag gestures. The dnd-kit layer is thin glue that calls those functions.

## 1. Approach & key decisions

### A - Tab reorder

- Wrap the tab strip's request tabs in a dnd-kit `DndContext` + horizontal `SortableContext`
  (items = `openRequestIds`). Each request tab becomes a `useSortable` item. Settings tab and
  the `+` button render outside the sortable context (AC-004).
- On `onDragEnd`, compute the new id array with `arrayMove` and call a new
  `reorderRequests(nextIds)` action on `WorkspaceProvider` that sets `openRequestIds`. The
  existing persist effect (`onTabsChange`) fires automatically (AC-003). Active id is a
  separate piece of state, so order changes don't touch it (AC-002).
- `reorderRequests` is guarded to only permit a permutation of the current ids (defensive).

### B - Sidebar tree

- **Lift `tree` into provider state.** `WorkspaceProvider` seeds `useState(() => tree)` from
  the prop; a `moveNode(dragId, target)` action rewrites it via the pure reducer.
  (Re-seeding when the `tree` prop identity changes is handled by keying `WorkspaceProvider`
  on workspace path in the loader, OR a sync effect - decide in GREEN, prefer the key.)
- **Pure `moveNode(tree, dragId, target)`** in `lib/workspace/move.ts`:
  `target = { parentId: string | null; index: number }`. Remove dragged node from old parent,
  insert into target parent at index; return original tree unchanged if target is the node or
  a descendant (AC-008), or if drag id not found. No mutation (structural clone of touched
  spine only).
- **`order` field** in `disk-format.ts`: `serialize` writes `order: i` per sibling array
  index; `deserialize` parses `order` and sorts by `(order ?? +inf, folders-first, name)`.
  Manifest `schemaVersion -> 2`. Keep `sortNodes` for the legacy/tie fallback.
- **Write path**:
  - `WorkspaceFs.writeWorkspace(rootPath, files)` added to the port.
  - Pure `planReconcile(current, next)` (`lib/workspace/reconcile.ts`): `write` = entries in
    `next` whose content differs from `current`; `remove` = managed keys in `current` absent
    from `next`. Managed-only (regex from `tauri-fs.ts`).
  - Tauri adapter: read current FileMap (reuse `readWorkspace`), `planReconcile`, then
    `mkdir(recursive)` -> `writeTextFile` -> `remove` files -> `remove` empty managed dirs
    deepest-first. Returns `{ ok }` ADT.
  - In-memory adapter: applies the plan to its stored `FileMap` (enables round-trip tests).
- **Commit on move**: provider's `moveNode` updates state, then (effect or callback) serializes
  the new tree and calls `writeWorkspace`; failure -> console line (AC-013). The serialize +
  write is threaded as an `onTreeChange(tree)` callback from the loader (mirrors
  `onTabsChange`), keeping `WorkspaceProvider` fs-free (DI). Loader owns `fs` + `workspacePath`.
- **dnd-kit tree glue** (`sidebar-tree.tsx` / `tree-row.tsx`): single `DndContext`; each row is
  `useSortable` with `useDroppable` semantics. A small `projectDrop(pointer, row)` decides
  reorder-between vs drop-inside-folder from vertical position over the row (top/bottom third =
  between, middle over a folder = inside). Drop indicator = insertion line or folder ring per
  state. Auto-expand a collapsed folder on drag-hover.

### Tauri capabilities

Add `fs:allow-write-text-file`, `fs:allow-mkdir`, `fs:allow-remove` to
`src-tauri/capabilities/default.json` (write side of the existing `$HOME/**` scope).

## 2. Files

| File | Change |
| ---- | ------ |
| `package.json` | add `@dnd-kit/core`, `@dnd-kit/sortable`, `@dnd-kit/utilities` |
| `src/components/workspace/content-header.tsx` | wrap request tabs in `DndContext`+`SortableContext`; each tab -> sortable; `onDragEnd` -> `reorderRequests` (A) |
| `src/components/workspace/workspace-context.tsx` | `tree` -> state; add `reorderRequests(ids)` (A) and `moveNode(dragId, target)` (B); `onTreeChange` prop; expose on value + type |
| `src/components/workspace/sidebar-tree.tsx` | `DndContext` around the tree; `DragOverlay`; collision/projection wiring (B) |
| `src/components/workspace/tree-row.tsx` | rows become `useSortable`/droppable; render drop indicator + folder-highlight states (B) |
| `src/components/workspace/workspace-loader.tsx` | pass `onTreeChange` that serializes + `fs.writeWorkspace`; surface write failure to console (B) |
| `src/lib/workspace/move.ts` | NEW - pure `moveNode(tree, dragId, target)` (B) |
| `src/lib/workspace/reconcile.ts` | NEW - pure `planReconcile(current, next)` (B) |
| `src/lib/workspace/disk-format.ts` | `order` field in serialize/deserialize; `schemaVersion` 2 (B) |
| `src/lib/workspace/fs.ts` | add `writeWorkspace` + `WriteResult` to the port (B) |
| `src/lib/workspace/tauri-fs.ts` | implement `writeWorkspace` (mkdir/write/remove + empty-dir cleanup) (B) |
| `src/lib/workspace/in-memory-fs.ts` | implement `writeWorkspace` against the stored FileMap (B) |
| `src-tauri/capabilities/default.json` | add fs write/mkdir/remove perms (B) |
| `__tests__/*` | new test files per RED phase (see §3) |
| `README.md`, `docs/adr.md`, `docs/learnings.md` | docs: disk now writable on move, `order` field, schemaVersion 2 |

## 3. Test plan (RED first, fresh test-writer subagent per sub)

Vitest + Testing Library. Pure functions get plain unit tests; provider actions get
context-render tests (mirror `new-request-context.test.tsx` / `body-override-context.test.tsx`).

### A - tabs
- `content-header` / tabs-reorder context test: `reorderRequests` permutes `openRequestIds`,
  leaves `activeRequestId` untouched (AC-001/002), and triggers `onTabsChange` (AC-003).
- settings tab not in the sortable set (AC-004).

### B - pure functions
- `move.test.ts`: reparent request into folder (AC-005); reparent folder subtree (AC-006);
  reorder siblings (AC-007); reject self/descendant drop (AC-008); reject unknown id; same-spot
  no-op. Assert returned tree shape + that input isn't mutated.
- `disk-format.test.ts` (extend): serialize writes `order`; deserialize sorts by `order`;
  legacy file w/o `order` falls back to name sort; v2 manifest; round-trip `serialize ->
  deserialize` preserves a hand-ordered tree (AC-011).
- `reconcile.test.ts`: write set = changed/new; remove set = managed-only orphans; never lists
  unmanaged files; moved-folder leaves old paths in `remove`.

### B - integration
- in-memory-fs `writeWorkspace` round-trip: move tree -> serialize -> write -> `readWorkspace`
  -> `deserialize` reproduces the moved/reordered tree (AC-010/TC-008).
- provider `moveNode` context test: reparent keeps the moved request's open tab + selection +
  expanded folders (AC-012/TC-009); write failure surfaces a console line (AC-013).

### dnd wiring (smoke, jsdom-limited)
- tree + tab DnD: `DndContext`/`SortableContext` mount; rows expose drag attributes. Document
  that raw pointer-drag gestures aren't simulated in jsdom (precedent: CM6 keystroke note in
  learnings); drop logic is covered by the pure `moveNode`/projection unit tests.

## 4. Execution order

1. **Sub A** - RED (test-writer) -> add dnd-kit deps -> GREEN (`reorderRequests` + content-header
   sortable) -> REFACTOR -> commit `feat: AC-001..004 tab reorder`.
2. **Sub B pure core** - RED -> `move.ts`, `order` in disk-format, `reconcile.ts` -> GREEN ->
   commit `feat: AC-005..008,011 tree move + order schema`.
3. **Sub B write path** - RED -> `writeWorkspace` (port + both adapters) + capabilities -> GREEN
   -> commit `feat: AC-010,013 workspace write path`.
4. **Sub B provider + UI** - RED -> lift `tree` to state, `moveNode` action, `onTreeChange`,
   sidebar dnd-kit glue + indicators -> GREEN -> commit `feat: AC-005..012 sidebar DnD`.
5. REFACTOR across both; no `any`, guards over nesting, pure fns kept pure.
6. VERIFY: fresh verifier subagent -> all ACs + gates (lint, typecheck, full `npm test`,
   `cargo test` for src-tauri if capabilities/Rust touched).
7. Docs: README (workspace now writes on move; `order`/schemaVersion 2), ADR rows, learnings,
   plan completion + AC traceability + Decision Log.

## 5. Acceptance verification

| AC | Proven by |
| -- | --------- |
| AC-001 | tabs context test: `reorderRequests` -> new order |
| AC-002 | tabs context test: active id unchanged after reorder |
| AC-003 | tabs context test: `onTabsChange` called with reordered ids |
| AC-004 | content-header test: settings tab outside sortable set |
| AC-005 | `move.test.ts`: reparent request into folder |
| AC-006 | `move.test.ts`: reparent folder subtree |
| AC-007 | `move.test.ts`: reorder siblings |
| AC-008 | `move.test.ts`: reject self/descendant drop (tree unchanged) |
| AC-009 | tree-row render test: indicator/highlight element present per drag state (jsdom-DOM-level) |
| AC-010 | in-memory-fs round-trip: move -> write -> read -> deserialize reproduces tree |
| AC-011 | `disk-format.test.ts`: order written + sorted; v1 fallback; v2 manifest |
| AC-012 | provider `moveNode` test: open tab + selection + expansion preserved |
| AC-013 | provider `moveNode` test: write failure -> console line, in-memory move kept |

## 6. Risks

- **dnd-kit + jsdom**: pointer/keyboard sensors can't run real drag gestures in jsdom -> keep
  all behavior logic in pure functions; DnD layer is thin glue smoke-tested for mount/attrs.
  (Precedent: CM6 contentEditable couldn't be keystroke-tested; same strategy.)
- **`tree` prop -> state divergence**: once `tree` is provider state, a later prop change (e.g.
  workspace reload) must reseed. Mitigation: key `WorkspaceProvider` by `workspacePath` in the
  loader so a new workspace remounts fresh; document it.
- **Disk write corrupting a workspace**: reconcile touches **only** managed files (regex-gated),
  cleans empty dirs deepest-first, and is round-trip tested. In-memory is source of truth for
  the session; a failed write never rolls back the UI (AC-013). Browser dev = no Tauri = no-op.
- **`order` schema change** is a public on-disk contract change (ADR-worthy). Mitigation:
  additive + tolerant deserialize (v1 files still load, missing `order` falls back to name
  sort), `schemaVersion` bumped to 2 as the signal.
- **Capabilities**: forgetting a write perm makes writes silently fail in the native app.
  Mitigation: add all three (`write-text-file`/`mkdir`/`remove`) and verify in `cargo test` /
  a manual `npm start` move-then-reload.

## 7. Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-20 | DnD via `@dnd-kit/*` (core+sortable+utilities), not native HTML5 DnD | Pointer + keyboard accessible, clean drop indicators, robust tree reparenting; native HTML5 reparent-with-position in a WebView is fiddly and inaccessible. User choice |
| 2026-06-20 | Sidebar moves **write to disk** (new `writeWorkspace` path) instead of in-memory-only | User choice: a moved request/folder should survive reload. Builds the first workspace writer (serialize was unused). Reconcile is managed-files-only + round-trip tested to keep it safe |
| 2026-06-20 | Add explicit `order` field to the on-disk format + bump `schemaVersion` 1->2 | Sibling reorder can't otherwise persist (today's format always re-sorts folders-first-then-alphabetical). Additive + tolerant: v1 files still load, missing `order` falls back to name sort. Public on-disk contract change, hence ADR + version bump |
| 2026-06-20 | Node ids stay stable through a move (no path-based id remap) | `resolveConfig` + all runtime lookups treat id as an opaque key (tree walked structurally); path-shaped id is only a deserialize convention. Stable ids => open tabs/selection/expansion survive a move for free. serialize regenerates disk paths from structure |
| 2026-06-20 | Ship tabs (A) before sidebar (B) | A is small/in-memory/already-persisted and proves the dnd-kit integration; B is the large half (tree mutation + brand-new disk write + schema change). Independent subsystems, sequential delivery |
| 2026-06-20 | Hard logic in pure fns (`moveNode`, `planReconcile`, `order` sort), dnd-kit as thin glue | jsdom can't simulate drag gestures; pure fns are fully testable and keep the DnD layer trivial. Matches the project's port/adapter + pure-`resolveConfig` style |
| 2026-06-20 | `dropTarget` takes the dragId and compensates for `moveNode`'s post-removal index (subtract 1 on a same-parent downward drag) | Verifier caught a latent off-by-one: the indicator showed slot N but the node landed at N+1 when dragged down within a folder, because `moveNode` evaluates the index after removing the dragged node. Fixing it in the pure `dropTarget` keeps the glue dumb and the fix unit-tested |
| 2026-06-20 | Extract `emptyDirsAfterRemoval`/`parentDir` into the pure `reconcile.ts` (out of the Tauri adapter) | Verifier flagged it had zero coverage (it lived only in the jsdom-untestable `tauri-fs.ts`). Moving it to a pure module made the deepest-first ordering + surviving-file logic unit-testable; the Tauri adapter just imports it |
