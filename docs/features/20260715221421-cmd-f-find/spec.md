# Cmd+F find bar for CodeMirror surfaces

## Overview

Port dbui's design-clean find bar to requi. Pressing the `open-find` binding (default `Mod+F`)
over any CodeMirror surface opens a styled top panel - query input, active/total match count,
prev/next, close - replacing CodeMirror's default unstyled bottom search panel. The open
binding is a rebindable registry action, so it appears in Settings and the command palette
like every other shortcut. requi has no data grid, so only the CodeMirror surfaces are in
scope (request body, config/request-settings, `.env`, response viewer, console object viewer,
script editor, GraphQL query editor).

## Acceptance Criteria

- AC-001: A rebindable `open-find` action (default `Mod+F`) exists in the shortcut registry, listed in Settings + the command palette.
- AC-002: The resolved open-find binding, pressed inside a CodeMirror surface, opens the shared styled `FindBar` top panel (not CodeMirror's default panel).
- AC-003: The find bar reflects the query, shows the 1-based active/total count (`0/0` when empty/no match), and steps matches via prev/next and Enter / Shift+Enter.
- AC-004: Escape or the close button closes the panel and returns focus to the editor.
- AC-005: All in-scope CodeMirror surfaces get find (body, config/request-settings, response viewer, console viewer, script, GraphQL). The `.env` editor is a key-value table, not a CodeMirror surface, so it is out of scope.
- AC-006: The palette "Find" command re-fires the open-find binding at the focused surface (no global find state).
- AC-007: The `FindBar` is design.md-compliant: no rounded corners, theme tokens, IDE density, 1px dividers, autofill opt-out attrs.

## User Test Cases

- TC-001..004: FindBar shows query/count, disables prev/next at 0 matches, fires onQueryChange / onSubmit(back) / onClose.
- TC-005: registry has `open-find` @ `Mod+F`; resolveShortcuts + findConflict honor it.
- TC-006: mounting an editor with `editorFind(key)` + firing the key opens a panel rendering the FindBar input.
- TC-007: `toCodeMirrorKey` bridges "Mod+F"->"Mod-f", keeps named keys, returns null on invalid.

## Data Model

No new persisted model. `open-find` joins `ShortcutActionId`; overrides persist in the existing
`settings.shortcuts` map.

## Edge Cases

- @uiw `basicSetup` keeps `searchKeymap`, so the built-in `Mod-F` also opens the (now-styled)
  FindBar even after rebinding open-find. Documented limitation (dbui parity, YAGNI).
- Read-only viewers (response/console): `search()` is find-only, safe on `EditorState.readOnly`.

## Dependencies

`@codemirror/search` (transitive v6, exports verified) - no new install.
