# Spec: Full keyboard navigation (sidebar tree + tab bar)

**Created:** 2026-07-11
**Status:** Approved
**Branch/folder:** `20260711223640-keyboard-tree-navigation`

## 1. Overview

ReqUI is billed as keyboard-driven, but an audit found three surfaces that are
mouse-only:

1. **Sidebar collection tree** - rows are `<div role="treeitem" tabIndex={0}>` with
   `onClick` but no `onKeyDown`. A row takes Tab focus, yet Enter/Space do nothing and
   there is no arrow-key movement. Selection (`selectNode`/`selectInTree`) is set only
   from `onClick`, so there is no keyboard path to select/open a request or expand a
   folder from the tree.
2. **Reordering** - the sidebar tree and the request tab bar both register only a
   `PointerSensor`; moving/reordering nodes and reordering tabs is drag-only.
3. **Context menus** - row / tab / sidebar menus open on right-click only; no focused
   element opens them from the keyboard.

This feature makes the tree a proper WAI-ARIA keyboard tree widget, adds keyboard
reordering (Alt+Arrow for the tree, dnd-kit `KeyboardSensor` for the tab bar), and lets
Shift+F10 / the ContextMenu key open the row and tab context menus.

### Non-goals (YAGNI)

- No new visual design; rows/tabs look identical.
- No full ARIA multiselect-tree focus/selection decoupling (Ctrl+Arrow move-without-select).
  Arrow moves focus **and** single-selection; Shift+Arrow extends the range. That reuses
  the existing `selectInTree` range mode and matches the current click model.
- No changes to the drag-projection / spring-load pointer behavior.
- No typeahead (type a letter to jump to a row).

## 2. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | On a focused tree row, ArrowDown/ArrowUp move focus + single-selection to the next/previous **visible** row in flattened order (collapsed folders' children skipped); at the ends it is a no-op | Must |
| AC-002 | Enter or Space on a focused **request** row opens + activates its tab; on a **folder** row toggles expand/collapse | Must |
| AC-003 | ArrowRight on a collapsed folder expands it; on an already-expanded folder moves focus to its first child; on a request it is a no-op. ArrowLeft on an expanded folder collapses it; on a collapsed folder / any child moves focus to the parent folder | Must |
| AC-004 | Home moves focus+selection to the first visible row, End to the last | Should |
| AC-005 | Shift+ArrowDown/ArrowUp extends the multi-selection (range from the anchor) to the next/previous visible row | Should |
| AC-006 | Roving tabindex: at most one tree row is in the Tab order (the selected row, else the first row); tabbing into the tree lands one stop, and the other rows carry `tabIndex=-1` | Must |
| AC-007 | Alt+ArrowUp/ArrowDown reorder the focused node among its siblings; Alt+ArrowLeft outdents it (after its parent, in the grandparent); Alt+ArrowRight nests it into the immediately-preceding sibling **folder** (appended). Each persists via `moveNode`; an impossible move (no sibling / no preceding folder / already at root) is a no-op | Must |
| AC-008 | Shift+F10 or the ContextMenu key on a focused tree row opens that row's context menu; it is then arrow/Enter/Esc operable (Radix default) | Must |
| AC-009 | Request tabs are reorderable by keyboard: a `KeyboardSensor` (with `sortableKeyboardCoordinates`) is registered on the tab-bar DndContext, so a focused tab can be picked up (Space), moved (Arrow), and dropped (Space); the new order persists via `reorderRequests` | Must |
| AC-010 | Shift+F10 / ContextMenu key on a focused request tab opens its tab context menu (Close / Close other / Close all) | Should |
| AC-011 | Tree keyboard handlers do NOT fire while a text input inside the tree is focused (the inline rename input): arrows/Enter/Alt-moves are ignored so rename editing is unaffected | Must |
| AC-012 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` exit 0 | Must |

## 3. Test Cases

- TC-001 (AC-001, happy): expand root, focus first row, press ArrowDown -> focus + `aria-selected` move to the second visible row; ArrowUp returns. ArrowUp on the first row is a no-op.
- TC-002 (AC-001, edge): a collapsed folder's children are skipped - ArrowDown from the folder lands on the next sibling, not a hidden child.
- TC-003 (AC-002): Enter on a request row opens its tab (a new `role="tab"` appears + becomes active). Space on a folder row toggles `aria-expanded`.
- TC-004 (AC-003): ArrowRight on a collapsed folder sets `aria-expanded=true`; a second ArrowRight moves focus to the first child. ArrowLeft on the expanded folder collapses it; ArrowLeft on a child moves focus to the parent.
- TC-005 (AC-004): Home focuses the first visible row, End the last.
- TC-006 (AC-005): focus a row, Shift+ArrowDown -> two rows `aria-selected`.
- TC-007 (AC-006): rendered tree has exactly one row with `tabIndex=0`; the rest `-1`. After ArrowDown the tabbable row follows the selection.
- TC-008 (AC-007): Alt+ArrowDown on a root request swaps it past its next sibling (order persisted - assert the moved node's new index via the change callback / re-render order). Alt+ArrowRight nests a request into a preceding sibling folder. Alt+ArrowLeft on a nested request outdents it to the root. An Alt+ArrowUp on the first sibling is a no-op.
- TC-009 (AC-008): Shift+F10 on a focused row opens the context menu (its items become visible); Escape closes it.
- TC-010 (AC-009): open >=2 request tabs, focus one, Space/ArrowRight/Space reorders them (order persisted).
- TC-011 (AC-011): begin rename on a row (F2), type an ArrowDown inside the input -> focus stays in the input, tree selection does NOT move.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Empty tree | No focusable rows; Tab skips the tree; keyboard handlers no-op (guard on empty flattened list). |
| Single row | ArrowUp/Down no-ops; that row is the tabbable one. |
| Rename in progress | Row keyboard handlers suppressed (AC-011); the rename input owns Enter/Escape. |
| During a mouse drag | Unchanged - keyboard handlers are independent of the pointer drag state. |

## 5. Edge cases

- Empty tree / all folders collapsed: flattened list is `[]` or root-only; every move/nav guards against out-of-range.
- Alt-move with no valid target (first/last sibling, no preceding folder, node already at root for outdent): no-op, no throw, no persist.
- Focused node deleted (Mod+Backspace) mid-session: next render's roving anchor falls back to `selectedNodeId ?? first row`; no crash.
- Arrow key while the Radix context menu is open: the menu owns the keys (its own focus trap) - the tree handler must not double-handle. Menu is a portal, so its key events don't bubble to the tree `<ul>`; no extra guard needed, verify in test.
- Non-writable workspace (no `onTreeChange`): navigation still works; Alt-moves are effectively no-ops because `moveNode` is a no-op there (mirror existing drag behavior).

## 6. Dependencies

- `@dnd-kit/core` `KeyboardSensor`, `@dnd-kit/sortable` `sortableKeyboardCoordinates` (already installed).
- Existing `flattenSelectable`, `rangeBetween` (tree-select.ts); `locateNode`, `findNode` (tree-locate.ts); context `selectNode`, `selectInTree`, `toggleFolder`, `moveNode`, `expandedFolderIds`, `selectedNodeId`.

## 7. Status: DONE

All gates green (typecheck 0, lint 0 errors, vitest 1767/1767, cargo 63/63, e2e 5/5).

### AC -> test traceability

| AC | Proving test(s) |
|----|-----------------|
| AC-001 | tree-keyboard-nav.test.tsx "should move focus and selection down/up if Arrow…", "…no-op if ArrowUp on the first row", "…skip a collapsed folder's children"; tree-keyboard.test.ts nav unit tests |
| AC-002 | tree-keyboard-nav.test.tsx "should open a request tab if Enter…", "should collapse a folder if Space…" |
| AC-003 | tree-keyboard-nav.test.tsx "should expand a folder if ArrowRight", "…first child if ArrowRight on an expanded folder", "…collapse an expanded folder if ArrowLeft", "…parent if ArrowLeft on a child leaf"; 9 resolver unit tests |
| AC-004 | tree-keyboard-nav.test.tsx "should focus the first/last visible row if Home/End" |
| AC-005 | tree-keyboard-nav.test.tsx "should extend the selection to the next row if Shift+ArrowDown" |
| AC-006 | tree-keyboard-nav.test.tsx "should keep exactly one tree row in the Tab order", "…move the tabbable row to follow the selection" |
| AC-007 | tree-keyboard-nav.test.tsx "should reorder a root node down…", "…no-op if Alt+ArrowUp on the first root sibling"; tree-keyboard.test.ts `treeMoveTarget` (9 cases: up/down/outdent/nest + null guards) |
| AC-008 | tree-keyboard-nav.test.tsx "should open the row context menu if Shift+F10…", "…if the ContextMenu key…", "…close if Escape", "…let the open menu own arrow keys (no double-handle)"; e2e "should open a tree row's context menu with Shift+F10" |
| AC-009 | tab-keyboard-reorder.test.tsx "should pick up a tab if Space…", "…release a grabbed tab if Space twice"; e2e "should reorder request tabs with the keyboard" (real browser rects) |
| AC-010 | tab-keyboard-reorder.test.tsx "should open the tab context menu if Shift+F10…"; e2e "should open a request tab's context menu with Shift+F10" |
| AC-011 | tree-keyboard-nav.test.tsx "should not move tree selection if ArrowDown is pressed inside the rename input" |
| AC-012 | all gates green (see above) |

### Notes / deviations from plan

- Added a shared `openContextMenuOnKey` helper (in tree-nav.tsx) that dispatches a synthetic
  `contextmenu` MouseEvent on Shift+F10 / ContextMenu key. The plan hoped the native
  keyboard->contextmenu path (Radix Trigger) would suffice, but neither jsdom NOR headless
  Chromium synthesizes it, so the explicit dispatch is required for AC-008/010 to work and be
  testable. Wired onto both tree rows and the request-tab wrapper.
- AC-009's full keyboard reorder is only provable in the Playwright e2e (dnd-kit's
  `sortableKeyboardCoordinates` needs real element rects; jsdom returns zero rects). The jsdom
  tests assert the observable halves (pickup sets aria-pressed, release clears it). The e2e waits
  for the dnd live-region to announce move-over the SECOND tab before dropping (dropping on the
  pickup-over-self announcement is a no-op).
- Added `focusNode` to the workspace context: moves single-selection WITHOUT opening a tab or
  toggling a folder (arrow-nav needs focus+select without side effects; `selectNode` opens/toggles).
