# Plan: make every tree/tab keyboard shortcut reconfigurable

Follow-up to the shipped keyboard-nav feature. New requirement: **every** shortcut
(including the tree-nav + tab keys currently hardcoded) must be user-rebindable via the
same Settings recorder as the existing 25 actions. Desktop app - no WAI-ARIA constraint.

Also fixes bug #3 (bare Cmd/Ctrl+Arrow leaking into the tree) for free, because the
resolver stops matching on raw `event.key` and instead matches full bindings.

## Root approach: invert the resolver

Today `resolveTreeKey` branches on `event.key` string literals. Instead:

1. Add the tree/tab keys to the **action registry** as new `ShortcutActionId`s with
   default hotkeys.
2. `resolveTreeKey` takes the **effective binding map** (from `resolveShortcuts(settings.shortcuts)`)
   and uses TanStack `matchesKeyboardEvent(event, binding)` to decide which tree action
   the event triggers - not hardcoded key strings. First matching action wins.
3. Because matching is now binding-driven, an event with an unmatched modifier (bare
   `Cmd+Arrow`) matches nothing -> no-op. Bug #3 fixed by construction.

## New registry actions (defaults)

| Action id | Name | Default | Notes |
|-----------|------|---------|-------|
| `tree-nav-down` | Tree: next row | `ArrowDown` | |
| `tree-nav-up` | Tree: previous row | `ArrowUp` | |
| `tree-nav-first` | Tree: first row | `Home` | |
| `tree-nav-last` | Tree: last row | `End` | |
| `tree-expand` | Tree: expand / into folder | `ArrowRight` | |
| `tree-collapse` | Tree: collapse / to parent | `ArrowLeft` | |
| `tree-activate` | Tree: open request / toggle folder | `Enter` | (see Enter/Space below) |
| `tree-extend-down` | Tree: extend selection down | `Shift+ArrowDown` | |
| `tree-extend-up` | Tree: extend selection up | `Shift+ArrowUp` | |
| `tree-move-down` | Tree: move node down | `Alt+ArrowDown` | reorder |
| `tree-move-up` | Tree: move node up | `Alt+ArrowUp` | reorder |
| `tree-outdent` | Tree: outdent node | `Alt+ArrowLeft` | reorder |
| `tree-nest` | Tree: nest node into folder above | `Alt+ArrowRight` | reorder |
| `open-context-menu` | Open context menu (tree row / tab) | `Shift+F10` | also fires the ContextMenu key natively |

Tab keyboard reorder (dnd-kit KeyboardSensor: Space grab / Arrow move / Space drop) stays
as-is - it is dnd-kit-internal, not an app hotkey, and the user's "every shortcut" ask is
about the app's own bindings. Called out explicitly so it is a deliberate exclusion, not
an oversight. (If wanted later, the sensor's keyboardCodes can be parameterised.)

### Enter/Space duality - decision needed in review

Today BOTH Enter and Space activate a row. The registry model is one-binding-per-action.
Options:
- **A (recommended):** `tree-activate` default `Enter`; drop the implicit Space. Users who
  want Space rebind to it. Simple, one source of truth.
- **B:** two actions `tree-activate` (`Enter`) + `tree-activate-alt` (`Space`), both wired
  to the same effect. Keeps today's dual-key behaviour, costs one extra registry row.

Plan assumes **A** unless you pick B.

## Files

**Modified**
- `src/lib/shortcuts/registry.ts` - add the 14 actions above (13 tree + reuse
  `open-context-menu`; the latter is genuinely new).
- `src/lib/shortcuts/resolve.ts` - `safeNormalize` must accept `ContextMenu` (currently
  rejected as "Unknown key"): allow-list it, or relax the unknown-key check for a known
  set. Keep everything else.
- `src/lib/workspace/tree-keyboard.ts` - `resolveTreeKey` signature changes from
  `{key, shift, alt}` to `{event | bindings}`: it receives the effective binding map +
  the raw `KeyboardEvent` and calls `matchesKeyboardEvent`. The command ADT it returns is
  unchanged, so `sidebar-tree.tsx`'s dispatch is untouched. `treeMoveTarget` unchanged.
- `src/components/workspace/sidebar-tree.tsx` - `handleKeyDown` passes the effective map
  (via `useSettings` + `resolveShortcuts`) + the event into `resolveTreeKey`.
- `src/components/workspace/tree-nav.tsx` - `openContextMenuOnKey` matches the
  configurable `open-context-menu` binding (plus always the native ContextMenu key) instead
  of the hardcoded `Shift+F10` literal.
- `src/components/workspace/content-header.tsx` - tab `onKeyDown` uses the same
  configurable `open-context-menu` binding.

**Settings page:** no change needed - it maps over `SHORTCUT_ACTIONS` and renders a
`ShortcutRow` per action, so the 14 new actions appear + become rebindable automatically.
Grouping (a "Tree navigation" subheading) is optional polish, not required.

## Conflict handling

`findConflict` already blocks a binding owned by another action. With ~39 actions the
conflict surface grows (e.g. `ArrowDown` as tree-nav vs any future global). Acceptable -
the existing block+warn recorder covers it. Note: tree-nav bindings are only *active while
a tree row is focused* (the resolver runs in the row's onKeyDown), so `ArrowDown` there
does not clash with a global `ArrowDown` elsewhere - but `findConflict` is global and will
still warn. Decision: keep the global conflict check (simpler, safe) and accept that two
context-scoped actions can't share a key even when scopes differ. Flag in review if that's
too strict.

## Tests (TDD)

- `tree-keyboard.test.ts` - rewrite to pass a binding map; assert `resolveTreeKey` matches
  the configured binding, and that a non-matching modifier combo (bare `Cmd+ArrowRight`) ->
  `none` (bug #3 regression test). Add a case with a CUSTOM binding (e.g. `tree-move-up`
  rebound to `Mod+Shift+ArrowUp`) resolving to a `move` command.
- New registry test: the 14 actions exist with the spec defaults (mirror
  `tree-crud-shortcuts` registry style).
- `resolve.test.ts` - `safeNormalize("ContextMenu")` is now accepted.
- Behavior test: render tree, rebind `tree-nav-down` to a custom key via the settings
  store, press it, assert focus moves (proves the effective map is honoured end-to-end).
- Regression e2e (optional): bare Cmd+Arrow no longer mutates the tree.

## Bug #3 / #2 interplay

- #3 (bare Cmd/Ctrl+Arrow mutating tree): fixed by the binding-match rewrite.
- #2 (Karabiner Cmd<->Option swap): once reorder is rebindable, the user can set the tree
  reorder actions to whatever their Karabiner leaves intact (or add the purerequest exception).
  Not an app fix per se, but the reconfigurability removes the hard block.
- #5 (tab drag visual overlap): SEPARATE, not addressed here - still needs a DragOverlay.

## Risks

- `matchesKeyboardEvent` per-event over ~14 bindings on every tree keydown: negligible
  (14 parsed-hotkey comparisons, keydown is not hot-path).
- Enter/Space decision (A vs B) changes one row - resolve in review.
- ContextMenu-key validation tweak must not loosen validation for genuinely bad keys.
