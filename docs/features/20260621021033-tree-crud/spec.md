# Spec: Tree CRUD (create / rename / delete / duplicate from the UI)

**Version:** 0.3.0
**Created:** 2026-06-21
**Status:** Implemented

> v0.3.0 (user feedback, 2026-07-08 - REVERSES v0.2.0's immediate-create for requests):
> "New request" / `+` now opens a **session draft** tab - an in-memory request that is NOT
> written to disk and NOT shown in the sidebar until it is edited AND saved; saving promotes it
> into the tree at its placement. Closing an unedited draft discards it. New FOLDER and cURL
> import still persist immediately. See ADR 2026-07-08. The v0.2.0 note below is historical.
>
> v0.2.0 (user feedback): "New request" now creates a real node on disk immediately and opens
> its tab. The original draft-then-save model (and the whole in-memory draft system) was removed.
> Context menu also corrected: create actions live on FOLDER rows + the empty area, not on
> request rows. A new request **focuses the URL input** and **auto-names from the URL path**
> until renamed/saved (new folders still focus inline rename). An already-saved request never
> auto-renames from a URL edit.

## 1. Overview

The collection tree is read-from-disk + drag-to-move today, but otherwise immutable
from the UI: you cannot create, rename, delete, or duplicate a node without hand-editing
files. This feature makes the tree fully writable. Every op mutates the in-memory tree and
persists through the **existing** write seam (`onTreeChange` -> `serialize` ->
`writeWorkspace` reconcile), the same path feature #1 (persist-edits) and drag-move use. No
on-disk format change, no `schemaVersion` bump (`serialize` regenerates file paths from tree
structure + slugged names; reconcile writes the new/changed files and removes orphans).

Ops are surfaced three ways (user directive: command-palette actions **with keyboard
shortcuts**, not just buttons):

1. **Right-click context menu** on a tree row (the natural target-picker).
2. **Command palette** entries (`Mod+K`).
3. **Keyboard shortcuts** (rebindable, conflict-checked) acting on the tree selection.

### Scope

- **In:** create request, create folder, rename node, delete node, duplicate **request**.
- **Out:** duplicate folder (todos #22 is "duplicate request"); multi-select ops; cut/copy/
  paste; undo. Move stays the drag-and-drop feature already shipped.

### Decisions captured (user)

- **Surface:** context menu **+** palette/shortcuts (all three).
- **Create request flow:** reuse the existing in-memory **draft** (`Mod+T` / `+`); **saving**
  a draft (`Mod+S`) now CREATES its `*.req.json` on disk (today it is a no-op for drafts).
  This is the draft -> saved-file promotion feature #1 named as the boundary.
- **Create request flow (v0.2.0, user feedback - supersedes draft model):** "New request"
  behaves exactly like "New folder" - it writes a real request node to disk **immediately**,
  opens + selects it, **opens its tab**, and drops into **inline rename**. No draft, no
  save step. The in-memory draft system was removed.
- **Create folder flow:** a folder has no tab/editor, so "New folder" writes a folder node to
  disk **immediately** and drops into **inline rename** (not a draft).
- **Placement:** new nodes land **relative to selection** - inside a selected folder, as a
  sibling after a selected request, at workspace root when nothing is selected. A context-menu
  invocation uses the right-clicked row as the target.
- **Rename:** **inline edit** in the tree row (Enter commits, Esc cancels, blur commits).
- **Delete confirm:** always prompt **except** an empty folder and a single request (those
  delete immediately); a **non-empty folder** prompts (names it + descendant count).
- **Shortcuts:** all four new actions get a default key: new-folder `Mod+Shift+N`,
  duplicate-request `Mod+D`, rename-node `F2`, delete-node `Mod+Backspace`. All rebindable +
  conflict-checked like the existing actions. (new-request `Mod+T` already exists.)

## 2. Acceptance Criteria

- AC-001 (create request): `new-request` (`Mod+T`, the `+` button, folder context-menu, empty-
  area context-menu, or palette) INSERTS a real request node at its placement and persists a new
  `*.req.json` via `onTreeChange` **immediately** (no draft/save step); re-serializing +
  re-deserializing reproduces it. The new node opens + activates its tab, is selected, and
  **focuses the URL input** (not inline rename). While the new request stays unnamed, its
  **name auto-tracks the URL path** (`deriveRequestName` - strips a `{{var}}`/scheme+host prefix
  and query/hash, leaving the path, e.g. `{{baseUrl}}/widgets` -> `/widgets`); the auto-naming
  stops once the user renames it (inline `F2`/Settings) or saves it. An already-saved request
  never renames from a URL edit. It is otherwise a normal on-disk request (clean until edited;
  editing then saving uses the ordinary url/method/body override -> `Mod+S` path).
- AC-002 (placement): the new node lands relative to the placement target - **inside** a
  target folder (appended, folder auto-expanded), as the **next sibling** of a target request,
  at **workspace root** when there is no target. A context-menu op targets the right-clicked
  row; a palette/shortcut op targets the current tree selection (`selectedNodeId`).
- AC-003 (create folder): `new-folder` (`Mod+Shift+N` or context-menu "New folder") inserts a
  folder node at the placement, persists it immediately (an empty folder still writes its
  `folder.json`), selects + expands it, and enters **inline rename** on it.
- AC-004 (rename): `rename-node` (`F2`, double-click the row, context-menu, or palette) turns
  the row label into an inline text input seeded with the current name + text selected. Enter
  (or blur) commits via `onTreeChange` (renames the node; a renamed **folder** rewrites its and
  its descendants' on-disk paths, reconcile removes the old paths); Esc cancels with no write.
  A blank/whitespace-only name is rejected (keeps the old name, no write).
- AC-005 (delete, immediate): deleting a **request** or an **empty folder** (context-menu /
  palette / `Mod+Backspace`) removes it from the tree immediately (no dialog), persists (its
  file is reconciled off disk), and closes its open tab if one exists (active tab falls back
  like a normal close).
- AC-006 (delete, confirm): deleting a **non-empty folder** opens a confirm dialog naming the
  folder + its descendant count. **Delete** removes the folder and all descendants (files +
  now-empty dirs reconciled away) and closes any of their open request tabs; **Cancel** keeps
  everything (no write).
- AC-007 (duplicate request): `duplicate-request` (`Mod+D`, context-menu, or palette) inserts a
  deep copy of the request immediately **after** the original with a distinct name
  (`"<name> copy"`), persists the new `*.req.json`, and opens the copy as the active tab. The
  action is unavailable / a no-op on a **folder**.
- AC-008 (context menu): right-clicking a **folder** row opens a menu with **New request**,
  **New folder** (both create INSIDE that folder), **Rename**, **Edit**, **Delete**.
  Right-clicking a **request** row opens **Rename**, **Duplicate**, **Edit**, **Delete**
  (no New request/folder - creating a node "on" a leaf request is meaningless). **Edit**
  opens the node's config editor (a folder's config pane / a request's Settings tab) - it
  replaced the old hover pencil, which was removed from every row. Right-clicking the **empty
  sidebar area** opens **New request** / **New folder** (create at the workspace root). A row's
  `ContextMenu` is nested inside the empty-area one, so a row right-click shows only the row menu
  (radix inner-trigger precedence).
- AC-009 (shortcuts + palette): the four new actions exist in `SHORTCUT_ACTIONS` with the
  defaults above, are rebindable + conflict-checked, and appear in the command palette.
  Shortcut/palette invocations act on `selectedNodeId` (falling back to the active request for
  request-only ops) and no-op without an applicable target. `delete-node` does **not** fire
  while an editable surface (text input / CodeMirror) is focused, so `Mod+Backspace` stays
  usable for in-field text editing.
- AC-010 (persistence + failure): every op routes through `onTreeChange`; a `{ok:false}` write
  keeps the in-memory change and appends `[workspace] failed to persist <label>: <err>`
  (mirrors move / edits). With no `onTreeChange` (browser `npm run dev`) the op stays
  in-session and toasts "Saved".
- AC-011 (gates): `npm run lint`, `npm run typecheck`, `npm test`, `cargo test` exit 0.

## 3. User Test Cases

- TC-001 (create request, persist+reload): select a folder, `new-request`, edit url/method,
  `Mod+S` -> the draft is folded into the tree inside that folder; `onTreeChange` fires; a
  serialize+deserialize round-trip reproduces the request at that path. Maps to: AC-001, AC-002.
- TC-002 (create request at root): nothing selected, `new-request`, `Mod+S` -> the request is
  appended at workspace root. Maps to: AC-002.
- TC-003 (create folder + inline rename): `new-folder` on a selected folder -> a child folder
  appears, is selected + expanded, its row is an inline input; type a name + Enter -> the folder
  persists under the new name; round-trip reproduces it. Maps to: AC-003.
- TC-004 (rename commit): `rename-node` on a request -> inline input; type a new name + Enter ->
  the node is renamed, `onTreeChange` fires; the old slug file is gone, the new one present.
  Maps to: AC-004.
- TC-005 (rename cancel + blank reject): begin rename, press Esc -> input closes, no write,
  name unchanged. Begin rename, clear the field, Enter/blur -> name unchanged, no write.
  Maps to: AC-004.
- TC-006 (rename folder rewrites descendants): rename a folder with children -> the folder's
  and every descendant's path changes in the serialized FileMap; reconcile would remove the old
  paths. Maps to: AC-004.
- TC-007 (delete request immediately): delete an open request -> removed from tree, its tab
  closed, no dialog; `onTreeChange` fires without that file. Maps to: AC-005.
- TC-008 (delete empty folder immediately): delete an empty folder -> removed, no dialog.
  Maps to: AC-005.
- TC-009 (delete non-empty folder -> confirm -> delete): delete a folder with 2 requests ->
  dialog names the folder + "2 items" -> Delete -> folder + both requests gone, their open tabs
  closed. Maps to: AC-006.
- TC-010 (delete non-empty folder -> cancel): same dialog -> Cancel -> nothing removed, no
  write. Maps to: AC-006.
- TC-011 (duplicate request): duplicate a request -> a copy named "<name> copy" appears right
  after it, opened as the active tab; round-trip reproduces both. Maps to: AC-007.
- TC-012 (context menu items): right-click a request row -> menu shows Rename, Duplicate,
  Delete (no create items); right-click a folder row -> New request, New folder, Rename, Delete
  (no Duplicate); right-click the empty area -> New request, New folder. Maps to: AC-008.
- TC-013 (shortcut target = selection): with a request selected, the `duplicate-request` /
  `rename-node` / `delete-node` handlers act on that node; with nothing selected they no-op.
  Maps to: AC-009.
- TC-014 (delete-node input guard): focus is in the URL input, fire `delete-node` -> the
  selected node is NOT deleted (the key is left to the input). Maps to: AC-009.
- TC-015 (persist failure): an op while `onTreeChange` returns `{ok:false}` -> the tree keeps
  the change and a `[workspace] failed to persist <label>: ...` console line is appended.
  Maps to: AC-010.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Row idle | Method glyph (request) / chevron (folder) + name + hover config pencil (unchanged). |
| Row right-clicked | Context menu opens at the pointer with the kind-appropriate items. |
| Row renaming | The name is replaced by a focused, text-selected `<input>`; Enter/blur commit, Esc cancels. |
| New folder created | Folder inserted + selected + expanded, immediately in the renaming state. |
| Draft tab (unsaved request) | Dirty dot + confirm-on-close (unchanged from feature #1); `Mod+S` now creates the file. |
| Delete non-empty folder | Confirm dialog (Cancel / Delete). |
| Delete request / empty folder | Removed immediately, no dialog. |

### ASCII wireframe - context menu on a request row (edit actions only)

```
+--------------------+
| GET  profile       |   <- right-clicked request row
+--------------------+
     v
     +----------------------+
     | Rename               |
     | Duplicate            |
     +----------------------+
     | Delete               |
     +----------------------+
```

### ASCII wireframe - context menu on a folder row (create inside + edit)

```
+--------------------+
| v  auth            |   <- right-clicked folder row
+--------------------+
     v
     +----------------------+
     | New request          |  (inside this folder)
     | New folder           |  (inside this folder)
     +----------------------+
     | Rename               |
     +----------------------+
     | Delete               |
     +----------------------+
```

### ASCII wireframe - context menu on the empty sidebar area (create at root)

```
+--------------------+
|  (blank area)      |   <- right-clicked empty space
+--------------------+
     v
     +----------------------+
     | New request          |
     | New folder           |
     +----------------------+
```

### ASCII wireframe - inline rename (row becomes an input)

```
+----------------------------------+
| GET  [profile-v2______________]  |   <- focused input, text selected
+----------------------------------+
        Enter = commit   Esc = cancel
```

### ASCII wireframe - delete non-empty folder confirm

```
+------------------------------------------+
|  Delete "auth"?                          |
|                                          |
|  Removes the folder and 2 items. This    |
|  cannot be undone.                       |
|                                          |
|                     [ Cancel ] [ Delete ]|
+------------------------------------------+
```

## 5. Data Model

No on-disk format change. New pure functions + provider state only.

### Pure layer (`src/lib/workspace/tree-edit.ts`, new)

Extracts the tree-structure helpers `move.ts` already has (so they are shared, not
duplicated) and adds the new ops. All pure, return a new tree, no mutation:

- `insertNode(tree, parentId, index, node): TreeNode[]` (moved out of `move.ts`).
- `removeNode(tree, id): TreeNode[]` (moved out of `move.ts`).
- `renameNode(tree, id, name): TreeNode[]` - patches the matching node's `name` (request or
  folder); no-op on missing id or blank name.
- `duplicateRequest(tree, id, newId): TreeNode[]` - inserts a deep copy of the request `id`
  right after it, `name = "<name> copy"`, `id = newId`; no-op if `id` is missing or a folder.
- `collectRequestIds(node): string[]` - every request id in a subtree (for closing tabs on a
  folder delete).
- `countDescendants(node): number` - descendant node count (for the confirm message).

`move.ts` imports `insertNode`/`removeNode`/`findNode`/`containsId` from here.

### Provider state / API (`WorkspaceProvider`)

- `selectedNodeId` (exists) is the palette/shortcut target.
- `renamingNodeId: string | null` + `beginRename(id)`, `commitRename(id, name)`,
  `cancelRename()`. `commitRename` is a no-op for a blank name; otherwise `renameNode` ->
  `persistTree(_, "rename")` and clears `renamingNodeId`.
- `newRequest(target?: MoveTarget)` (extended): records the placement target (explicit arg, else
  derived from `selectedNodeId`, else root) in a `draftTargets: Map<draftId, MoveTarget>`; the
  rest is unchanged (opens the draft tab).
- `saveActiveRequest()` / draft-save (extended): when the active id is a **draft**, build a
  `RequestNode` from `{...draft, ...override, id: <fresh>}`, `insertNode` at its placement,
  `persistTree(_, "create")`, drop the draft + override + draftTarget, and **swap the open tab
  id** from the draft id to the fresh id (open tabs, active, selection, response state).
- `newFolder(target?: MoveTarget)`: `insertNode` a `{kind:"folder", id:<fresh>, name:"New
  Folder", config:{}, children:[]}` at the placement, `persistTree(_, "create")`, expand the
  parent, select the new folder, `beginRename(newId)`.
- `duplicateRequest(id)`: `duplicateRequest(tree, id, <fresh>)` -> `persistTree(_, "duplicate")`;
  open + activate the copy. No-op on a folder.
- Delete: `pendingDelete: { id: string } | null` + `requestDeleteNode(id)`:
  - a **request** or an **empty folder** -> delete now (`removeNode` -> `persistTree(_,
    "delete")` + close affected tabs);
  - a **non-empty folder** -> set `pendingDelete` (dialog opens).
  - `confirmPendingDelete()` deletes + closes tabs + clears; `cancelPendingDelete()` clears.
  - Deleting closes every open tab among the node's `collectRequestIds`.
- Fresh-id source: a `nodeCounter` ref -> ids `new-<n>` (never the `draft-` prefix, so created
  tabs persist + are not treated as drafts).

### Surface wiring

- `src/components/ui/context-menu.tsx` (new) - shadcn-style wrapper over `radix-ui`'s
  `ContextMenu` (no new dep; `radix-ui` meta pkg already installed). No rounded corners
  (design.md).
- `TreeRow` wraps its row in `ContextMenu` and renders the inline-rename `<input>` when
  `renamingNodeId === node.id`; double-click triggers `beginRename`.
- `registry.ts` gains `new-folder`, `duplicate-request`, `rename-node`, `delete-node`.
- `Main` adds handlers for the four (resolving the target from `selectedNodeId` /
  `activeRequestId`); `delete-node` guards on `document.activeElement` not being an editable
  surface; the palette list picks them up automatically (it is built from `SHORTCUT_ACTIONS` x
  `handlers`).
- A `DeleteConfirmDialog` (mounted in `Main`) reads `pendingDelete`.

## 6. Edge Cases

- **Save a draft with no `onTreeChange`** (browser dev): the create still folds into the tree +
  swaps the tab id + toasts "Saved"; nothing is written. Mirrors `saveNodeConfig`.
- **Create placement when the target folder is collapsed**: auto-expand it so the new child is
  visible (folder create) / the new request would be visible.
- **Rename to a name that slugs to an existing sibling's slug**: allowed; `serialize`'s
  `uniqueSlug` disambiguates the path (`profile`, `profile-2`). No name-uniqueness constraint.
- **Rename blank / whitespace-only**: rejected, keeps the old name, no write.
- **Delete the active request / a folder containing it**: its tab(s) close; `activeRequestId`
  falls back like a normal close (next/prev/none).
- **Delete a node mid-rename**: clears `renamingNodeId` too.
- **Duplicate a request with unsaved overrides**: the copy reflects the **saved** (tree) node,
  not the session override (duplicate operates on the persisted tree). Documented.
- **`delete-node` while typing**: `Mod+Backspace` is a common delete-to-line-start gesture; the
  handler no-ops when an editable element is focused so it never hijacks text editing or fires
  a node delete from the URL bar / body / config editors.
- **Empty workspace** (`tree = []`): `new-request` / `new-folder` target root and create the
  first node; everything else has no target -> no-op.
- **jsdom**: behavior is verified at the pure (`tree-edit`) + provider (probe component driving
  context actions) layers + the dialog / inline-input / menu **render contracts** - not via raw
  right-click portal interaction or the real hotkey (consistent with the dnd + close-dialog
  testing approach already in the repo; see learnings).

## 7. Dependencies

- **No new npm deps.** `radix-ui` (meta pkg) already installed; it re-exports `ContextMenu`.
  `dialog.tsx` (Radix) already exists for the delete confirm.
- **No Rust / capability change** - `writeWorkspace` (write + mkdir + remove + remove-empty-dir)
  is already wired and permitted from the drag-move feature.
- **No on-disk format / `schemaVersion` change** - `serialize` regenerates paths + `order` from
  tree structure; reconcile already writes new files and removes orphaned files + empty dirs.

## 8. Out of Scope

- Duplicate folder, multi-select, cut/copy/paste, undo/redo.
- Name-uniqueness enforcement (slug disambiguation already handles path collisions).
- Reopening a just-created node's tab after a full app **restart** (its in-session synthetic id
  is replaced by a path-based id on the next disk reload, so it won't match the persisted open-
  tab id - the same accepted limitation a drag-move already has).

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-21 | Initial draft |
| 0.2.0 | 2026-06-21 | New request = create immediately (like new folder), draft system removed; create context-menu items moved to folder rows + empty area |
