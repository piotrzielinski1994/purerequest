# Spec: Persist Edits (flush session url/method/body to disk)

**Version:** 0.2.0
**Created:** 2026-06-20
**Status:** Implemented

> v0.2.0 (user feedback): the dirty-dot + confirm-on-close were originally only on
> saved-request url/method/body, which read as inconsistent (config edits and drafts
> showed nothing). Scope widened so **every unsaved edit surface** gets the dot +
> confirm: saved-request url/method/body, request/folder **config** editors, the **.env**
> editor, and **drafts**. See AC-009..AC-013. Drafts still cannot be persisted to disk
> (that is feature `tree-crud`); the dot + confirm only guard against silent loss.
>
> v0.3.0 (user feedback): the request **Settings** tab edited only `config`, so `body`
> (and url/method/name) were invisible there - users expected Settings to show the whole
> request. The request Settings tab now edits the full request JSON
> `{name, method, url, body, config}` (folder config pane stays config-only). Saving a new
> body/url/method clears the session override so the Body tab + URL bar re-sync. See AC-014.

## 1. Overview

Today a request's url/method/body edits live in `requestOverrides` (session-only,
keyed per request id, lost on reload). Only moves, config-JSON edits, and `.env` are
written to disk. This feature adds a **save path for the active request's url/method/body**,
reusing the existing tree-write seam (`onTreeChange` -> `serialize` -> `writeWorkspace`),
plus a **dirty indicator** on the tab and a **confirm-on-close** guard for unsaved edits.

It is the foundational write path the next feature (`tree-crud`) builds on.

### Scope boundary

- **In:** saving url/method/body of a **saved (on-disk) request** that has pending edits.
- **Out:** saving **drafts** (`draft-*`). A draft has no file yet; promoting a draft to a
  `*.req.json` is the `tree-crud` feature (create request). Drafts are never marked dirty,
  saving is a no-op for them, and closing a draft stays silent (as today).
- **Out:** saving config (already done via `saveNodeConfig`), `.env` (already done), or
  the request name (no UI to edit it yet).

### Decisions captured (user)

- **Save trigger:** reuse `save-active-editor` (`Mod+S`) + command palette. No new action,
  no new binding. When a request tab is active and **no** config/`.env` editor-saver is
  registered, `Mod+S` saves the request's url/method/body. When a config/`.env` editor
  **is** registered (request Settings sub-tab, folder config pane, `.env` editor), it wins
  (saves that editor) - the editor-saver channel keeps precedence.
- **Dirty marker:** a dirty dot **beside the tab name**; the close `X` is always shown.
- **Close with unsaved edits:** **confirm before discarding** (Dialog: Cancel / Discard).

## 2. Acceptance Criteria

- AC-001: Editing the url, method, or body of a **saved** request and triggering save writes
  those fields back to that request's `*.req.json` via the existing write path; re-reading
  the workspace reproduces the saved values.
- AC-002: Save is triggered by the `save-active-editor` action (default `Mod+S`, also in the
  command palette) when a request tab is active and no config/`.env` editor-saver is
  registered. No new shortcut is added.
- AC-003: When a config/`.env` editor-saver **is** registered (request Settings sub-tab,
  folder config pane, or `.env` editor active), `Mod+S` saves **that** editor, not the
  request (editor-saver precedence preserved).
- AC-004: A saved request whose pending url/method/body differ from its on-disk values shows
  a dirty dot beside its tab name. The dot clears after a successful save and also when the
  edits are reverted to match disk (override equals base -> not dirty).
- AC-005: Closing a **dirty** saved request tab (tab `X` or the `close-request` shortcut)
  opens a confirm dialog. **Discard** closes the tab and drops the edits; **Cancel** keeps
  the tab and its edits. A non-dirty request closes immediately (no dialog).
- AC-006: `close-all-requests` opens the confirm dialog **once** if any open request is dirty.
  **Discard** closes all (and the settings tab, as today); **Cancel** keeps everything.
- AC-007: A successful save folds the edit into the in-memory tree and clears the override, so
  the value survives tab switches and the request is no longer dirty. A **failed** disk write
  keeps the edit in-memory (tree already updated) and appends a console line
  `[workspace] failed to persist edits: <err>` (best-effort persistence; in-memory is the
  session source of truth - mirrors `saveNodeConfig` / `moveNode`).
- AC-008: A draft (`draft-*`) that has been edited (url/method/body no longer the pristine
  empty `GET`/``/``) is marked **dirty** (dot + confirm-on-close), but **save is still a
  no-op** for it (a draft has no file - real persistence is `tree-crud`). An unedited
  (pristine) draft is not dirty and closes silently.

### v0.2.0 - every editor surface (consistency)

- AC-009: While a **config editor is mounted and its content differs from the node's saved
  config** (request Settings sub-tab, or folder config pane), the owning node shows a dirty
  marker - a request's marker on its tab, a folder's marker on the "config" editor tab. The
  marker clears when the edit is saved (`Mod+S` / Save) or reverted to match the saved config.
- AC-010: While the **`.env` editor** content differs from the saved `.env` text, the ".env"
  editor tab shows a dirty marker; it clears on save or revert-to-saved.
- AC-011: Closing a tab/editor with unsaved editor content opens the confirm dialog: closing a
  **request** tab whose config sub-tab is dirty, closing the **folder config** or **`.env`**
  editor tab (its `X` or `Mod+W`), all route through the confirm. Discard drops the edit and
  closes; Cancel keeps it.
- AC-012: `dirtyRequestIds` and the close guards treat a request as dirty if **either** its
  url/method/body override differs **or** its mounted config editor is dirty. `close-all`
  prompts once if any open request is dirty by either measure.
- AC-013: Only **one** editor is ever mounted at a time (the editor channel holds a single
  active-editor descriptor `{ scope, isDirty, save }`); `saveActiveEditor()` saves it and
  returns `true`, else `false` (request url/method/body fallback unchanged).

### v0.3.0 - request Settings edits the whole request

- AC-014: The request **Settings** sub-tab shows the full request as one JSON doc
  `{name, method, url, body, config}` (seeded from the node), editable + saved back to the
  `*.req.json` via the existing write path. Invalid JSON (not an object, missing/!string
  name/url/body, bad method, non-object config) disables Save. Saving a changed body/url/method
  clears that request's session override so the **Body** tab and **URL bar** re-sync to the
  saved values. A **folder**'s config pane is unchanged (config-only - a folder has no
  url/body/method). Drafts: save is still a no-op (no file yet).

## 3. User Test Cases

- TC-001 (save happy, persist+reload): open a saved request, edit url + method + body, press
  `Mod+S` -> the override is folded into the tree, `onTreeChange` fires with the updated tree;
  re-serializing + re-deserializing reproduces the new url/method/body. Maps to: AC-001, AC-007.
- TC-002 (editor precedence): on the request **Settings** sub-tab (config editor mounted),
  `Mod+S` saves the config (existing saver runs), the request url/method/body is NOT written.
  On the **Body** sub-tab (no config editor mounted), `Mod+S` saves the request. Maps to:
  AC-002, AC-003.
- TC-003 (dirty marker lifecycle): edit a saved request -> dot appears beside its tab name ->
  revert the edit to the original value -> dot disappears -> edit again + save -> dot
  disappears. Maps to: AC-004.
- TC-004 (close dirty -> confirm -> cancel): edit a saved request, close its tab -> dialog
  shown -> Cancel -> tab still open, edit intact. Maps to: AC-005.
- TC-005 (close dirty -> confirm -> discard): edit a saved request, close its tab -> dialog
  shown -> Discard -> tab closed, override dropped; reopening shows the on-disk value. Maps
  to: AC-005.
- TC-006 (close clean, no dialog): open a saved request with no edits, close it -> no dialog,
  closes immediately. Maps to: AC-005.
- TC-007 (close-all with a dirty tab): two open requests, one dirty, `close-all-requests` ->
  dialog shown once -> Discard -> both closed. Cancel -> both kept. Maps to: AC-006.
- TC-008 (persist failure): saving when `onTreeChange` returns `{ok:false}` -> the tree keeps
  the edit, request is no longer dirty, a `[workspace] failed to persist edits: ...` console
  line is appended. Maps to: AC-007.
- TC-009 (draft excluded): a draft tab is never dirty (editing it adds no dot), `Mod+S` on a
  draft writes nothing to disk, and closing a draft shows no confirm dialog. Maps to: AC-008.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Clean request tab | Name, method glyph, always-visible `X`. No dot. |
| Dirty request tab | A `size-2` dot left of the name (design.md status-dot exception); `X` still shown. |
| Save (no editor-saver) | `Mod+S` / palette -> write request to disk -> toast "Saved"; dot clears. |
| Save (editor-saver present) | `Mod+S` saves the config/`.env` editor; request untouched. |
| Save failed (disk) | Toast "Save failed: <err>"; console line; in-memory edit kept; dot clears. |
| Close dirty | Confirm dialog (Cancel / Discard). |
| Close clean / draft | Closes immediately, no dialog. |

### ASCII wireframe - dirty tab marker (dot beside name, X always shown)

```
+---------------------------------------------------------------+
|  GET req-a              x  | * POST req-b           x  | ...   |
|  ^ clean (no dot)            ^ dirty (dot before name)         |
+---------------------------------------------------------------+
```

### ASCII wireframe - confirm-on-close dialog

```
+------------------------------------------+
|  Discard unsaved edits?                  |
|                                          |
|  req-b has unsaved changes that will be  |
|  lost.                                   |
|                                          |
|                    [ Cancel ] [ Discard ]|
+------------------------------------------+
```

### ASCII wireframe - confirm-on-close-all (any dirty)

```
+------------------------------------------+
|  Discard unsaved edits?                  |
|                                          |
|  2 open requests have unsaved changes    |
|  that will be lost.                      |
|                                          |
|                    [ Cancel ] [ Discard ]|
+------------------------------------------+
```

## 5. Data Model

No on-disk format change (url/method/body already live in `*.req.json`; `serialize`
already writes them). Pure helper + provider state only.

### Pure layer (`src/lib/workspace`)

- `updateRequest(tree, id, patch: Partial<Pick<RequestNode,"url"|"method"|"body">>): TreeNode[]`
  - New pure fn mirroring `updateNodeConfig`. Returns a new tree with the matching **request**
    node's url/method/body patched (recurses into folders; no-op if id is missing or a folder).

### Provider state / API (`WorkspaceProvider`)

- `dirtyRequestIds: Set<string>` (derived in the value memo): ids that have a `requestOverride`
  whose url/method/body differs from the matching **tree** node's value. Excludes drafts (a
  draft id has no tree node) and overrides that equal the base.
- `saveActiveRequest(): void`
  - If `activeRequestId` is a dirty **tree** request: fold its override into the tree via
    `updateRequest`, clear that override, persist via `onTreeChange` (toast "Saved" on ok /
    "Save failed" + console line on `{ok:false}`; toast "Saved" in-memory when no `onTreeChange`).
    No-op for drafts / non-dirty / no active request.
- `saveActiveEditor(): boolean` (changed return type)
  - Runs the registered editor-saver if any; returns `true` when one ran, `false` otherwise.
    Lets `Main` decide precedence without leaking editor internals.
- Close interception: a `pendingClose: { kind: "one"; id: string } | { kind: "all" } | null`
  state + `requestCloseRequest(id)` / `requestCloseAll()` that check dirtiness:
  - clean -> call `closeRequest(id)` / `closeAllRequests()` directly;
  - dirty -> set `pendingClose` (dialog opens).
  - `confirmPendingClose()` executes the underlying close + clears `pendingClose`;
    `cancelPendingClose()` just clears it.

### Orchestration (`Main`)

- `save-active-editor` handler becomes: `if (!saveActiveEditor()) saveActiveRequest();`
  (editor-saver wins; otherwise save the request).
- `close-request` handler routes through `requestCloseRequest`; `close-all-requests` through
  `requestCloseAll`. The tab `X` (`ContentHeader`) routes through `requestCloseRequest` too.
- A `CloseConfirmDialog` is mounted in `Main` (always mounted, has context) reading
  `pendingClose`.

## 6. Edge Cases

- **Override equals base** (typed then reverted): not dirty (no dot), save is a no-op.
- **No active request / settings app-tab active**: `Mod+S` is a no-op for the request path
  (and saves the app-settings editor only if one is registered - unchanged).
- **`onTreeChange` absent** (browser `npm run dev`, no Tauri host): in-memory save succeeds,
  toast "Saved", nothing written - consistent with `saveNodeConfig`.
- **Disk write fails** (perms): tree keeps the edit, override cleared, console line appended,
  dot clears (in-memory is truth). Mirrors `moveNode` / `saveNodeConfig`.
- **Draft active**: `saveActiveRequest` no-op; draft never dirty; closing a draft silent.
- **Close-all with mixed draft + dirty**: confirm only about dirty **tree** requests; drafts
  are disposed regardless (as today). If no tree request is dirty, no dialog even if drafts
  were edited.
- **Save while on the Settings sub-tab**: the config editor-saver is registered, so `Mod+S`
  saves config; pending url/method edits (URL bar is always visible) are not written until the
  user is on a non-config sub-tab and presses `Mod+S` again. Accepted (matches the chosen
  editor-saver precedence).
- **jsdom**: behavior is tested at the provider/pure layer (probe component driving context
  actions) + the dialog render contract, not via the real hotkey (the hotkey->handler binding
  is already covered by `use-action-hotkeys` tests; see learnings on `saveActiveEditor`).

## 7. Dependencies

- No new npm deps. `dialog.tsx` (Radix) already exists for the confirm dialog.
- No Rust / capability change (write path + `writeWorkspace` already wired and permitted).
- No on-disk format / `schemaVersion` change.
