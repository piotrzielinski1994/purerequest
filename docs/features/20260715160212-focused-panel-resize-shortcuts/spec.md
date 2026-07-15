# Focused-panel resize shortcuts

Branch: `20260715160212-focused-panel-resize-shortcuts`

## Overview

Add two keyboard actions - **Shrink panel** and **Expand panel** - that resize the panel
currently holding keyboard focus, VSCode-style. Only the two chrome panels are resizable
targets: the **sidebar** (collection tree) and the **console** (bottom panel). Each press
moves the focused panel's split by a fixed **5%** step, clamped to that panel's existing
min/max. When focus is not inside one of those panels, the actions are a no-op.

Both actions register in the shared shortcut registry, so they auto-surface in the command
palette and the Settings shortcuts editor, and their bindings are user-editable and
multi-bindable like every other action. Defaults: **Expand = `Mod+Alt+=`**, **Shrink =
`Mod+Alt+-`**.

Why: resizing panels today is mouse-drag only (`react-resizable-panels` handle). A
keyboard-driven, focus-aware resize matches the app's keyboard-first workflow (tree nav,
command palette, panel focus-on-toggle) and mirrors VSCode's "resize the focused view".

## Acceptance criteria

- **AC-001**: Registry exposes `panel-shrink` and `panel-expand`; with no override,
  `panel-expand` resolves to `["Mod+Alt+="]` and `panel-shrink` to `["Mod+Alt+-"]`.
- **AC-002**: Focus inside the sidebar -> Expand grows it +5% (of the workspace group),
  Shrink shrinks it -5%, persisted via `saveLayout("workspace", ...)`.
- **AC-003**: Focus inside the console -> Expand/Shrink resize it +/-5%, persisted via
  `saveLayout("main", ...)`.
- **AC-004**: Resize is clamped to the focused panel's existing bounds (sidebar 12-40%,
  console min 10%); a press at the bound is a no-op that never crosses it.
- **AC-005**: Focus not inside a resizable panel (content/request editor, or nothing
  focused) -> both actions are a no-op: no layout change, no persistence.
- **AC-006**: Both actions appear in the command palette and Settings shortcuts list
  (auto-wired from the registry). Palette run targets the panel focused when it opened.
- **AC-007**: A hidden panel cannot be the focus target, so the actions are a no-op while
  that panel is hidden.

## User test cases

- **TC-001** (AC-001): `resolveShortcuts({})` gives the two defaults above.
- **TC-002/003** (AC-002): sidebar focused -> expand/shrink change its size by +/-5% (clamped).
- **TC-004** (AC-003): console focused -> expand grows console 5%.
- **TC-005/006** (AC-004): at 40% max / 12% min the opposite action is a clamped no-op.
- **TC-007** (AC-005): focus in the request editor -> expand+shrink do nothing.
- **TC-008** (AC-005): nothing focused (`activeElement` = body) -> no-op.
- **TC-009** (AC-006): palette lists "Shrink panel"/"Expand panel"; selecting runs it.
- **TC-010** (AC-007): console hidden -> expand is a no-op (console not focusable).

## UI states

| State                | Behavior                                                        |
| -------------------- | --------------------------------------------------------------- |
| Focus in sidebar     | Expand/shrink move the sidebar split by 5%, clamped 12-40%.     |
| Focus in console     | Expand/shrink move the console split by 5%, clamped to min 10%. |
| Focus elsewhere/none | No-op. No layout change, no toast.                              |
| At min/max bound     | No-op (clamp holds the bound).                                  |
| Panel hidden         | No-op (hidden panel is not a focus target).                     |

No new UI surface: the feature resizes existing panels and adds two rows to the existing
auto-generated Settings shortcuts list.

## Data model

No new persisted schema. Reuses `PanelLayout = Record<string, number>` and
`saveLayout(group, layout)`. New action ids extend the existing `ShortcutActionId` union;
`keymap.json` needs no version bump (unknown-id-tolerant merge).

## Edge cases

- Nothing focused / focus in content editor -> nearest `[data-panel]` is absent or
  `content` (not a target) -> no-op.
- Panel hidden -> not rendered, no `[data-panel]` ancestor to focus -> no-op.
- At min/max -> clamp returns an unchanged layout.
- Sidebar-hidden layout renders bare `<Main>` (no workspace group) -> `getPanelGroup` is
  null -> handler returns.

## Dependencies

`react-resizable-panels` v4 imperative `GroupImperativeHandle` (`getLayout`/`setLayout`),
already installed. No new npm deps, no Rust change.
