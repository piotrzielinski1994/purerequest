# Spec: User Settings - Per-Installation Persistence

**Version:** 0.1.0
**Created:** 2026-06-19
**Status:** Draft

## 1. Overview

Persist **per-installation** UI settings to disk so the workspace shell restores its
shape between app launches. This is the first of two persistence features; the second
(workspace/collection/request config with folder inheritance, save/import anywhere) is a
separate feature and **out of scope here**.

Per-installation = one settings file per machine/install, living in the OS app-config
directory. It holds UI-shell state that is not part of any workspace:

- **Panel layout** - the sizes of the three resizable splits after the user drags them
  (sidebar|content, content|console, request|response).
- **Console hidden** - a boolean controlling whether the console body renders.

What this feature delivers:

- A typed `Settings` model + a `SettingsStore` port (load/save).
- A Tauri adapter backed by the official Store plugin (JSON file in the app-config dir,
  debounced auto-save). An in-memory fake for tests/dev.
- A `SettingsProvider` that loads settings on launch and exposes them + a `saveLayout`
  action, with no prop drilling (mirrors `WorkspaceProvider`).
- Wiring the three `ResizablePanelGroup`s to restore saved sizes on launch and persist
  on resize.
- The console body honoring the persisted `consoleHidden` flag.

What this feature does **not** deliver:

- No UI to toggle the console (no chevron, no status bar). `consoleHidden` is mutated
  only by editing the JSON file by hand for now; a future command-palette / keyboard
  feature will own the toggle.
- No workspace/request/folder config persistence (separate feature).
- No settings screen / preferences UI.
- No migration framework beyond a `version` field + per-field default merge.

### User Story

As a developer using purerequest daily, I want the app to remember how I sized my panels (and
whether the console is hidden) so that every launch reopens in the layout I left, instead
of resetting to defaults.

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | Settings persist as a JSON file in the OS app-config dir via the Tauri Store plugin and survive an app restart | Must |
| AC-002 | Dragging any of the three splits (sidebar\|content, content\|console, request\|response) persists the new sizes; the next launch restores the saved sizes for that group | Must |
| AC-003 | The console body renders iff `consoleHidden` is `false`; launching with `consoleHidden: true` in the settings file hides the console body | Must |
| AC-004 | First launch with no settings file uses built-in default sizes and `consoleHidden: false`, and does not error | Must |
| AC-005 | A corrupt or partial settings file falls back to defaults per field (shallow merge over `DEFAULT_SETTINGS`); the app does not crash | Must |
| AC-006 | All settings access goes through a `SettingsStore` port; the test suite runs against an in-memory fake with no Tauri runtime | Must |
| AC-007 | When Tauri is unavailable (e.g. `npm run dev` browser mode), `load` returns defaults and `save` is a no-op - the app still renders | Should |
| AC-008 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` exit 0 | Must |

## 3. User Test Cases

### TC-001 (happy path): Resize survives restart

**Precondition:** App launched, settings file present or absent.
**Steps:** Drag the sidebar|content handle to widen the sidebar. Quit and relaunch.
**Expected:** The sidebar reopens at the dragged width, not the default.
**Maps to:** AC-001, AC-002.

### TC-002 (load): Console hidden from settings

**Precondition:** Settings file has `"consoleHidden": true`.
**Steps:** Launch the app.
**Expected:** The console body is not rendered.
**Maps to:** AC-003.

### TC-003 (first run): No settings file

**Precondition:** No settings file on disk.
**Steps:** Launch the app.
**Expected:** Default split sizes, console visible, no error in console/logs.
**Maps to:** AC-004.

### TC-004 (corrupt): Malformed settings file

**Precondition:** Settings file contains invalid JSON or a partial object missing keys.
**Steps:** Launch the app.
**Expected:** Missing/invalid fields fall back to defaults; valid fields are honored; no crash.
**Maps to:** AC-005.

### TC-005 (round-trip, automated): Save then reload through the port

**Precondition:** In-memory fake store.
**Steps:** Mount provider, call `saveLayout("workspace", {...})`, re-create provider over the same store, load.
**Expected:** The reloaded settings contain the saved layout.
**Maps to:** AC-002, AC-006.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Loading | Settings load is async; until resolved the workspace is not rendered (brief, local-file read). A minimal placeholder may render. |
| First run / empty | No file -> `DEFAULT_SETTINGS`; default sizes, console visible. |
| Corrupt | Per-field merge over defaults; app renders with whatever was valid. |
| Restored | File present and valid -> panels open at saved sizes; console honors `consoleHidden`. |

## 5. Data Model

One settings object per installation. Layout maps reuse the resizable lib's shape
(panel-id -> numeric size).

```ts
// Panel-id -> size, matching react-resizable-panels' Layout shape.
// Reuse the lib's exported `Layout` type if available; otherwise this alias.
type PanelLayout = Record<string, number>;

type PanelGroupKey = "workspace" | "main" | "content";

type Settings = {
  version: 1;
  layouts: Partial<Record<PanelGroupKey, PanelLayout>>;
  consoleHidden: boolean;
};

const DEFAULT_SETTINGS: Settings = {
  version: 1,
  layouts: {},
  consoleHidden: false,
};

// Port - the only surface the app depends on.
type SettingsStore = {
  load: () => Promise<Settings>;   // never throws; returns defaults on any failure
  save: (settings: Settings) => Promise<void>;
};
```

Each resizable group gets a stable `PanelGroupKey`:
- `workspace` - sidebar | content (in `workspace-layout.tsx`)
- `main` - content | console (in `main.tsx`)
- `content` - request | response (in `content.tsx`)

Panels within each group get stable string `id`s so the persisted `PanelLayout` keys are
meaningful (e.g. `sidebar`/`content`, `content`/`console`, `request`/`response`).

The `SettingsProvider` exposes:

```ts
type SettingsContextValue = {
  settings: Settings;
  saveLayout: (group: PanelGroupKey, layout: PanelLayout) => void;
};
```

`saveLayout` merges the group's layout into state and persists via `store.save`. (No
console setter yet - see Out of Scope.)

## 6. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | No settings file (first run) | `load` returns `DEFAULT_SETTINGS` |
| E-2 | Corrupt JSON | Parse failure -> `DEFAULT_SETTINGS`; no throw |
| E-3 | Partial object (older/hand-edited) | Shallow merge over `DEFAULT_SETTINGS`; unknown keys ignored |
| E-4 | Tauri unavailable (browser dev) | Adapter catches invoke errors: `load` -> defaults, `save` -> no-op + console warn |
| E-5 | Layout for a group missing | Group falls back to its built-in `defaultLayout`/sizes |
| E-6 | Rapid dragging | Persist on `onLayoutChanged` (fires on pointer release, not per move); store auto-save is debounced |
| E-7 | `consoleHidden: true` but no toggle UI | Console body hidden; user restores by editing JSON (documented; command palette is future) |

## 7. Dependencies

New:
- npm: `@tauri-apps/plugin-store` (v2).
- Cargo: `tauri-plugin-store = "2"`, registered in `lib.rs`.
- Capability: add `store:default` to `src-tauri/capabilities/default.json`.

Reused: `react-resizable-panels` (already present) - `defaultLayout` + `onLayoutChanged`
APIs; panels gain stable `id`s.

## 8. Out of Scope

- Console toggle UI / reshow affordance (future command palette + shortcuts).
- Workspace/collection/request config persistence and folder inheritance (separate feature).
- A settings/preferences screen.
- Schema migrations beyond `version` + default merge.
- Persisting any non-shell state (open tabs, selection, expanded folders) - those belong
  to a workspace, not the installation.

## 9. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-19 | Initial draft |
