# Tab-bar overflow handling + "Close other tabs"

## Overview

When the window (or a pane) is too narrow, the horizontal bars in the request/response
area overflow and clip their content (e.g. "Headers" tab cut to "lers", a grid cell sliced
off) instead of scrolling. This feature makes each bar own its own horizontal scroll, keeps
the request-tab strip's `+` button always reachable, and adds a "Close other tabs" action.

Three independent changes:

1. **Per-bar horizontal scroll.** Every section bar (the request pane's
   Vars/Auth/Headers/Params/Body/Script/Settings tabs, the folder pane's equivalent, the
   Script panel's Pre/Post tabs, the Body/Auth type selectors, and the response pane's
   Response/Headers tabs) scrolls horizontally on its own when its content exceeds the
   available width, rather than clipping. Each bar scrolls independently of the others.

2. **Sticky `+` on the request-tab strip.** The open-request card strip already scrolls.
   The `+` (new request) button must stay visible at all times: it sits immediately to the
   right of the last card when the cards fit, and glues to the right edge once the cards
   overflow and scroll under it.

3. **"Close other tabs" action.** Close every open request tab except a chosen one. Exposed
   three ways: a right-click context menu on a request tab, a command-palette command, and a
   keyboard shortcut. Unsaved changes in the tabs being closed trigger the existing
   save/discard confirm dialog.

## Acceptance Criteria

- AC-001: Each section bar (request tabs, folder tabs, script Pre/Post, body/auth selector,
  response tabs) scrolls horizontally within itself when its content is wider than the bar,
  instead of clipping or pushing content out of view.
- AC-002: Each bar scrolls independently - scrolling one bar does not move any other bar.
- AC-003: The request-tab `+` button is always visible regardless of how many tabs are open
  or how far the strip is scrolled.
- AC-004: When the open request cards fit in the strip, the `+` sits immediately to the right
  of the last card.
- AC-005: When the cards overflow, the `+` is pinned to the right edge while the cards scroll
  underneath/beside it.
- AC-006: Right-clicking a request tab opens a context menu containing "Close", "Close other
  tabs", and "Close all".
- AC-007: "Close other tabs" (from any of the three entry points) closes every open request
  tab except the target, leaving exactly the target tab open and active.
- AC-008: "Close other tabs" is unavailable / a no-op when the target is the only open tab.
- AC-009: If any of the tabs being closed by "Close other tabs" has unsaved changes, the
  existing unsaved-changes dialog appears; Save persists then closes the others, Discard
  closes without saving, Cancel keeps everything open.
- AC-010: A "Close other request tabs" action exists in the command palette and as a
  keyboard shortcut; both target the active request tab.

## User Test Cases

- TC-001 (happy, AC-001/002): Narrow the request pane so the 7 section tabs don't fit -> the
  tab bar shows a horizontal scrollbar and all tabs are reachable by scrolling; the URL bar
  above and the response pane are unaffected. Maps to: AC-001, AC-002.
- TC-002 (happy, AC-003/004): Open two requests in a wide window -> `+` sits right after the
  second card with empty space to its right. Maps to: AC-003, AC-004.
- TC-003 (happy, AC-005): Open enough requests to overflow the strip -> the strip scrolls and
  `+` stays pinned at the right edge, always clickable. Maps to: AC-003, AC-005.
- TC-004 (happy, AC-006/007): Right-click the 2nd of 3 open tabs -> menu -> "Close other
  tabs" -> only the 2nd remains, and it is active. Maps to: AC-006, AC-007.
- TC-005 (edge, AC-008): Right-click the only open tab -> "Close other tabs" is disabled (or
  closes nothing). Maps to: AC-008.
- TC-006 (edge, AC-009): One of the other tabs has unsaved edits -> "Close other tabs" opens
  the unsaved-changes dialog naming the count; Discard closes them, Save persists then closes,
  Cancel aborts. Maps to: AC-009.
- TC-007 (happy, AC-010): Open the command palette -> "Close other request tabs" runs and
  closes all but the active tab; the bound shortcut does the same. Maps to: AC-010.

## UI States

| State                | Behavior                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| Bar fits             | No scrollbar; bar renders as today.                                      |
| Bar overflows        | Bar shows the shared thin macOS-style horizontal scrollbar; scrolls.     |
| Strip fits           | `+` immediately right of last card, gap to the right edge.               |
| Strip overflows      | Cards scroll; `+` pinned to the right edge, fully visible.               |
| Single tab open      | "Close other tabs" disabled in the menu; command/shortcut is a no-op.    |
| Closing dirty others | Unsaved-changes dialog: Save / Discard / Cancel (existing dialog reused). |

## Data Model

No persisted model change. One in-memory addition: a new `PendingClose` variant
`{ kind: "others"; id: string }` (the id of the tab to keep) so the existing confirm dialog
can drive the "close others" flow. A new context action `requestCloseOthers(id)` plus the
underlying `closeOthers(id)`. A new shortcut action id `close-other-requests`.

## Edge Cases

- Single open tab -> "Close other tabs" is a no-op / disabled (AC-008).
- Target tab itself is dirty -> it is KEPT, so its dirtiness is irrelevant; only the
  closed tabs' dirtiness triggers the dialog.
- Active tab is one of the "others" being closed -> after close, the kept tab becomes active.
- The Settings tab / config / .env editor tabs: out of scope for "close others" (mirrors the
  existing close-all, which closes request tabs + settings but leaves the editor tab). "Close
  other tabs" closes only other REQUEST tabs and keeps the chosen request active.
- Right-click drag interaction: the context menu must not interfere with the existing
  pointer-drag reorder (mirrors the tree-row pattern, which wraps a draggable in a
  ContextMenu safely).

## Dependencies

- Existing `ContextMenu` primitive (`src/components/ui/context-menu.tsx`), already used by
  `tree-row.tsx`.
- Existing close/confirm flow in `workspace-context.tsx` + `close-confirm-dialog.tsx`.
- Existing shortcut registry + command palette (`lib/shortcuts/registry.ts`, `main.tsx`).
- Shared scrollbar treatment (`docs/design.md` "Scrollbars"): overflowing bars fall back to
  the global thin webkit scrollbar, same as the content-header strip - no `ScrollArea`
  (it would re-parent and break dnd / add complexity).
