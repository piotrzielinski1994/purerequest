# Plan - Tab-bar overflow + "Close other tabs"

Coverage threshold: none.

## Approach

Three orthogonal slices, each small and independently testable.

### Slice A - Per-bar horizontal scroll (AC-001/002)

Root cause: every section bar is `flex h-10.25 items-stretch border-b bg-muted/30` with no
overflow handling, so when its `TabsList`/selector is wider than the pane it clips instead of
scrolling. Fix = add `overflow-x-auto` to each bar wrapper so each owns its own horizontal
scroller (the shared thin webkit scrollbar from `index.css`, per `docs/design.md` Scrollbars -
no `ScrollArea`, matching the content-header strip). Independence (AC-002) is automatic: each
bar is a separate scroll container.

Bars to update (the `h-10.25 items-stretch` wrappers):

- `request-pane.tsx:38` - 7 section tabs (the main overflow case from the screenshot).
- `config-panels.tsx:285` - Script Pre/Post bar.
- `config-panels.tsx:177` - Auth-type selector bar.
- `body-panel.tsx:25` - Body-type selector bar.
- `folder-pane.tsx:37` - folder section tabs.
- `response-pane.tsx:79` - Response/Headers bar (has `justify-between` + status; add
  `overflow-x-auto` too; only 2 tabs so it rarely scrolls, kept uniform).

### Slice B - Sticky `+` (AC-003/004/005)

`content-header.tsx`: move `overflow-x-auto` off the OUTER bar and onto the inner tablist div,
and add `min-w-0` so the tablist shrinks below content width:

- Outer: `flex h-9 shrink-0 items-stretch border-b bg-muted/30` (no overflow).
- Inner tablist: `flex h-full items-stretch overflow-x-auto min-w-0` (holds cards + editor +
  settings tabs). Default `flex: 0 1 auto` + `min-w-0`: sizes to content when it fits (`+`
  follows immediately - AC-004), shrinks + scrolls when it overflows (AC-005).
- `+` button stays the last sibling, `shrink-0` -> always visible, pinned right on overflow
  (AC-003).

No `ScrollArea` (design.md: a re-parent breaks @dnd-kit). Plain overflow div = same scroller
the outer already had, just relocated; dnd pointer math unaffected.

### Slice C - "Close other tabs" (AC-006..010)

`workspace-context.tsx`:

- `PendingClose` += `{ kind: "others"; id: string }` (id = tab to KEEP).
- `closeOthers(id)`: `setOpenRequestIds([id])`, `setActiveRequestId(id)`, deactivate
  settings/editor, prune `requestOverrides`/`responseStates` to only `id`.
- `requestCloseOthers(id)`: no-op if `openRequestIds.length <= 1`; if any OTHER open tab is
  dirty -> `setPendingClose({ kind: "others", id })`; else `closeOthers(id)`.
- `confirmPendingClose`: `kind === "others"` -> `closeOthers(id)`.
- `savePendingClose`: `overrideIdsToFold` for `others` = `openRequestIds.filter(!== id)`;
  after persist -> `closeOthers(id)`.
- Export `requestCloseOthers` on the context value + type.

`close-confirm-dialog.tsx`: `describe()` handles `others` -> "N open requests have unsaved
changes." (count of OTHER dirty tabs).

`content-header.tsx`: wrap each `RequestTab` draggable div in a `ContextMenu` (mirror
`tree-row.tsx` `RowContextMenu`: `ContextMenuTrigger asChild` around the draggable). Items:
**Close** (`requestCloseRequest`), **Close other tabs** (`requestCloseOthers`, disabled when
`openRequestIds.length <= 1`), **Close all** (`requestCloseAll`).

`lib/shortcuts/registry.ts`: add action `close-other-requests` (name "Close other request
tabs", default `Mod+Alt+W`). `main.tsx`: handler closes others of `activeRequestId`
(guard non-null) -> appears in command palette automatically (AC-010).

## Files

- `src/components/workspace/request-pane.tsx` - Slice A
- `src/components/workspace/config-panels.tsx` - Slice A (x2 bars)
- `src/components/workspace/body-panel.tsx` - Slice A
- `src/components/workspace/folder-pane.tsx` - Slice A
- `src/components/workspace/response-pane.tsx` - Slice A
- `src/components/workspace/content-header.tsx` - Slice B + Slice C (context menu)
- `src/components/workspace/workspace-context.tsx` - Slice C (state/actions)
- `src/components/workspace/close-confirm-dialog.tsx` - Slice C (describe)
- `src/lib/shortcuts/registry.ts` - Slice C (action id)
- `src/components/workspace/main.tsx` - Slice C (handler)

## Edge cases

- Single open tab: "Close other tabs" disabled (menu) + no-op (command/shortcut). (AC-008)
- Target dirty: kept, so irrelevant; only closed tabs' dirtiness opens the dialog. (AC-009)
- Active tab is among the closed others: kept tab becomes active. (AC-007)
- Editor/settings tabs: left as-is; "close others" closes only other request tabs.
- Context menu over a draggable: mirror tree-row (proven safe with @dnd-kit).

## Tests (RED first)

- `content-header.test.tsx`: `+` present after last card (fit); context menu opens with the 3
  items; "Close other tabs" closes all but target and activates it; disabled with one tab.
- `request-pane.test.tsx` (or a small layout test): the section bar wrapper carries
  `overflow-x-auto`.
- workspace-context behavior test: `requestCloseOthers` keeps only target (clean);
  dirty-others sets `pendingClose.kind === "others"`; confirm closes; single-tab no-op.
- shortcuts: `close-other-requests` action registered + reachable via palette handler.

## Acceptance verification

Run `npm test` (Vitest) green incl. new tests; `npm run lint` + `npm run typecheck` clean.
Manual: narrow window -> each bar scrolls alone; `+` stays put; right-click tab -> Close
other tabs.

## AC -> test traceability (verified GREEN)

| AC     | Test |
| ------ | ---- |
| AC-001 | `bar-overflow.test.tsx` - 6 bar wrappers carry `overflow-x-auto` |
| AC-002 | `bar-overflow.test.tsx` - each bar a separate overflow container (structural) |
| AC-003 | `content-header.test.tsx` "keep the New request button outside the scrolling tablist" (`tablist.contains(plus)===false`, `+` is `shrink-0`) |
| AC-004 | same (tablist `min-w-0` sizes to content; `+` follows) |
| AC-005 | same (overflow on inner tablist; `+` pinned `shrink-0` outside) |
| AC-006 | `content-header.test.tsx` "open a context menu with Close, Close other tabs and Close all" |
| AC-007 | `close-others-context.test.tsx` "keep only the target tab open and active" + content-header menu test |
| AC-008 | `close-others-context.test.tsx` no-op with one tab + content-header "disable Close other tabs" |
| AC-009 | `close-others-context.test.tsx` dialog-opens / Discard / Cancel / Save |
| AC-010 | `close-others-palette-shortcut.test.tsx` + `shortcuts-section-new-actions.test.tsx` + `resolve.test.ts` |

## Decision Log

| Date       | Decision | Rationale |
| ---------- | -------- | --------- |
| 2026-06-25 | Per-bar scroll via CSS `overflow-x-auto` only (no `ScrollArea`) | Matches design.md: the global thin webkit scrollbar covers self-scrolling surfaces; `ScrollArea` re-parents + breaks dnd. jsdom can't measure layout, so class assertions are the test proxy. |
| 2026-06-25 | `+` moved out of scroller; scroll relocated to inner tablist (`min-w-0 overflow-x-auto`) | Default `flex:0 1 auto` + `min-w-0` makes the tablist size to content when it fits and scroll when it overflows; `shrink-0` `+` sibling stays pinned right. |
| 2026-06-25 | Close-others bound to `Mod+Alt+W` | VSCode "Close Other Editors" has NO default key; user asked to keep a shortcut. `Mod+W`/`Mod+Shift+W` already match VSCode close/close-all. Reassignable in Settings. |
| 2026-06-25 | Reuse `PendingClose` confirm dialog via new `{kind:"others",id}` variant | Mirrors the existing one/all/editor dirty-close flow; no new dialog, save/discard/cancel behave identically. |
| 2026-06-25 | Domain gate: neither pz-ddd nor pz-archetypes apply | Pure UI/layout change, no domain model/boundaries/aggregates touched. |
