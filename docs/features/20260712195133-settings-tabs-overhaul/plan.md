# Plan: Settings tab overhaul

Spec: [spec.md](./spec.md). Branch: `20260711223640-keyboard-tree-navigation` (same
session). Coverage threshold: none. Architecture: **synthetic settings id** in the
existing `openRequestIds` list (user-chosen).

## Approach

### #1 Sub-tabs (AC-001/002)
`shortcuts-section.tsx` + `theme-section` + `env-section` already exist as separate
components. Replace the single scrolling stack in `content.tsx`'s settings body with a
`Tabs` primitive strip mirroring the request-pane pattern:
- Bar: `flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30` + `TabsList`
  with `PANE_TABS_LIST` / `PANE_TABS_TRIGGER` (from `pane-tabs.ts`).
- Triggers: Theme / Env / Shortcuts. Bodies wrapped in `TabsContent`, each scroll-area'd.
- New component `settings-view.tsx` owns this; `content.tsx` renders `<SettingsView />`.
- Active section persisted: add `settingsSection?: "theme" | "env" | "shortcuts"` to the
  Settings model + a setter on the settings store (mirror `activeEnvironment`/`consoleHidden`
  device-local UI state). Fallback to `"theme"` on missing/invalid.

### #2/#3 Settings tab parity (AC-003..007)
Introduce `export const SETTINGS_TAB_ID = "__settings__"` (in a shared module, e.g.
`pane-tabs.ts` or a new `tabs.ts`). Fold Settings into the ordered tab list:

- `openSettings()` -> ensure `SETTINGS_TAB_ID` is in `openRequestIds` (append if absent),
  set it active (`activeRequestId = SETTINGS_TAB_ID`), drop the separate `isSettingsActive`
  boolean in favour of `activeRequestId === SETTINGS_TAB_ID`. Keep `isSettingsOpen` derived
  = `openRequestIds.includes(SETTINGS_TAB_ID)`.
- `content-header.tsx`: the `SortableContext` items already = `openRequestIds` (now includes
  the settings id). In the `.map`, when `id === SETTINGS_TAB_ID` render a `<SettingsTab>`
  (a sortable wrapper + label + close + ContextMenu) instead of `<RequestTab>`; else the
  request lookup. Remove the separate bottom `{isSettingsOpen && ...}` settings-tab block.
- Reorder (AC-005): flows through the existing `reorderRequests`/DnD/KeyboardSensor with no
  change - the synthetic id sorts like any other. `reorderRequests` already validates a
  permutation.
- Close (AC-007): `closeRequest(SETTINGS_TAB_ID)` reuses the request close path (adjacent
  activation). Guard the request-specific bits (`requestsById.get`, overrides/drafts) so a
  settings id close doesn't touch request maps.
- Context menu (AC-006): `SettingsTab` wraps its row in the same `ContextMenu` +
  `openContextMenuOnKey(event, contextMenuBinding)` as `RequestTab`. Items: Close, Close
  other tabs, Close all (same handlers, keyed by the settings id).
- `activeScopeId` / env-border memo: treat `activeRequestId === SETTINGS_TAB_ID` as "no
  request scope" (null), replacing the `isSettingsActive` check.
- Persistence: `SETTINGS_TAB_ID` must be **excluded** from the on-disk `persistableIds`
  filter (it is not a request/draft) OR persisted+restored as a UI flag. Simplest: keep it
  out of persisted open ids; reopen fresh each launch (matches "device-local, not synced").
  Confirm current filter already drops unknown ids (it filters to known/draft) - so it is
  dropped for free; a restore of the settings tab is out of scope.

### #2 "vanishing" root cause
Today `setActiveRequest` sets `isSettingsActive=false` but leaves `isSettingsOpen=true`, so
the tab *should* stay. The reported disappearance is because activating a request goes
through `selectNode` (tree click) which does NOT touch settings, yet the tab only renders
under the separate `{isSettingsOpen && ...}` block positioned AFTER the editor block -
verify whether an interaction sets `isSettingsOpen=false`. The unified-id model removes the
separate block entirely, fixing it structurally regardless of the exact trigger.

## Files

**New**
- `src/components/workspace/settings-view.tsx` - the sub-tabbed settings body.
- `src/components/workspace/settings-tab.tsx` (or inline in content-header) - the sortable
  Settings tab chip with close + context menu.
- Tests: `settings-view.test.tsx` (sub-tabs), `settings-tab.test.tsx` (persist/reorder/menu/close).

**Modified**
- `src/lib/settings/settings.ts` (+ model type, DEFAULT) - `settingsSection` field.
- `src/lib/settings/settings-context.tsx` - setter + expose it.
- `src/lib/settings/tauri-store.ts` / in-memory store - persist `settingsSection`.
- `src/components/workspace/workspace-context.tsx` - `SETTINGS_TAB_ID` handling in
  openSettings/closeSettings/closeRequest/closeOthers/closeAll/setActiveRequest, derive
  `isSettingsOpen`/`isSettingsActive`, guard request-map ops against the synthetic id,
  fix `activeScopeId`.
- `src/components/workspace/content-header.tsx` - render `SettingsTab` for the synthetic id
  inside the existing SortableContext; delete the standalone settings-tab block.
- `src/components/workspace/content.tsx` - render `<SettingsView />` (sub-tabs) for the
  settings body; keep `max-w-3xl` inside each section as needed.
- `src/components/workspace/pane-tabs.ts` (or new `tabs.ts`) - export `SETTINGS_TAB_ID`.

## Edge cases (from spec §5)
- Invalid persisted section -> `"theme"`.
- Settings sole tab closed -> empty content (existing last-tab-closed path).
- Reorder sole tab -> no-op (existing).
- Guard every `requestsById`/override/draft access in close paths against `SETTINGS_TAB_ID`.
- `Esc` (close-settings): keep current semantics = deactivate/return to workspace; does NOT
  close the tab. Re-map `closeSettings` to "activate the previous non-settings tab" instead
  of tearing down. Confirm against the `close-settings` shortcut handler in main.tsx.

## Tests (>=1 per AC)
- AC-001 TC-001: settings-view renders Theme/Env/Shortcuts tablist; clicking Env swaps body.
- AC-002 TC-002: selecting a section calls the store setter; restored on remount.
- AC-003 TC-003: open request + settings, activate request -> settings tab still present.
- AC-004 TC-004: re-activate settings -> same section.
- AC-005 TC-005: reorder settings past a request (unit via reorderRequests + a behavior/e2e
  keyboard drag) -> order changes.
- AC-006 TC-006: Shift+F10 / right-click settings tab -> Close menu; Close removes it.
- AC-007 TC-007: close active settings tab -> adjacent activates.
- AC-008 TC-008: Mod+Shift+S opens; Esc returns to workspace (tab stays).
- AC-009: full gate suite.

## Risks
- Folding a synthetic id into `openRequestIds` risks request-only code paths dereferencing
  it (`requestsById.get(SETTINGS_TAB_ID)` -> undefined). Mitigation: audit every
  `openRequestIds` consumer + guard. This is the main regression surface - the full vitest
  suite (many tab tests) is the safety net.
- e2e keyboard reorder of a non-request tab: same dnd-kit live-region timing as the tab
  feature; reuse that pattern.
