# Plan: Full keyboard navigation (sidebar tree + tab bar)

Spec: [spec.md](./spec.md). Coverage threshold: none.

## Approach

WAI-ARIA tree keyboard pattern, wired onto the existing selection/expand/move context
API - no new state, no change to the pointer-drag machinery.

- **Nav + activate + expand (Gap 1)** live in a single `onKeyDown` on each tree row
  (`tree-row.tsx`), sharing one pure resolver in a new `lib/workspace/tree-keyboard.ts`.
  The resolver takes `(tree, expandedIds, focusedId, key, modifiers)` and returns a
  discriminated command the row dispatches against the context. Keeping the branching in
  a pure, unit-tested function avoids ifology in the component.
- **Roving tabindex (AC-006)**: a row is `tabIndex={0}` iff it is the roving row
  (`selectedNodeId ?? firstVisibleId`), else `-1`. On a nav key the handler moves
  selection (via `selectInTree`/`selectNode`), and because the newly-selected row becomes
  the roving `tabIndex=0` row we imperatively `.focus()` it (ref map keyed by id in
  `sidebar-tree.tsx`, passed to rows through the existing `TreeDndProvider` context or a
  new lightweight focus context).
- **Alt+Arrow reorder (Gap 2, tree)**: same resolver returns a `move` command with a
  `MoveTarget` computed against `moveNode`'s post-removal index semantics (mirrors
  `dropTarget`'s compensation). Dispatches `moveNode(id, target)`; after the move we
  refocus the moved row.
- **KeyboardSensor (Gap 2, tabs)**: add `useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })`
  to the tab-bar `DndContext` in `content-header.tsx`. The tab wrapper already spreads
  `useSortable` `attributes` (role, `tabIndex`, `aria-roledescription`) + `listeners`
  (which include `onKeyDown` for pick-up), so this is a one-line sensor add.
- **Context menu key (Gap 3)**: Radix `ContextMenuTrigger` already listens for the native
  `contextmenu` event, which Shift+F10 / the ContextMenu key dispatch on the focused
  element. The tree rows and tab wrappers are already inside `ContextMenuTrigger asChild`;
  the only missing piece is that a `<div>` must be **focusable** for the browser to target
  it - the tree rows already are (`tabIndex`), and the tab wrappers get it from
  `useSortable` attributes. So Gap 3 largely falls out once rows are focusable; verify with
  a test and only add an explicit `onKeyDown` -> open fallback if the native path fails
  under jsdom (jsdom does not synthesize `contextmenu` from Shift+F10, so the test drives
  it by firing a `contextmenu` event / using `userEvent` keyboard, and the real path is
  covered by the Playwright e2e).

## Files

**New**
- `src/lib/workspace/tree-keyboard.ts` - pure resolver: `resolveTreeKey(...)` -> command
  ADT `{ type: "focus"; id } | { type: "activate"; id } | { type: "toggle"; id } |
  { type: "expand"; id } | { type: "collapse"; id } | { type: "move"; id; target } |
  { type: "extend"; id } | { type: "none" }`; plus `treeMoveTarget(tree, id, dir)`.
- `src/lib/workspace/__tests__/tree-keyboard.test.ts` - unit tests for the resolver + move
  targets (nav order, expand/collapse focus rules, all four Alt-move directions + no-op
  guards).
- `src/components/workspace/__tests__/tree-keyboard-nav.test.tsx` - behavior tests
  (render `Main`, press keys, assert focus / `aria-selected` / `aria-expanded` / opened
  tab / persisted order) covering AC-001..008, 011.
- `src/components/workspace/__tests__/tab-keyboard-reorder.test.tsx` - AC-009/010 tab-bar
  keyboard reorder + tab context-menu key.

**Modified**
- `src/components/workspace/tree-row.tsx` - add `onKeyDown` to both `FolderRow` and
  `RequestRow` treeitem `<div>`s (dispatch the resolved command); set `tabIndex` from a
  `isRovingRow` prop; register the row element into a focus-ref map. Guard: ignore keys
  while `isRenaming` (AC-011).
- `src/components/workspace/sidebar-tree.tsx` - own the roving-row id + a `Map<string, HTMLElement>`
  focus registry; provide both to rows (extend `TreeDndProvider` value or add a sibling
  context); compute `firstVisibleId` from `flattenSelectable`. Remove the now-redundant
  reliance on click-only selection (keep click handlers; just add keyboard parity).
- `src/components/workspace/content-header.tsx` - add `KeyboardSensor` +
  `sortableKeyboardCoordinates` to the tab DndContext sensors.
- Possibly `src/components/workspace/workspace-context.tsx` - only if a needed selector is
  missing; expected NONE (all APIs exist: `selectNode`, `selectInTree`, `toggleFolder`,
  `moveNode`, `expandedFolderIds`, `selectedNodeId`).

## Key decisions / patterns

- **Command ADT over inline ifology** - the resolver returns a typed command; the row runs
  a small dispatch. Satisfies the "strategy over ifology" + ADT-over-exceptions house rules.
- **Pure core, imperative shell** - all key->intent logic is a pure function
  (`tree-keyboard.ts`), unit-tested without React; the component only maps commands to
  context calls + focus side-effects.
- **Reuse `flattenSelectable`/`rangeBetween`/`moveNode`** - no new tree algorithms; arrow
  order and range-extend are exactly the existing flatten/range used by click-select, so
  keyboard and mouse selection stay consistent by construction.
- **Focus follows selection** - single source of truth for "which row is tabbable" =
  `selectedNodeId ?? firstVisibleId`; avoids a second focus-state field.

## Edge cases handled (from spec §5)

- Empty / single-row tree: resolver returns `none` when the flattened list can't move.
- Alt-move guards: first/last sibling, no preceding folder, outdent-at-root -> `treeMoveTarget`
  returns `null` -> `none`.
- Rename active: row handler early-returns on `isRenaming` (AC-011).
- Deleted focused node: roving falls back to `selectedNodeId ?? firstVisibleId` next render.
- Context menu open: Radix menu is a portal + focus-trapped; its key events don't reach the
  tree `<ul>`. Test asserts arrows don't move tree selection while the menu is open.
- Non-writable workspace: `moveNode` already no-ops; Alt-move harmlessly does nothing.

## Tests to write (>=1 per AC)

| AC | Test |
| -- | ---- |
| AC-001 | TC-001, TC-002 (arrow nav, collapsed children skipped) |
| AC-002 | TC-003 (Enter opens request tab; Space toggles folder) |
| AC-003 | TC-004 (Right expand-then-descend; Left collapse-then-ascend) |
| AC-004 | TC-005 (Home/End) |
| AC-005 | TC-006 (Shift+Arrow range extend) |
| AC-006 | TC-007 (exactly one tabbable row; follows selection) |
| AC-007 | TC-008 + tree-keyboard unit tests (all 4 dirs + no-op guards) |
| AC-008 | TC-009 (Shift+F10 opens row menu) |
| AC-009 | TC-010 (tab keyboard reorder persists) |
| AC-010 | tab context-menu key |
| AC-011 | TC-011 (rename input swallows arrows) |
| AC-012 | lint + typecheck + `npm test` + `cargo test` (verifier gate) |

## Execution order

1. RED: spawn test-writer for the unit + behavior + tab tests above.
2. GREEN per AC: `tree-keyboard.ts` resolver first (unblocks unit tests), then `tree-row.tsx`
   + `sidebar-tree.tsx` wiring (behavior tests), then `content-header.tsx` sensor (tab tests).
3. REFACTOR: dedupe the two rows' key handling into the shared resolver dispatch if it drifts.
4. VERIFY: fresh verifier subagent runs all gates + adversarial edge probing.
