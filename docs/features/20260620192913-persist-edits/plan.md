# Plan: Persist Edits

Implements [spec.md](spec.md). TDD, red-green-refactor. Coverage threshold: none.

## Approach

Reuse the existing tree-write seam end to end. Saving a request's url/method/body is the
same shape as `saveNodeConfig`: pure tree update -> `setTree` -> `onTreeChange` (persist)
-> clear the session override. Dirtiness is **derived** (override differs from tree node),
not stored. Close interception is a small state machine (`pendingClose`) feeding one
reusable confirm Dialog. Editor-saver keeps precedence by having `saveActiveEditor()` report
whether it ran, so `Main` falls back to the request save only when no editor is registered.

No on-disk format change, no new deps, no Rust change.

## Files

### Create

- `src/lib/workspace/update-request.ts` - pure
  `updateRequest(tree, id, patch): TreeNode[]` (mirrors `update-config.ts`).
- `src/components/workspace/close-confirm-dialog.tsx` - confirm Dialog reading `pendingClose`
  from context (Cancel / Discard). Square corners, no rounded.
- Tests:
  - `src/lib/workspace/__tests__/update-request.test.ts` (pure fn).
  - `src/components/workspace/__tests__/persist-edits-context.test.tsx` (provider:
    save, dirty set, precedence flag, close interception).
  - `src/components/workspace/__tests__/close-confirm-dialog.test.tsx` (dialog render +
    confirm/cancel wiring).

### Modify

- `src/components/workspace/workspace-context.tsx`
  - Add `dirtyRequestIds: Set<string>` (derived in the value memo; override vs tree node,
    excludes drafts + equal-to-base).
  - Add `saveActiveRequest()` (fold override -> tree via `updateRequest`, clear override,
    persist, toast/console exactly like `saveNodeConfig`).
  - Change `saveActiveEditor` to **return boolean** (`editorSaverRef.current` ran or not).
  - Add `pendingClose` state + `requestCloseRequest(id)`, `requestCloseAll()`,
    `confirmPendingClose()`, `cancelPendingClose()`. Expose `pendingClose` + these on context.
  - Extend `WorkspaceContextValue` type accordingly.
- `src/components/workspace/main.tsx`
  - `save-active-editor` handler: `if (!saveActiveEditor()) saveActiveRequest();`
  - `close-request` handler -> `requestCloseRequest(activeRequestId)` (still close settings
    first when settings active). `close-all-requests` -> `requestCloseAll()`.
  - Mount `<CloseConfirmDialog />`.
- `src/components/workspace/content-header.tsx`
  - Dirty dot beside the name (consume `dirtyRequestIds`); tab `X` -> `requestCloseRequest(id)`.
- `docs/learnings.md` - one entry on the dirty-derivation + editor-saver-precedence flag.
- `README.md` - amend the URL/body line ("edits live in session memory only ... not written
  back to disk") to note `Mod+S` now persists a saved request's url/method/body, with a dirty
  dot + confirm-on-close.

## Execution order (TDD)

1. RED: spawn test-writer subagent (fresh context) from spec ACs/TCs.
2. GREEN per AC:
   - AC-001/007: `updateRequest` + `saveActiveRequest` + persist/console.
   - AC-002/003: `saveActiveEditor` boolean + `Main` fallback.
   - AC-004: `dirtyRequestIds` + dot in `ContentHeader`.
   - AC-005/006/008: `pendingClose` machine + `CloseConfirmDialog` + close routing + draft guard.
3. REFACTOR: dedupe the persist-then-toast-or-console block shared by `saveNodeConfig` /
   `saveActiveRequest` if it reads cleanly; tighten types.
4. VERIFY: fresh verifier subagent against ACs + gates (lint, typecheck, full `npm test`).

## Acceptance verification

- `npm run lint`, `npm run typecheck`, `npm test` all green.
- Per-AC test mapping filled into the task notes after verifier passes.
- Manual smoke (`npm start`): edit url/body, dot appears, `Mod+S` saves (survives reload),
  close dirty -> confirm. Shut the app down after.

## AC traceability (verified - 558 tests green, typecheck + lint clean)

| AC | Test |
| -- | ---- |
| AC-001 | update-request.test.ts (patch/nested/preserve) + persist-edits-context "should persist a tree that round-trips to the edited values..." |
| AC-002 | persist-edits-context "should return false if no editor-saver is registered and true if one is" + main.tsx fallback |
| AC-003 | same boolean-flag test + request-settings-tab.test.tsx (config save via editor-saver) |
| AC-004 | persist-edits-context "should drop a request from the dirty set if its edit is reverted..." / "...only the edited saved request..." + content-header.test.tsx "should show an unsaved-changes marker on a tab..." |
| AC-005 | close-confirm-dialog.test.tsx (show/cancel/discard) + persist-edits-context close-interception block |
| AC-006 | close-confirm-dialog.test.tsx "should show the dirty-request count..." / "should close every tab if Discard..." + persist-edits-context "should set a kind:all..." / "should close all immediately..." |
| AC-007 | persist-edits-context "should fold url/method/body into the tree and persist..." / "...if no onTreeChange..." / "should append the console line and clear dirty if onTreeChange fails" |
| AC-008 | persist-edits-context "should mark an edited draft dirty but still no-op when saving it" / "should close a pristine draft immediately..." / "should prompt to confirm if an edited draft is closed" |
| AC-009 | editor-dirty-context "should mark the request dirty if its config editor is dirty" / "...not...if...matches the saved config" / "...clear...if the dirty config editor unmounts" |
| AC-010 | editor-dirty-context "should report editorDirty if the .env editor is dirty" |
| AC-011 | editor-dirty-context "should prompt to confirm if a dirty editor is closed" / "should not prompt if a clean editor is closed" |
| AC-012 | editor-dirty-context "should prompt to confirm if a request with a dirty config editor is closed" |
| AC-013 | editor-dirty-context "should run the active editor save and return true, false when none mounted" |

v0.2.0 (every editor surface): the editor channel is `registerActiveEditor({scope,isDirty,save})` in provider state; one editor mounts at a time. New files: editor-dirty-context.test.tsx. Modified: config-editor.tsx, env-editor.tsx (register descriptor via a saveRef-in-effect to dodge the update-depth cascade), workspace-context.tsx (ActiveEditor type, dirtyRequestIds+editorDirty, requestCloseEditor + PendingClose editor variant), content-header.tsx (editor-tab dot), main.tsx (Mod+W routes editor close). 567 tests green.

| AC-014 | request-settings-tab.test.tsx "should show the full request as raw JSON" / "should persist the edited full request when Save is clicked" / "should re-sync the Body tab if the body is edited via the Settings JSON" / "should disable Save if the Settings JSON is %s" (6 invalid cases) + update-request.test.ts "should patch the request name and config if supplied" |

v0.3.0 (request Settings = whole request): request Settings tab edits `{name,method,url,body,config}` (folder config pane stays config-only). `RequestPatch` widened to name|url|method|body|config; `config-editor.tsx` factors a generic `RawJsonEditor<T>` reused by `ConfigEditorForm` (folder) + new `RequestSettingsForm` (request, `parseRequest` validation). New provider `saveRequestNode(id,patch)` clears the override (Body/URL re-sync) then persists; draft no-op. 575 tests green.

## Risks

- `saveActiveEditor` return-type change could ripple to existing callers: only `Main` and the
  `use-action-hotkeys` tests reference it - audit both. Mitigation: keep the no-arg signature,
  only add a return value (existing `() => saveActiveEditor()` callers ignore it).
- Close routing must not regress the settings-tab close path. Mitigation: keep the
  `isSettingsActive -> closeSettings()` branch ahead of `requestCloseRequest`.
