# Spec: Settings tab overhaul (sub-tabs + full tab parity + context menu)

**Created:** 2026-07-12
**Status:** DONE - all gates green (typecheck 0, lint 0 errors, vitest 1797/1797, cargo 63/63,
e2e 8/8), all 5 reported symptoms (A-E) verified live in a real browser via Playwright.
**Note:** distinct feature from keyboard-tree-navigation, but developed on the same
branch (`20260711223640-keyboard-tree-navigation`) per the single-chat-single-branch rule.

## Overview

Three gaps in the Settings surface, reported from the running app:

1. **No sub-tabs.** Settings is one long scroll of Theme / Env / Keyboard Shortcuts.
   It should have a section switcher, mirroring the existing in-app tab patterns
   (the request-pane `Vars/Auth/Headers/...` strip and the Path/Query sub-bar) rather
   than a bespoke design.
2. **Settings tab does not persist like a request tab.** Switching to a request tab
   removes the Settings tab entirely; it should stay open (deactivated, not closed) and
   be reorderable + closable exactly like a request tab.
3. **No context menu.** A request tab has a right-click menu (Close / Close others /
   Close all); the Settings tab has none.

The user chose **full request-tab parity** for #2/#3. On closer inspection the reported
symptoms are all facets of "Settings is not a real tab" (it lives in separate boolean
state, not `openRequestIds`):

- **A. Esc destroys the tab.** `close-settings` (Esc) removes the Settings tab entirely; it
  should only DEACTIVATE (return to the workspace), staying open like a request tab until
  explicitly closed (X / Mod+W).
- **B. Not draggable.** The Settings tab is rendered outside the `SortableContext`, so it
  cannot be reordered.
- **C. No context menu** (so no "Close other tabs" / "Close all" from it).
- **D. Asymmetric conflict.** A request tab's "Close other tabs" is *disabled* when Settings
  is the only other tab, because `canCloseOthers` counts only `openRequestIds` and Settings
  is not in it - so Settings is treated as not-a-tab.
- **E. Dead click zones on tabs (ALL tab kinds).** Parts of a tab chip are unclickable (the
  grab cursor shows but clicking does nothing) because the activate `onClick` sits only on
  the inner `<button>`, while the wrapper padding carries only the drag listeners.

A–D are fixed by folding Settings into `openRequestIds` via the synthetic id. E is a
separate tab-chip fix that applies to every tab.

## Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | The Settings view has a section switcher (Theme / Env / Shortcuts) styled like the existing request-pane tab strip (`Tabs` primitive, `PANE_TABS_LIST`/`PANE_TABS_TRIGGER`, `h-10.25 border-b bg-muted/30` bar); only the selected section's body renders | Must |
| AC-002 | The active Settings section persists per-installation (survives close/reopen of Settings and app restart), stored in `settings.json` like other device-local UI state | Should |
| AC-003 | Opening a request tab while Settings is open leaves the Settings tab present (deactivated), not removed | Must |
| AC-004 | Re-clicking the Settings tab re-activates it with its last-viewed section | Must |
| AC-005 | The Settings tab is keyboard+pointer **reorderable** within the tab strip, alongside request tabs, and the order persists (same `reorderRequests`/KeyboardSensor path) | Must |
| AC-006 | The Settings tab has a context menu (Shift+F10 / right-click) with Close (and, where meaningful, Close other tabs / Close all) using the same `open-context-menu` binding + Radix ContextMenu as request tabs | Must |
| AC-007 | Closing the Settings tab (its X, `Mod+W` when active, Close-all) removes it and returns focus to an adjacent tab, mirroring request-tab close | Must |
| AC-008 | `Mod+Shift+S` still opens/activates Settings; `Esc` (close-settings) still returns to the workspace without closing the tab (or closes per current semantics - resolve in plan) | Must |
| AC-009 | Esc (close-settings) DEACTIVATES Settings (returns to workspace) but leaves its tab open; the tab is removed only by X / Mod+W / close-all (symptom A) | Must |
| AC-010 | A request tab's "Close other tabs" counts the Settings tab too: with a request + Settings open, "Close other tabs" is enabled and closes Settings; and Settings' own menu can close the others (symptom D) | Must |
| AC-011 | The entire tab chip is clickable to activate (the activate hit-area covers the wrapper, not just the inner label) - fixes dead zones on all tab kinds (symptom E) | Must |
| AC-012 | `npm run lint`, `npm run typecheck`, `npm test`, `cargo test` all exit 0; existing settings/tab tests updated (behavior intentionally changed for Esc), not deleted | Must |

## Test Cases

- TC-001 (AC-001): open Settings -> a tablist with Theme/Env/Shortcuts; clicking Env shows the Env editor, hides Theme.
- TC-002 (AC-002): select Env, close+reopen Settings -> Env still selected; (unit) the section persists via the settings store.
- TC-003 (AC-003): open a request + Settings, click the request tab -> Settings tab still in the strip, deactivated.
- TC-004 (AC-004): from TC-003, click Settings tab -> active again, same section as before.
- TC-005 (AC-005): with Settings + >=1 request open, reorder Settings past a request (drag + keyboard) -> order changes + persists.
- TC-006 (AC-006): right-click / Shift+F10 the Settings tab -> Close menu appears; Close removes it.
- TC-007 (AC-007): close the active Settings tab -> an adjacent tab activates; Settings gone.
- TC-008 (AC-008): Mod+Shift+S opens Settings; Esc returns to workspace.

## UI States

| State | Behavior |
| ----- | -------- |
| Settings open, active | Its tab shows the primary underline; body shows the active section. |
| Settings open, inactive | Tab present, muted; a request/editor owns the body. |
| Settings closed | No Settings tab. |
| Section empty/unknown persisted value | Fall back to the first section (Theme). |

## Edge cases

- Persisted section id no longer valid (renamed/removed) -> fall back to Theme.
- Settings is the only open tab and gets closed -> empty content area (mirror last-request-closed).
- Reorder when Settings is the sole tab -> no-op.
- `Esc` while a Settings sub-section input/editor is focused must not close Settings mid-edit if that conflicts with the editor's own Esc (resolve in plan).

## Open design questions (resolve in plan)

- **Tab-model unification:** Settings is currently boolean state (`isSettingsOpen`/`isSettingsActive`), separate from `openRequestIds`. Full reorder parity (AC-005) needs Settings to live in ONE ordered tab list with requests + the config editor. Options: (a) a unified `openTabs: TabRef[]` model (biggest, cleanest), (b) keep separate state but teach `reorderRequests` + the DnD `SortableContext` about a synthetic "settings" item id. Pick in plan.
- **Section switcher style:** confirm horizontal sub-bar (mirrors Path/Query) vs vertical - default to horizontal per "mirror existing views".

## Dependencies

- Existing `ui/tabs` primitive + `PANE_TABS_LIST`/`PANE_TABS_TRIGGER` (pane-tabs.ts).
- `@dnd-kit` SortableContext/KeyboardSensor already in content-header.
- Settings store (`settings.json`) for AC-002 persistence + the `open-context-menu` shortcut (from the keyboard-nav feature) for AC-006.
