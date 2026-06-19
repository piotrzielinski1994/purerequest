# Plan: Command Palette

**Spec:** [spec.md](spec.md)
**Branch:** `20260619205059-command-palette`
**Created:** 2026-06-19

## 1. Approach

Wire a command palette as the 8th-and-final user action, reusing every existing mechanism:

- **Registry-as-data**: add `open-command-palette` (default `Mod+K`) to the `ShortcutActionId`
  union + `SHORTCUT_ACTIONS`. No new resolver, settings-shape, or conflict-check code - it
  flows through `resolveShortcuts` / `findConflict` / `ShortcutsSection` unchanged.
- **shadcn `command` + `dialog`** under `src/components/ui/` (canonical shadcn source; brings
  `cmdk` + `@radix-ui/react-dialog`). cmdk gives type-to-filter + arrow navigation + Enter/Esc
  natively - the exact requested behavior, no hand-rolled keydown logic.
- **Single source for run targets**: `Main` already builds the handler map it feeds to
  `useActionHotkeys`. Lift that map into a `const handlers` and reuse it for both (a) hotkey
  registration and (b) the palette's command list, so a command does exactly what its shortcut
  does. No divergence risk.
- `Main` owns palette open-state (`useState`), registers `open-command-palette` to set it open,
  builds `commands` from `SHORTCUT_ACTIONS` (minus `open-command-palette`) × effective bindings
  × `handlers`, and renders `<CommandPalette/>`.

### Why this over alternatives
- *Hand-built overlay (no cmdk)*: rejected - user explicitly wants shadcn; cmdk is the shadcn
  command component's engine and already solves filter+arrow-nav+a11y. Reinventing it is pure
  ifology.
- *Separate command registry distinct from shortcuts*: rejected - duplicates the action list,
  drifts from shortcuts. The shortcut registry already has name/description/binding per action;
  it IS the command list.
- *Palette open-state in WorkspaceProvider*: rejected - it's pure UI ephemeral state local to
  `Main`, not workspace domain state; keep it local like nothing else needs it. (If a future
  feature needs to open it from elsewhere, lift then.)

## 2. Files

### Create
- `src/components/ui/command.tsx` - shadcn command primitives (canonical source).
- `src/components/ui/dialog.tsx` - shadcn dialog primitives (CommandDialog wraps it).
- `src/components/workspace/command-palette.tsx` - `CommandPalette` component (props:
  `open`, `onOpenChange`, `commands`). Renders `CommandDialog > CommandInput + CommandList >
  CommandEmpty + CommandItem[]`; each item: name + `CommandShortcut`; `onSelect` -> `run()` then
  `onOpenChange(false)`.

### Modify
- `src/lib/shortcuts/registry.ts` - add `"open-command-palette"` to the union + a
  `SHORTCUT_ACTIONS` entry (name "Open command palette", description, `defaultHotkey "Mod+K"`).
- `src/components/workspace/main.tsx` - lift handler map to `const handlers`; add
  `open-command-palette` handler (open state); build `commands`; render `<CommandPalette/>`.
- `src/test/setup.ts` - add a no-op `Element.prototype.scrollIntoView` stub (cmdk calls it on
  highlight move; jsdom lacks it -> would throw).
- `package.json` / lockfile - `cmdk` + `@radix-ui/react-dialog` (via shadcn add).

### Tests to update (RED expects these to change)
- `src/lib/shortcuts/__tests__/resolve.test.ts` - the hardcoded `ACTION_IDS` array asserts
  exact registry equality; add `"open-command-palette"` so the "every action exactly once" test
  still passes with the new action.

## 3. Tests to write (TDD RED)

Behavior-first, named `it("should X if Y")`. Test-writer subagent owns these (fresh context).

### Registry (unit) - `src/lib/shortcuts/__tests__/`
- should register `open-command-palette` with default `Mod+K`, non-empty name + description. (AC-001)
- `resolveShortcuts({})` exposes `open-command-palette` -> `Mod+K`. (AC-001)
- `findConflict("Mod+K", <other>, effective)` reports `open-command-palette` as owner. (AC-008)

### CommandPalette (component, jsdom) - `src/components/workspace/__tests__/`
- should render a row per supplied command, each showing name + its formatted shortcut. (AC-003)
- should filter rows to matches when text is typed into the input. (AC-004)
- should show the empty-state message when the query matches nothing. (AC-004)
- should call the command's `run` and then `onOpenChange(false)` when a row is selected with
  Enter. (AC-005, AC-006)
- should call `run` + close when a row is clicked. (AC-007)
- should NOT list `open-command-palette` among the rows it is given (the list passed in already
  excludes it) - asserted at the `Main` integration level instead (see below).

### Integration (Main, through the shell) - `src/components/workspace/__tests__/`
- should open the palette overlay when `Mod+K` fires, and close it on Escape. (AC-002)
- should list every wired action except `open-command-palette`, with shortcuts. (AC-003)
- should toggle the console (observable) when "Toggle console" is run from the palette, then
  close the palette. (AC-006)
- should toggle the sidebar when "Toggle sidebar" is clicked in the palette. (AC-007)

### Settings (rebind) - reuse existing `ShortcutsSection` test patterns
- should show an "Open command palette" row in the settings shortcuts list. (AC-008)
  (Rebind round-trip + conflict are already covered generically by existing ShortcutRow tests;
  add one row-presence assertion. Avoid duplicating the whole rebind harness.)

cmdk filtering note: cmdk filters on each item's `value` (defaults to text content). Set
`value={action.name}` explicitly so filtering keys off the human label, not the rendered
shortcut glyphs.

## 4. Execution order

1. **RED**: spawn test-writer subagent (fresh context) - registry + palette + integration +
   settings-row tests; update `resolve.test.ts` ACTION_IDS. Confirm suite is RED for the right
   reason (missing action / missing component).
2. **GREEN (deps + primitives)**: `shadcn add command dialog` (or add `command.tsx`+`dialog.tsx`
   from canonical source + `npm i cmdk @radix-ui/react-dialog`); add `scrollIntoView` stub to
   test setup.
3. **GREEN (registry)**: add `open-command-palette` to registry. Commit
   `feat(command-palette): AC-001 add open-command-palette action`.
4. **GREEN (palette component)**: build `CommandPalette`. Commit
   `feat(command-palette): AC-003..007 command palette component`.
5. **GREEN (wire Main)**: lift handlers, open-state, render palette. Commit
   `feat(command-palette): AC-002 wire palette open + run in Main`.
6. **REFACTOR**: dedupe handler map, tidy types, keep tests green.
7. **VERIFY**: spawn fresh verifier subagent; loop until all AC PASS + gates green.

## 5. Edge cases handled (from spec §7)

- E-2 no-op action run -> handler is the same safe no-op; close still fires.
- E-4 typing shortcut combos in input -> `ignoreInputs` on `useActionHotkeys` + cmdk owns
  in-dialog keys.
- E-5 double-open -> boolean state, idempotent.
- E-7 Escape closes palette (dialog intercepts before global close-settings).

## 6. Risks

- **cmdk under jsdom**: needs `scrollIntoView` stub (mirrors existing `ResizeObserver` stub) and
  may emit benign console noise. Mitigation: stub in `setup.ts`; assert via roles/text, not
  internal cmdk state.
- **cmdk filter keys off `value`**: if `value` includes the shortcut glyph, filtering breaks.
  Mitigation: set `value={action.name}` explicitly.
- **shadcn `dialog` not yet in repo**: first dialog primitive. Low risk - canonical shadcn file,
  same `@radix-ui/*` family already in deps.
- **Adding registry action breaks the exact-equality test**: known; handled in RED by updating
  `ACTION_IDS`.

## 7. Acceptance verification

| AC | Verified by |
|----|-------------|
| AC-001 | registry unit tests (action present, default, name/desc) |
| AC-002 | Main integration: `Mod+K` opens, Escape closes |
| AC-003 | palette component test (rows+shortcuts) + Main integration (excludes self) |
| AC-004 | palette component tests (filter narrows, empty-state) |
| AC-005 | palette component test (Enter on highlighted runs) - cmdk drives arrow highlight |
| AC-006 | Main integration (console toggles + palette closes) |
| AC-007 | palette component test (click) + Main integration (sidebar click) |
| AC-008 | settings row-presence test + existing generic ShortcutRow rebind/conflict tests |
| AC-009 | covered by `ignoreInputs` already on `useActionHotkeys` (existing TC-006-style) |
| AC-010 | `npm run lint && npm run typecheck && npm test` + `cargo test` in verify phase |
