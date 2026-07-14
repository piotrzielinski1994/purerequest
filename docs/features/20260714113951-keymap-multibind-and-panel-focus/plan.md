# Plan - Keymap multi-binding, removal, mac Option-record fix, panel focus

Approach follows the spec's Decision Log. TDD per task (RED subagent writes failing tests, main writes GREEN, then REFACTOR). Coverage threshold: **none**.

## File structure map

Create:
- `src/lib/shortcuts/record-hotkey.ts` - `eventToHotkey(event, platform)` (pure, mirrors the matcher) + `useRecordHotkey({onRecord,onCancel})` hook (own `event.code`-aware recorder replacing the library's). **Point 3 fix.**
- `src/lib/shortcuts/__tests__/record-hotkey.test.ts` - eventToHotkey units (TC-009/010) + recorder-behavior (TC-011).

Modify:
- `src/lib/shortcuts/registry.ts` - `ShortcutOverrides` value `string` → `string[]`.
- `src/lib/shortcuts/resolve.ts` - `resolveShortcuts` returns `Record<id, string[]>`; `findConflict` searches lists. (`safeNormalize` unchanged.)
- `src/lib/settings/settings.ts` - `mergeShortcuts` migrates legacy string→`[string]`, validates arrays, drops bad entries, keeps `[]`.
- `src/lib/settings/settings-context.tsx` - replace `saveShortcut` with `addShortcut`/`removeShortcut`; `resetShortcut` unchanged (deletes the key).
- `src/lib/shortcuts/use-action-hotkeys.ts` - one `UseHotkeyDefinition` per hotkey in each action's list; skip empty (disabled) lists.
- `src/lib/workspace/tree-keyboard.ts` - `TreeBindings` value `string[]`; `resolveTreeKey` matches if **any** binding in the list matches.
- `src/components/workspace/tree-nav.tsx` - `openContextMenuOnKey(event, bindings: string[])`; `TreeNavState.contextMenuBinding: string` → `contextMenuBindings: string[]` (default `["Shift+F10"]`).
- `src/components/workspace/tree-row.tsx` - use `contextMenuBindings`.
- `src/components/workspace/content-header.tsx` - `contextMenuBinding` prop → `contextMenuBindings: string[]`; resolve first-or-all; pass through.
- `src/components/workspace/sidebar-tree.tsx` - pass `bindings["open-context-menu"]` (now `string[]`) as `contextMenuBindings`; consume `pendingPanelFocus === "sidebar"`.
- `src/components/settings/shortcut-row.tsx` - chips (each with `x` → `removeShortcut`), `+ Add` (records via `useRecordHotkey`, conflict-checks, `addShortcut`), `Reset`, disabled state.
- `src/components/settings/shortcuts-section.tsx` - pass `bindings={effective[id]}` (array).
- `src/components/workspace/command-palette.tsx` - render the shortcut chip only when a binding exists.
- `src/components/workspace/main.tsx` - palette `binding = effective[id][0] ?? ""`; toggle handlers call `requestPanelFocus`.
- `src/components/workspace/workspace-context/types.ts` - add `PanelFocusTarget`, internals `pendingPanelFocus`/`setPendingPanelFocus`, value `pendingPanelFocus`/`requestPanelFocus`/`consumePanelFocus`.
- `src/components/workspace/workspace-context/index.tsx` - `pendingPanelFocus` state + thread into internals/value + the two callbacks.
- `src/components/workspace/console.tsx` - `<section tabIndex={-1} ref>`; focus on `pendingPanelFocus === "console"`.
- `src/components/workspace/content.tsx` - root `<div tabIndex={-1} ref>`; focus on `pendingPanelFocus === "content"`.

Test files to migrate (string→array seeds / effective assertions): `resolve.test.ts`, `settings.test.ts`, `settings-context.test.tsx`, `use-action-hotkeys.test.tsx`, `tree-keyboard.test.ts`, `tree-actions-registry.test.ts`, `shortcuts-section.test.tsx`, `command-palette*.test.tsx`, and any `shortcuts: {...}` seed in the workspace `__tests__` that stores a raw string (bruno/postman/curl/openapi-import, send-shortcut, close-others, tree-crud-shortcuts, settings-tab*, new-action-shortcuts, tab-keyboard-reorder, edit-ui-integration, scrollbar-wrapped-regions). Most only need the value wrapped in `[...]`.

## eventToHotkey algorithm (mirror of match.ts, the whole point of point 3)

```
key = normalizeKeyName(event.key)
if isModifierKey(key)                → null            // modifier-only, keep recording
if /^[A-Za-z]$/.test(key)            → use key         // ASCII letter: layout wins (Dvorak) - matcher trusts event.key
else, prefer event.code:                                // composed/dead/non-ascii-letter/punctuation
  code startsWith "Key"  + letter    → letter.toUpperCase()
  code startsWith "Digit"+ digit     → digit
  code in PUNCTUATION_CODE_MAP       → mapped char
  else if key==="Dead" or empty      → null
  else                               → key              // non-ascii letter w/o code help (Cyrillic): trust layout
then: rawHotkeyToParsedHotkey({key, ctrl,shift,alt,meta}, platform) → normalizeHotkeyFromParsed(parsed, platform)
```

Verified against match.ts: `⌘⌥P` (key="π",code="KeyP") → "Mod+Alt+P" (AC-009); Dvorak `⌘` +key="l",code="KeyP" → "Mod+L" not "Mod+P" (AC-010). Both reuse the library's own `normalizeKeyName`/`PUNCTUATION_CODE_MAP`/`rawHotkeyToParsedHotkey`/`normalizeHotkeyFromParsed` so canonical form is identical to the matcher's parse.

Recorder hook = document `keydown` capture listener (like the library's), `preventDefault`+`stopPropagation`, Escape→`onCancel`, modifier-only/`null`→ignore & keep listening, else `onRecord(hotkey)` and stop. `isRecording` state + `startRecording`/`cancelRecording`. Cleans up on unmount.

---

## Task 1: Array override model + resolve + migration

**Files:** Modify `registry.ts`, `resolve.ts`, `settings.ts`. Test `resolve.test.ts`, `settings.test.ts`, `tree-actions-registry.test.ts`.

**Interfaces:**
- Produces: `ShortcutOverrides = Partial<Record<ShortcutActionId, string[]>>`; `resolveShortcuts(o): Record<ShortcutActionId, string[]>`; `findConflict(hotkey, forAction, effective: Record<id,string[]>): ShortcutActionId | null`; `mergeShortcuts(unknown): ShortcutOverrides`.

- [ ] RED: `resolveShortcuts({})[id] === [default]` (TC-001); `["Mod+J","Mod+K"]` resolves to both, normalized; `[]` resolves `[]` (TC-004); bad entries dropped; `findConflict` self-in-list → null, other-owner → id (TC-006); `mergeShortcuts("Mod+B")→["Mod+B"]`, `["Mod+B","bogus!!"]→["Mod+B"]`, `42`→dropped, `[]`→`[]` (TC-007).
- [ ] GREEN: array reduce in `resolveShortcuts` (normalize each, absent→`[default]`, non-array→`[default]`, `[]`→`[]`); `findConflict` `.some(list.includes(target))` over other ids; `mergeShortcuts` wraps legacy string, filters arrays via `safeNormalize`, keeps `[]`.
- [ ] Commit `feat: AC-001/007 array keymap model + legacy migration`.

## Task 2: Own event.code recorder (point 3)

**Files:** Create `record-hotkey.ts` + test. Consumes library exports only.

**Interfaces:**
- Produces: `eventToHotkey(event: KeyboardEvent | {…}, platform): string | null`; `useRecordHotkey({onRecord:(h:string)=>void, onCancel?:()=>void}): {isRecording, startRecording, cancelRecording}`.

- [ ] RED: TC-009 (`⌘⌥P`→"Mod+Alt+P"), TC-010 (Dvorak→"Mod+L"), modifier-only→null, punctuation via code; TC-011 recorder fires `onRecord` with composed combo, Escape→`onCancel`, modifier-only records nothing.
- [ ] GREEN: implement algorithm above + capture-phase keydown hook.
- [ ] Commit `fix: AC-009/010 record hotkeys via event.code on mac Option`.

## Task 3: settings-context add/remove/reset over arrays

**Files:** Modify `settings-context.tsx`. Test `settings-context.test.tsx`.

**Interfaces:**
- Consumes: `resolveShortcuts`, `safeNormalize` (Task 1).
- Produces: `addShortcut(id, hotkey)`, `removeShortcut(id, hotkey)`, `resetShortcut(id)` on the context value. Removes `saveShortcut`.

- [ ] RED: add appends normalized (seed from `resolveShortcuts` when override absent) and dedups (E-1); remove filters (last → `[]`, AC-004); reset deletes the key (AC-005).
- [ ] GREEN: `update`-based callbacks computing next array from `resolveShortcuts(base.shortcuts)[id]`; update value type + memo deps.
- [ ] Commit `feat: AC-002/003/004/005 add/remove/reset keymappings`.

## Task 4: hotkey dispatch honors every binding

**Files:** Modify `use-action-hotkeys.ts`, `tree-keyboard.ts`, `tree-nav.tsx`, `tree-row.tsx`, `content-header.tsx`, `sidebar-tree.tsx`. Test `use-action-hotkeys.test.tsx`, `tree-keyboard.test.ts`.

**Interfaces:**
- Consumes: `resolveShortcuts` (Task 1).
- Produces: `TreeBindings = Partial<Record<id,string[]>>`; `openContextMenuOnKey(event, bindings: string[])`; `TreeNavState.contextMenuBindings: string[]`.

- [ ] RED: TC-002 both Ctrl+J and Ctrl+K fire toggle-console; TC-004 disabled `[]` never fires; `resolveTreeKey` matches any binding in a list; context-menu key matches any binding.
- [ ] GREEN: `flatMap` list→definitions (skip `[]`); `.some` matching in `resolveTreeKey` + `openContextMenuOnKey`; thread `contextMenuBindings` through nav/row/header/sidebar.
- [ ] Commit `feat: AC-002 every bound hotkey triggers its action`.

## Task 5: Shortcuts settings UI (chips + add/remove/reset/disabled)

**Files:** Modify `shortcut-row.tsx`, `shortcuts-section.tsx`. Test `shortcuts-section.test.tsx`.

**Interfaces:**
- Consumes: `useRecordHotkey` (Task 2), `addShortcut`/`removeShortcut`/`resetShortcut` (Task 3), `findConflict` (Task 1).

- [ ] RED: renders a chip per binding with a remove control; Add records then adds (AC-002); adding a conflicting hotkey shows the alert and does not add (AC-006); Remove drops one chip (AC-003); removing the last shows "(disabled)" (AC-004); Reset present only with an override, restores default (AC-005).
- [ ] GREEN: map bindings→chips (`formatForDisplay` + `x`→`removeShortcut`); `+ Add`→`startRecording`; `onRecord`→conflict check via `findConflict(hotkey, action.id, effective)` then `addShortcut`; disabled text when list empty; Reset when `hasOverride`.
- [ ] Commit `feat: AC-002/003/004/005/006 multi-binding shortcuts UI`.

## Task 6: Command palette shows first binding / none

**Files:** Modify `command-palette.tsx`, `main.tsx`. Test `command-palette*.test.tsx`.

**Interfaces:**
- Consumes: `resolveShortcuts` (arrays).

- [ ] RED: a disabled action's palette command renders no shortcut text but still runs (TC-008); a multi-binding action shows its first binding.
- [ ] GREEN: `binding = effective[id][0] ?? ""`; `CommandPalette` renders `CommandShortcut` only when `binding` non-empty.
- [ ] Commit `feat: AC-008 palette first-binding display`.

## Task 7: Focus a panel on toggle (point 4)

**Files:** Modify `workspace-context/types.ts`, `workspace-context/index.tsx`, `main.tsx`, `sidebar-tree.tsx`, `console.tsx`, `content.tsx`. Test a new integration test (mirror `toggle-theme-shortcut.test.tsx` harness).

**Interfaces:**
- Produces: `PanelFocusTarget = "sidebar" | "console" | "content" | null`; context `pendingPanelFocus`, `requestPanelFocus(t)`, `consumePanelFocus()`.

- [ ] RED: showing sidebar focuses the roving row (TC-012); showing console focuses the console `<section>` (TC-013); hiding a panel focuses the content region (TC-014).
- [ ] GREEN: consume-once flag in workspace-context; `main.tsx` toggle handlers call `requestPanelFocus(nextHidden ? "content" : "<panel>")`; SidebarTree effect focuses `rowRefs[rovingId]` on `"sidebar"`; Console `<section tabIndex=-1>` focuses on `"console"`; Content root `tabIndex=-1` focuses on `"content"`; each consumer calls `consumePanelFocus()` after focusing.
- [ ] Commit `feat: AC-011/012/013 focus panel on toggle`.

## Execution order

1 (model) → 2 (recorder, independent) → 3 (context, needs 1) → 4 (dispatch, needs 1) → 5 (UI, needs 1-3) → 6 (palette, needs 1) → 7 (focus, independent). Run full `npm test` after 4, 5, 7.

## Edge cases (from spec)

E-1 dedup on add; E-2 disabled `[]` skipped by dispatch/tree/context-menu + never a conflict owner; E-3 legacy migration; E-4 recorder ignores modifier-only; E-5 empty-tree sidebar focus no-op; E-6 palette & shortcut both route the toggle handler; E-7 findConflict normalized + self-excluded over lists.

## Risks

- Test-migration churn (~15 files store a raw string in `shortcuts`): mechanical wrap in `[...]`; run full suite after Task 4 to catch stragglers.
- Recorder/matcher divergence: mitigated by reusing the library's own key-normalization + `PUNCTUATION_CODE_MAP` and asserting the recorded string against `matchesKeyboardEvent` in a test.
- Panel-focus mount timing: consume-once flag (not nonce) chosen precisely because hidden panels unmount.

## Acceptance verification

Every AC maps to a TC (spec Test cases). Point 3 gets a recorder→matcher round-trip assertion. Point 4 gets three focus integration tests. Final: fresh-context verifier subagent runs lint + tsc + full `npm test`.

---

## AC traceability (post-implementation)

All ACs green. `npx vitest run` = 1881 passed (217 files); `tsc --noEmit` clean; `eslint .` 0 errors (9 pre-existing react-refresh warnings). Live-verified in the running app (chrome-devtools, MacIntel): PASS.

| AC | Test file / name |
| --- | --- |
| AC-001 | resolve.test.ts `should return every action's registry default as a one-element list...` + multi-binding.test.ts |
| AC-002 | use-action-hotkeys.test.tsx `should run the handler on each bound hotkey if the action has several`; tree-keyboard.test.ts `should honour any binding in a multi-binding tree action` |
| AC-003 | settings-context.test.tsx `should remove one binding but keep the rest...`; shortcuts-section.test.tsx `should persist the removal of one binding if its × is clicked` |
| AC-004 | use-action-hotkeys.test.tsx `should not run the handler if the action is disabled with an empty list`; settings-context.test.tsx `should disable the action with an empty list if the last binding is removed` |
| AC-005 | settings-context.test.tsx `should remove the override entirely if resetShortcut is called`; shortcuts-section.test.tsx `should remove the override and restore the default if reset is clicked` |
| AC-006 | multi-binding.test.ts findConflict block (other-owner / self-null / disabled-never-owner); shortcuts-section.test.tsx `should name the owning action and not persist if a used combo is recorded` |
| AC-007 | merge-shortcuts.test.ts + settings.test.ts mergeShortcuts (legacy string migrate / drop bad entry / non-array dropped / `[]` persists / unknown id) |
| AC-008 | command-palette.test.tsx `should render a disabled action's row with no shortcut but still run it` |
| AC-009 | record-hotkey.test.ts `should record the physical combo if the key composes under mac Option` + `...the matcher fires on...` (round-trip) |
| AC-010 | record-hotkey.test.ts `should trust the layout key from event.key if the key is an ASCII letter` |
| AC-011 | panel-focus-toggle.test.tsx `should focus the roving sidebar tree row if the sidebar is toggled from hidden to visible` |
| AC-012 | panel-focus-toggle.test.tsx `should focus the console region if the console is toggled from hidden to visible` |
| AC-013 | panel-focus-toggle.test.tsx `should focus the content region if a visible panel is toggled hidden` |
| E-2 | multi-binding.test.ts `should not report a disabled action as a conflict owner`; tree-keyboard.test.ts `should be a no-op for a disabled tree action's former default key`; open-context-menu-key.test.tsx `should not open the menu for the former key if the binding list is empty` |

**Deviations from plan:** none material. Added a dedicated `open-context-menu-key.test.tsx` + two tree-keyboard E-2/multi cases after the verifier flagged the disabled-`[]` sub-cases as unpinned (spec lists E-2 explicitly).
