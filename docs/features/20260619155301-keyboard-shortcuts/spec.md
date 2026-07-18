# Spec: Configurable Keyboard Shortcuts

**Version:** 0.1.0
**Created:** 2026-06-19
**Status:** Draft

## 1. Overview

Give every wired user action a keyboard shortcut whose binding the user can rebind, with
the chosen bindings persisted to the per-installation settings file. Bindings are managed
with the TanStack Hotkeys stack already in the repo (`@tanstack/react-hotkeys` +
`@tanstack/hotkeys`), which is currently mounted (`HotkeysProvider`) but registers nothing.

In scope = only actions that already do something today. Buttons with no handler (Send,
New request, method `Select`) are **out of scope** - we do not bind shortcuts to no-ops.

What this feature delivers:

- An **action registry** (pure data): each action's id, display name, description, and
  default hotkey. Single source of truth for "what actions exist".
- The `Settings` model extended with a `shortcuts` override map (action id -> hotkey
  string); missing entries fall back to the registry default. Persisted through the
  existing `SettingsStore` port + Tauri Store adapter.
- A resolver that merges defaults + overrides into an effective binding map, dropping
  invalid/unknown entries.
- A `useActionHotkeys(handlers)` hook that registers the effective bindings for whatever
  subset of actions a component supplies handlers for, via the library's `useHotkeys`.
- Shortcuts wired into the running app:
  - Global (any route): open settings, return to workspace.
  - Workspace: toggle console, next/previous open request, close active request.
- A **Settings page** section listing every action with its current binding, a key
  **recorder** (`useHotkeyRecorder`) to rebind, a reset-to-default, and **block+warn**
  conflict handling (a key already owned by another action is rejected with a message).
- Hoisting `SettingsProvider` to the root route so settings (and thus shortcuts) are
  available on every route, including `/settings`.

What this feature does **not** deliver:

- No new actions / no wiring of currently-dead buttons (Send, New request, method select).
- No command palette, no sequence (chord) shortcuts, no per-workspace shortcut overrides.
- No focusing the URL bar (it is a read-only display, not an input - nothing to focus).
- No global-OS / Tauri-native accelerators - shortcuts are in-window (web) only.

### User Story

As a keyboard-driven purerequest user, I want each action bound to a shortcut I can change and
have remembered across launches, so I can drive the app without the mouse using bindings
that match my muscle memory.

## 2. Action Set (in scope)

| Action id | Name | Default | Scope | Wired via |
|-----------|------|---------|-------|-----------|
| `open-settings` | Open settings | `Mod+Shift+S` | Global | router navigate `/settings` |
| `close-settings` | Back to workspace | `Escape` | Global | router navigate `/` |
| `toggle-console` | Toggle console | `Mod+J` | Workspace | `settings.consoleHidden` setter |
| `next-request` | Next request tab | `Control+Tab` | Workspace | `setActiveRequest` over `openRequestIds` |
| `prev-request` | Previous request tab | `Control+Shift+Tab` | Workspace | `setActiveRequest` over `openRequestIds` |
| `close-request` | Close request tab | `Mod+W` | Workspace | `closeRequest(activeRequestId)` |

`Mod` resolves to Cmd on macOS, Ctrl elsewhere (library-provided). Keys are uppercase per
the typed union (`"Mod+J"`, not `"Mod+j"`).

## 3. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | Each in-scope action has a default hotkey defined in the action registry; the registry is the single source of the action list | Must |
| AC-002 | Pressing an action's effective hotkey runs that action (observable result: console toggles, active tab changes, tab closes, route changes) | Must |
| AC-003 | A user-chosen binding is saved to the settings file via the `SettingsStore` port and is in effect after restart; the registry default is replaced by the override | Must |
| AC-004 | Resetting an action restores its registry default and removes the override from the settings file | Must |
| AC-005 | Recording a binding already owned by another action is rejected (block+warn): the existing action is named, the binding is unchanged | Must |
| AC-006 | The Settings page lists every in-scope action with a human-readable label of its current binding and a control to rebind/reset it | Must |
| AC-007 | A corrupt/partial/hand-edited `shortcuts` map falls back per action to the registry default (unknown action ids and non-string/invalid hotkeys dropped); no crash | Must |
| AC-008 | Shortcuts do not fire while typing in a text input / while the recorder is capturing (`ignoreInputs`) | Must |
| AC-009 | Workspace-scoped actions are no-ops when not applicable (no open request) and do not throw | Should |
| AC-010 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` exit 0 | Must |

## 4. User Test Cases

### TC-001 (happy path): default shortcut fires action
**Precondition:** Workspace loaded, a request open, console visible.
**Steps:** Press the `toggle-console` default (`Mod+J`).
**Expected:** Console body hides; press again, it shows.
**Maps to:** AC-001, AC-002.

### TC-002 (rebind round-trip): change binding survives restart
**Precondition:** Settings page open.
**Steps:** Record a new binding for `toggle-console` (e.g. `Mod+K`). Relaunch.
**Expected:** `Mod+K` toggles the console; old `Mod+J` does nothing. Settings file holds the override.
**Maps to:** AC-002, AC-003.

### TC-003 (reset): restore default
**Precondition:** `toggle-console` has an override.
**Steps:** Click reset for `toggle-console`.
**Expected:** Binding shows the registry default again; override removed from the settings file.
**Maps to:** AC-004.

### TC-004 (conflict): duplicate binding blocked
**Precondition:** Settings page open; `close-request` is `Mod+W`.
**Steps:** Try to record `Mod+W` for `toggle-console`.
**Expected:** Rejected with a message naming `Close request tab`; `toggle-console` keeps its binding.
**Maps to:** AC-005.

### TC-005 (corrupt, automated): bad shortcuts map falls back
**Precondition:** Settings object with `shortcuts: { "toggle-console": 42, "bogus": "Mod+Q" }`.
**Steps:** Load through `mergeSettings`, resolve effective bindings.
**Expected:** `toggle-console` resolves to its default; `bogus` dropped; no throw.
**Maps to:** AC-007.

### TC-006 (input guard): no fire while typing
**Precondition:** Settings recorder is capturing, or focus in any text input.
**Steps:** Press a key that matches an action binding.
**Expected:** The action does not run.
**Maps to:** AC-008.

### TC-007 (no-op safety): action with nothing to act on
**Precondition:** No open requests.
**Steps:** Press `close-request` / `next-request`.
**Expected:** Nothing happens, no error.
**Maps to:** AC-009.

### TC-008 (global nav): open/close settings by keyboard
**Precondition:** App on `/` (workspace).
**Steps:** Press `open-settings` (`Mod+Shift+S`); then on settings press `close-settings` (`Escape`).
**Expected:** Route goes to `/settings`, then back to `/`.
**Maps to:** AC-002.

## 5. UI States (Settings page - shortcuts section)

| State | Behavior |
| ----- | -------- |
| Default | Each action row shows name + current binding (formatted for display) + Edit + Reset. |
| Recording | The row being edited shows "Press keys..."; Esc cancels; captured combo previews live. |
| Conflict | Inline error naming the action that already owns the pressed combo; binding unchanged. |
| Reset (no override) | Reset control disabled/absent when the action is already at its default. |

## 6. Data Model

```ts
// Registry (pure, not persisted)
type ShortcutActionId =
  | "open-settings" | "close-settings"
  | "toggle-console" | "next-request" | "prev-request" | "close-request";

type ShortcutAction = {
  id: ShortcutActionId;
  name: string;          // display label
  description: string;   // settings-page helper text
  defaultHotkey: string; // typed Hotkey string, uppercase keys
};

const SHORTCUT_ACTIONS: readonly ShortcutAction[]; // single source of the action list

// Persisted override map (sparse): action id -> chosen hotkey string
type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;

// Settings gains one field:
type Settings = {
  version: 1;
  layouts: Partial<Record<PanelGroupKey, PanelLayout>>;
  consoleHidden: boolean;
  workspacePath?: string;
  shortcuts: ShortcutOverrides;   // DEFAULT: {}
};

// Effective bindings = defaults overlaid with valid overrides
function resolveShortcuts(overrides: ShortcutOverrides): Record<ShortcutActionId, string>;

// Conflict check used by the recorder
function findConflict(
  hotkey: string,
  forAction: ShortcutActionId,
  effective: Record<ShortcutActionId, string>,
): ShortcutActionId | null; // normalized-equality compare; null = free
```

`SettingsProvider` exposes (additions):

```ts
type SettingsContextValue = {
  settings: Settings;
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
  saveConsoleHidden: (hidden: boolean) => void;       // new (toggle-console needs it)
  saveShortcut: (id: ShortcutActionId, hotkey: string) => void;
  resetShortcut: (id: ShortcutActionId) => void;
};
```

Registration hook:

```ts
// Registers effective bindings for the supplied handlers only.
// Unhandled actions are simply not registered. ignoreInputs + preventDefault on.
function useActionHotkeys(handlers: Partial<Record<ShortcutActionId, () => void>>): void;
```

## 7. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | `shortcuts` key absent (old/first-run file) | Defaults to `{}`; all actions use registry defaults |
| E-2 | Override value not a string / not a valid hotkey | Dropped in merge + resolver; action uses default |
| E-3 | Override for an unknown action id | Dropped in merge |
| E-4 | Hand-edited duplicate bindings (two actions same key) | Library `conflictBehavior: "warn"` logs; first registration wins. UI recorder prevents creating these (E-5) |
| E-5 | User records a combo already used | Block+warn; binding unchanged (AC-005) |
| E-6 | User records `Escape` | The recorder uses Escape to **cancel**, so Escape cannot be assigned via the recorder; it remains available only as the `close-settings` default. Documented limitation |
| E-7 | Workspace action with no open request | No-op guard, no throw |
| E-8 | Typing in an input or recording | `ignoreInputs: true` suppresses action hotkeys |
| E-9 | Tauri unavailable (browser dev) | Inherited from existing store: `save` no-op, `load` defaults; shortcuts still work in-session, just not persisted |

## 8. Dependencies

New: **none**. `@tanstack/react-hotkeys` (v0.10.0) and `@tanstack/hotkeys` are already
installed and `HotkeysProvider` is already mounted. No Cargo/capability changes (pure
frontend; reuses the existing Tauri Store settings file).

Reused: `SettingsStore` port + Tauri/in-memory adapters; `SettingsProvider`;
`WorkspaceProvider` actions (`setActiveRequest`, `closeRequest`, `openRequestIds`,
`activeRequestId`); TanStack Router `useNavigate`.

## 9. Out of Scope

- Wiring dead buttons (Send / New request / method select) - separate feature.
- Command palette, chord/sequence shortcuts, per-workspace overrides, OS-global accelerators.
- Focusing the read-only URL display.
- A general preferences framework beyond this shortcuts section.

## 10. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-19 | Initial draft |
