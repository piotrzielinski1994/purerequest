# Spec: Drag-and-Drop (sidebar tree + request tabs)

**Version:** 0.1.0
**Created:** 2026-06-20
**Status:** Draft

## 1. Overview

Add drag-and-drop in two places:

- **A - Request tabs**: reorder the open request tabs in the content header by dragging.
  Pure in-memory state (`openRequestIds`), already persisted via the existing
  `onTabsChange` path. Small, self-contained.
- **B - Sidebar collection tree**: drag a request or a folder onto/into another folder
  (**reparent**) and drop between siblings to **reorder**. The resulting tree is written
  back to the workspace folder **on disk** so it survives a reload.

These are two independent subsystems sharing one DnD library. **B is substantially larger**:
the workspace is read-only on disk today (no writer exists - `serialize()` is defined but
never called, capabilities grant read perms only, body edits/drafts are deliberately
in-memory). B builds the entire write path from scratch and changes the on-disk format
(adds an explicit `order` field).

### Decomposition

| Sub | Title | Scope | Disk? |
| --- | ----- | ----- | ----- |
| A | Tab reorder | reorder `openRequestIds` via dnd-kit sortable | no (in-memory, already persisted) |
| B | Sidebar reparent + reorder | tree mutation + on-disk write + `order` field + Tauri write caps | yes (new write path) |

Implementation order: **A first** (low risk, proves the dnd-kit integration), then **B**.

### Library

`@dnd-kit/core` + `@dnd-kit/sortable` (+ `@dnd-kit/utilities`). Chosen over native HTML5
DnD: pointer-based, accessible (keyboard DnD), gives clean drop indicators and robust tree
reparenting. Native HTML5 reparenting-with-drop-position in a WebView is fiddly and
inaccessible.

## 2. Acceptance Criteria

### A - Request tabs

- AC-001: An open request tab can be dragged horizontally and dropped at a new position in
  the tab strip; the tab order updates to reflect the drop.
- AC-002: Reordering tabs does not change which tab is active and does not open/close any tab
  (only order changes).
- AC-003: The new tab order is reported through the existing tab-persistence path
  (`onTabsChange` is called with the reordered `openRequestIds`), so it restores on reload.
- AC-004: The Settings tab (when open) is not reorderable and is unaffected by request-tab
  dragging (it is not part of `openRequestIds`).

### B - Sidebar tree

- AC-005: A request can be dragged onto a folder and dropped **inside** it (reparent); after
  the drop the request appears as a child of the target folder and is removed from its old
  parent.
- AC-006: A folder (with all its children) can be dragged and dropped **inside** another
  folder (reparent); the whole subtree moves.
- AC-007: An item can be dropped **between** two siblings to set its position among them
  (reorder within a parent).
- AC-008: A folder cannot be dropped into itself or into any of its own descendants (illegal
  move is rejected - tree is left unchanged, no crash).
- AC-009: A visible drop indicator shows the pending target (a line between rows for
  reorder, a highlight on the folder for drop-inside) while dragging.
- AC-010: After any successful move the tree is serialized and written to the workspace
  folder on disk (request file moved to the new path, folder dir + subtree moved, `order`
  fields written) - reloading the workspace reproduces the moved/reordered tree.
- AC-011: The on-disk format carries an explicit per-node `order` (integer) in `folder.json`
  and `*.req.json`; `serialize` writes it and `deserialize` sorts siblings by `order` (ties
  and missing `order` fall back to the existing folders-first-then-name sort).
- AC-012: Open request tabs, current selection, and expanded-folder state are preserved
  across an in-memory move (node ids stay stable through a move; a request that moved folders
  keeps its open tab).
- AC-013: A move whose disk write fails does not silently lose the change in-session: the
  in-memory tree still reflects the move and the failure is surfaced on the console line
  (best-effort persistence; in-memory is source of truth for the session).

## 3. User Test Cases

- TC-001 (tab reorder, happy): open 3 requests -> drag tab 1 to the right of tab 3 -> order is
  `2,3,1`; active tab unchanged. Maps to: AC-001, AC-002.
- TC-002 (tab reorder persists): reorder tabs -> `onTabsChange` fires with the new order. Maps
  to: AC-003.
- TC-003 (settings tab inert): settings tab open + 2 request tabs -> dragging a request tab
  never moves past/into the settings tab; settings stays put. Maps to: AC-004.
- TC-004 (reparent request): drag `req-a` from folder X onto folder Y -> `req-a` is now a
  child of Y, gone from X. Maps to: AC-005.
- TC-005 (reparent folder): drag folder `Sub` into folder `Other` -> `Sub` and its children
  are now under `Other`. Maps to: AC-006.
- TC-006 (reorder siblings): drag `req-b` above `req-a` within the same folder -> order is
  `req-b, req-a`. Maps to: AC-007.
- TC-007 (illegal move): drag folder `Parent` onto its own child `Child` -> move rejected,
  tree unchanged. Maps to: AC-008.
- TC-008 (persist + reload): reparent a request -> serialize -> write -> re-read the workspace
  -> the request is under the new folder with the expected `order`. Maps to: AC-010, AC-011.
- TC-009 (state preserved): open `req-a` as a tab, expand folder X -> reparent `req-a` to Y ->
  `req-a` tab still open + active, X still expanded. Maps to: AC-012.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Idle | Tree/tabs render as today; no DnD affordance beyond `cursor` on grab. |
| Dragging (tab) | Dragged tab follows pointer (drag overlay / translate); gap opens at target slot. |
| Dragging (tree, reorder) | Horizontal insertion line between rows at the projected index. |
| Dragging (tree, drop-inside) | Target folder row highlighted (e.g. ring/bg) to signal reparent. |
| Illegal target | No indicator shown (or a "blocked" cue); drop is a no-op. |
| Drop committed | Indicator clears; tree/tabs reflect the new order; (tree) disk write fires. |
| Disk write failed | In-memory move stays; console line `[workspace] failed to persist move: <err>`. |

### ASCII wireframe - tab reorder (mid-drag)

```
+---------------------------------------------------------------+
| GET req-a | [ POST req-b ]  ::drag::  | GET req-c |   Settings |
|           |  ^------- dragged tab follows pointer ------^      |
|           |            gap opens here -> | <-                  |
+---------------------------------------------------------------+
```

### ASCII wireframe - sidebar reorder (insertion line)

```
+------------------------------+
| v Auth                       |
|     GET  login               |
|  ---------------------------  <- insertion line (drop here)
|     POST refresh             |
| > Users                      |
+------------------------------+
```

### ASCII wireframe - sidebar drop-inside (folder highlight)

```
+------------------------------+
| v Auth                       |
|     GET  login               |
| +==========================+ |
| | > Users    (highlighted) | |  <- drop INSIDE Users (reparent)
| +==========================+ |
+------------------------------+
```

## 5. Data Model

### In-memory (`WorkspaceProvider`)

- `tree` moves from a **read-only prop** to **provider state** (`useState`, seeded from the
  `tree` prop). New action `moveNode(dragId, target)` rewrites it.
- `moveNode` delegates to a **pure** `moveNode(tree, dragId, target): TreeNode[]` in
  `lib/workspace`, where `target = { parentId: string | null; index: number }`. Pure fn:
  removes the dragged node from its old location, inserts it at the target parent + index,
  rejects (returns the original tree) if the target is the node itself or a descendant.
- Node **ids stay stable** through a move (ids are opaque keys for `requestsById`,
  `openRequestIds`, `selectedNodeId`, `expandedFolderIds`; nothing parses the path out of an
  id at runtime - verified in `resolve.ts`). So open tabs / selection / expansion survive.

### On-disk format change (the `order` field)

- `folder.json` and `*.req.json` gain `order: number` (0-based index among siblings).
- `serialize` writes `order` from each node's array position.
- `deserialize` reads `order` and sorts siblings by `(order, kind-folders-first, name)`;
  nodes missing `order` (legacy v1 files) sort after ordered ones by the existing rule.
- Manifest `schemaVersion` bumps `1 -> 2` (signals order-aware; deserialize stays tolerant of
  v1 so existing workspaces still load).

### Write path (new)

- `WorkspaceFs` gains `writeWorkspace(rootPath, files: FileMap): Promise<WriteResult>`.
- A pure `planReconcile(current: FileMap, next: FileMap): { write: FileMap; remove: string[] }`
  computes the file-level diff (write changed/new managed files, remove managed files no
  longer present). Only ever touches managed files (`folder.json` / `*.req.json` /
  `purerequest.workspace.json`) - never user files in the workspace.
- Tauri adapter executes the plan: `mkdir` parent dirs (recursive, idempotent) -> `writeTextFile`
  each -> `remove` orphaned files -> `remove` now-empty managed dirs (deepest-first; required
  because `deserialize` turns any leftover subdir into a phantom empty folder).
- In-memory adapter mutates its `FileMap` so tests can assert the persisted result and re-read.

## 6. Edge Cases

- **Drop onto self / own descendant** (folder): rejected by the pure `moveNode` (AC-008).
- **Drop a request "inside" a request**: not allowed - a request can't be a parent; treated as
  "reorder next to it" instead.
- **Reorder to same position**: no-op (tree unchanged, no disk write).
- **Empty target folder**: dropping inside an empty (collapsed or expanded) folder works;
  folder auto-expands on hover-to-drop so the user sees the result.
- **Slug collision on disk** after a move (two siblings slugify to the same name): existing
  `uniqueSlug` in `serialize` already disambiguates (`-2` suffix) - reconcile handles the
  renamed path.
- **Orphaned dir after a folder moves**: reconcile removes the now-empty source dir (else it
  re-reads as a phantom empty folder).
- **Disk write fails** (perms / Tauri absent in `npm run dev`): in-memory move stays; console
  line reports the failure (AC-013). In browser dev there is no Tauri host, so `writeWorkspace`
  is a no-op/failure and moves are session-only - consistent with the rest of the app.
- **Drafts** (`draft-*`, in-memory): a draft is a tab, not a tree node, so it is unaffected by
  sidebar DnD. Tab DnD reorders drafts like any tab (draft ids are filtered out of persistence
  as today).
- **jsdom can't do pointer-drag gestures**: behavior is tested at the reducer layer (pure
  `moveNode`, `planReconcile`, provider actions, `serialize`/`deserialize` round-trip), not by
  simulating raw drag events into dnd-kit. The DnD wiring itself is smoke-checked (sortable
  context mounts, items carry drag handles).

## 7. Dependencies

New npm deps:

- `@dnd-kit/core` - DnD context, sensors, collision detection, drag overlay.
- `@dnd-kit/sortable` - sortable list (tabs) + sortable helpers for the tree.
- `@dnd-kit/utilities` - `CSS` transform helper for drag styling.

Tauri / Rust:

- Capabilities (`src-tauri/capabilities/*.json`): add `fs:allow-write-text-file`,
  `fs:allow-mkdir`, `fs:allow-remove` (write side of the already-present `$HOME/**` scope).
- No new Rust code or plugin (the `fs` plugin already provides write/mkdir/remove/rename).

No change to the request/response model beyond the per-node `order` field on disk.
