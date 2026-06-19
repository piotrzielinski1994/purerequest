# Spec: Command Palette

**Version:** 0.1.0
**Created:** 2026-06-19
**Status:** Draft

## 1. Overview

Add a keyboard-first **command palette**: an overlay that lists every wired action, lets
the user filter by typing, navigate the filtered results with the arrow keys, and run the
highlighted action with Enter. Each row shows the action's current keyboard shortcut on the
right, formatted for display.

The palette is the eighth wiring of an existing action and reuses what already exists:

- The **action registry** (`SHORTCUT_ACTIONS`) is the single source of the command list -
  each entry already carries `id`, `name`, `description`, `defaultHotkey`.
- The same handler map that `Main` feeds to `useActionHotkeys` is reused as the run targets,
  so a command does exactly what its shortcut does.
- The shortcut label uses `formatForDisplay(binding)` from `@tanstack/hotkeys` (the same call
  the settings `ShortcutRow` already uses), over the effective binding from
  `resolveShortcuts(settings.shortcuts)`.

Opening the palette is itself a new rebindable action, `open-command-palette`, default
`Mod+K`, added to the registry like every other action (so it persists, is rebindable, and is
conflict-checked in settings).

The palette UI is the shadcn `command` component (`cmdk` under the hood) inside the shadcn
`dialog`, matching the project's existing shadcn primitives. `cmdk` provides the
type-to-filter and up/down navigation natively - exactly the requested behavior.

What this feature delivers:

- A new registry action `open-command-palette` (default `Mod+K`), wired in `Main`.
- shadcn `command` + `dialog` primitives added under `src/components/ui/` (brings `cmdk` and
  `@radix-ui/react-dialog` deps).
- A `CommandPalette` component: a `CommandDialog` listing every wired action (except itself),
  each row = action name + `CommandShortcut` showing its effective binding.
- Type-to-filter (cmdk built-in), arrow-key navigation over the filtered list (cmdk built-in),
  Enter runs the highlighted command, Escape / click-outside closes.
- Selecting/running a command closes the palette and performs the action via the shared
  handler map.

What this feature does **not** deliver:

- No new actions beyond `open-command-palette`; no wiring of still-dead buttons (Send, method
  select). The palette lists only already-wired actions.
- No jump-to-request / fuzzy file search entries (request entries have no shortcut to show and
  expand scope - out of scope).
- No command categories/grouping beyond a single flat list.
- No recent/frequently-used ordering, no command icons.

### User Story

As a keyboard-driven ReqUI user, I want a command palette I can summon with a shortcut, type
to filter actions, arrow through the matches, and run one with Enter - seeing each action's
shortcut next to it - so I can discover and trigger any action without leaving the keyboard or
memorizing every binding.

## 2. Command Source

The palette lists every entry in `SHORTCUT_ACTIONS` **except** `open-command-palette` itself
(running "open command palette" from inside the open palette is meaningless). For each listed
action it shows:

| Column | Source |
|--------|--------|
| Label  | `action.name` |
| Shortcut (right) | `formatForDisplay(effective[action.id])` |

Run target = the same handler `Main` already supplies to `useActionHotkeys` for that action id.
Running a workspace action that is currently a no-op (e.g. `close-request` with no open
request) is the same safe no-op as pressing its shortcut.

## 3. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | A new registry action `open-command-palette` exists with default hotkey `Mod+K`, a non-empty name and description, like every other action | Must |
| AC-002 | Pressing the `open-command-palette` effective hotkey opens the palette overlay; pressing Escape (or clicking outside) closes it | Must |
| AC-003 | When open, the palette lists every wired action except `open-command-palette`, each row showing the action's display name and its current effective shortcut formatted for display | Must |
| AC-004 | Typing in the palette input filters the visible commands to those matching the query; a query matching nothing shows an empty-state message | Must |
| AC-005 | The Up/Down arrow keys move the highlight across the **filtered** results (wrapping per cmdk default); the highlighted command is visually distinct | Must |
| AC-006 | Pressing Enter on a highlighted command runs that action (observable: console toggles, sidebar toggles, tab changes/closes, settings opens, etc.) and closes the palette | Must |
| AC-007 | Selecting a command with a pointer (click) runs it and closes the palette, identically to Enter | Should |
| AC-008 | The `open-command-palette` binding is rebindable and resettable in Settings, conflict-checked against other actions, persisted like every other shortcut (it flows through the existing registry/resolve/settings machinery with no special-casing) | Must |
| AC-009 | Opening the palette does not fire other action hotkeys typed into its input (the palette input is a text field; `useActionHotkeys` already runs with `ignoreInputs`) | Must |
| AC-010 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` exit 0 | Must |

## 4. User Test Cases

### TC-001 (open/close): summon and dismiss
**Precondition:** Workspace loaded.
**Steps:** Press `Mod+K`. Then press Escape.
**Expected:** Palette appears listing actions; Escape closes it, focus returns to the workspace.
**Maps to:** AC-002.

### TC-002 (list + shortcuts): every action shown with its binding
**Precondition:** Palette open, no overrides set.
**Steps:** Read the list.
**Expected:** Each wired action (except open-command-palette) appears once, with its default
shortcut rendered on the right (e.g. "Toggle console … ⌘J" on mac form / "Ctrl+J" otherwise).
**Maps to:** AC-001, AC-003.

### TC-003 (filter): type narrows the list
**Precondition:** Palette open.
**Steps:** Type "console".
**Expected:** Only the console-related command(s) remain; non-matching commands are hidden.
**Maps to:** AC-004.

### TC-004 (arrow nav + run): keyboard-only execution
**Precondition:** Palette open, console currently visible.
**Steps:** Type "console", press Down to highlight "Toggle console" (if not already), press Enter.
**Expected:** Palette closes; the console pane toggles (hides). Re-open + run again -> it shows.
**Maps to:** AC-005, AC-006.

### TC-005 (empty filter state): no matches
**Precondition:** Palette open.
**Steps:** Type "zzzzz".
**Expected:** No command rows; an empty-state message ("No matching commands") is shown.
**Maps to:** AC-004.

### TC-006 (click run): pointer selection
**Precondition:** Palette open.
**Steps:** Click "Toggle sidebar".
**Expected:** Palette closes; sidebar toggles.
**Maps to:** AC-007.

### TC-007 (rebind palette): change open shortcut
**Precondition:** Settings open.
**Steps:** Record a new binding for "Open command palette" (e.g. `Mod+Shift+P`).
**Expected:** The new combo opens the palette; the old `Mod+K` no longer does. Settings file
holds the override; Reset restores `Mod+K`.
**Maps to:** AC-008.

### TC-008 (conflict): palette binding conflict-checked
**Precondition:** Settings open.
**Steps:** Try to record `Mod+K` for another action (or an existing binding for the palette).
**Expected:** Rejected with the conflicting action named; binding unchanged.
**Maps to:** AC-008.

## 5. UI States (Command Palette overlay)

| State | Behavior |
| ----- | -------- |
| Closed | Nothing rendered; workspace fully interactive. |
| Open (default) | Centered dialog over a dimmed backdrop. Search input autofocused. Full command list below, first row highlighted. Each row: name left, shortcut right. |
| Filtering | List narrows live to matches; highlight moves to the first remaining match. |
| Empty (no match) | List area shows "No matching commands"; Enter does nothing. |
| Running | On Enter/click: dialog closes, action runs, focus returns to the workspace. |

## 6. Data Model

No persisted-shape change beyond one new action id in the registry union. The settings
`shortcuts` override map already keys by `ShortcutActionId`, so `open-command-palette`
overrides persist with zero schema change.

```ts
// registry.ts — add to the union + the SHORTCUT_ACTIONS array:
type ShortcutActionId =
  | "open-settings" | "close-settings"
  | "toggle-console" | "toggle-sidebar"
  | "next-request" | "prev-request" | "close-request"
  | "new-request" | "open-workspace"
  | "open-command-palette";        // NEW, default "Mod+K"

// CommandPalette props
type PaletteCommand = {
  action: ShortcutAction;   // from SHORTCUT_ACTIONS
  binding: string;          // effective hotkey, pre-resolved
  run: () => void;          // handler from Main's map
};

type CommandPaletteProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  commands: readonly PaletteCommand[];
};
```

`Main` owns the open/closed state (`useState`), registers `open-command-palette` in its
`useActionHotkeys` map to set it open, builds the `commands` list from `SHORTCUT_ACTIONS`
(filtering out `open-command-palette`) + the effective bindings + its existing handler map, and
renders `<CommandPalette …/>`. Selecting a command calls `run()` then `onOpenChange(false)`.

## 7. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | Palette open while settings tab is active | Still opens; commands still run (they operate on workspace/settings context, unaffected by which tab is active). |
| E-2 | Run a workspace action that's currently a no-op (e.g. close-request, no open request) | Same safe no-op as the shortcut; palette still closes. |
| E-3 | `open-command-palette` rebound to a combo Karabiner eats on the dev machine | User-rebindable; default `Mod+K` is not in the documented Karabiner-remapped set. Same caveat as all shortcuts. |
| E-4 | Typing an action's own shortcut combo into the palette input | Suppressed: `useActionHotkeys` runs with `ignoreInputs`; the palette input is a text field, so global hotkeys don't fire while typing. cmdk handles arrows/enter/esc within the dialog. |
| E-5 | Open palette while already open / double-trigger | State is boolean; re-opening is idempotent. |
| E-6 | Tauri unavailable (browser dev) | Palette is pure frontend; works in-session. Only the persisted rebind no-ops without Tauri (inherited from the settings store). |
| E-7 | Escape inside palette | cmdk/dialog closes the palette. (Distinct from the global `close-settings` Escape, which the dialog intercepts while open.) |

## 8. Dependencies

New npm deps (pulled in by `shadcn add command`): **`cmdk`** and **`@radix-ui/react-dialog`**
(the shadcn `dialog` the `CommandDialog` wraps). Both are standard shadcn building blocks and
fit the existing `@radix-ui/*` + shadcn setup. No Cargo / Tauri-capability changes (pure
frontend; reuses the existing settings file for the rebind override).

Reused: `SHORTCUT_ACTIONS` registry; `resolveShortcuts`/`safeNormalize`/`findConflict`;
`useActionHotkeys`; `SettingsProvider` (`saveShortcut`/`resetShortcut`); `formatForDisplay`;
`Main`'s existing handler map; the existing `ShortcutsSection` (the new action shows up
automatically since it maps over `SHORTCUT_ACTIONS`).

## 9. Out of Scope

- Jump-to-request / fuzzy file navigation entries.
- Command grouping/categories, icons, recent-commands ordering.
- Wiring still-dead buttons (Send, method select) - separate feature.
- Per-workspace command sets; OS-global accelerators.

## 10. AC Traceability (implemented)

**Status: COMPLETE** - all gates green (`npm run lint`/`typecheck` 0 errors, `npm test` 192
passed, `cargo test` ok). Verified by a fresh-context verifier subagent: PASS on every AC.

| AC | Proving test(s) |
|----|-----------------|
| AC-001 | `command-palette-registry.test.ts`: registers open-command-palette w/ Mod+K, non-empty name/desc, resolveShortcuts exposes it; `resolve.test.ts`: "every in-scope action exactly once" |
| AC-002 | `command-palette-integration.test.tsx`: "should open the palette overlay if Mod+K fires and close it on Escape" |
| AC-003 | `command-palette.test.tsx`: "render a row per supplied command…name and formatted shortcut"; `command-palette-integration.test.tsx`: "list every wired action except open-command-palette with its shortcut" (asserts exclusion) |
| AC-004 | `command-palette.test.tsx`: "filter rows to matches when text is typed"; "show the empty-state message if the query matches nothing" |
| AC-005 | `command-palette.test.tsx`: "run the second filtered command if ArrowDown then Enter is pressed" (multi-row arrow nav); "run the highlighted command then close if Enter is pressed" |
| AC-006 | `command-palette-integration.test.tsx`: "toggle the console and close the palette if Toggle console is run from it" |
| AC-007 | `command-palette.test.tsx`: "run the command and close if a row is clicked"; integration "toggle the sidebar…if Toggle sidebar is clicked" |
| AC-008 | `command-palette-registry.test.ts`: "report open-command-palette as the owner if Mod+K is recorded for another action"; `shortcuts-section.test.tsx`: "show an Open command palette row"; generic ShortcutRow rebind/reset/conflict tests |
| AC-009 | Inherited: `useActionHotkeys(..., { ignoreInputs: true })` in `use-action-hotkeys.ts` |
| AC-010 | lint/typecheck/test/cargo gates all exit 0 |

## 11. Decision Log

| Date | Decision | Rationale |
|------|----------|-----------|
| 2026-06-19 | shadcn `command` (cmdk) + `dialog` for the palette | User-directed (project standardizes on shadcn); cmdk natively does filter + arrow-nav + a11y. See [adr.md](../../adr.md) |
| 2026-06-19 | Commands sourced from `SHORTCUT_ACTIONS` (minus self), run via `Main`'s shared handler map | Single source of truth; a command does exactly what its shortcut does. See [adr.md](../../adr.md) |
| 2026-06-19 | Palette open-state = local `useState` in `Main`, not `WorkspaceProvider` | Pure UI ephemeral state, nothing else needs it; lift later if a remote opener appears |
| 2026-06-19 | `open-command-palette` default = `Mod+K` | Conventional palette binding; not in the documented Karabiner-remapped set. Forced switching two shortcuts-section tests off `Mod+K` (now owned) to `Mod+Y` for their free-combo example |

## 12. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-19 | Initial draft |
| 1.0.0 | 2026-06-19 | Implemented + verified; AC traceability + decision log added |
