# `{{var}}` autocomplete in the CodeMirror body + config editors

## Overview

`{{var}}` token autocomplete already ships in `HighlightedInput` - the one token-aware
text input used by the URL bar, the key/value grids (headers/params/vars), and the auth
fields - driven by the pure core in `token-complete.ts` (`tokenCandidates`,
`tokenCompletionAt`, `applyTokenCandidate`). It does **not** exist in the CodeMirror
editors: typing `{{` in a JSON/text request **body** or in a raw-JSON **config** editor
gives no in-scope variable / environment / `.env` dropdown.

This closes that gap so the completion surface is uniform. A thin CodeMirror
`CompletionSource` reuses the existing tested core and is wired through the same
language-data `autocomplete` facet that the JSON-schema IntelliSense already uses - so it
**composes with** (does not replace) schema completion in the config editors.

**In scope:**

- Request **Body** editor (JSON / text slot).
- Folder-config raw-JSON editor (`ConfigEditorForm`).
- Request-Settings raw-JSON editor (`RequestSettingsForm`).

**Out of scope (deliberate):**

- **Script editor** - scripts are NOT `{{}}`-interpolated. A script reads variables via
  `requi.getVar("X")` / `bru.getVar("X")` and runs verbatim in QuickJS; `{{X}}` in JS is
  not substituted, so offering `{{var}}` completion there would suggest syntax that does
  nothing. The script editor keeps its `scriptApiCompletion` (the `req.`/`res.`/`requi.`
  API) unchanged.
- **Theme-colors** JSON editor - holds `oklch(...)` strings with no `{{}}` tokens and no
  request scope; token completion has nothing meaningful to offer. Unchanged.
- Introspection / schema-aware completion of token *values* (only names are completed, as
  in `HighlightedInput` today).

Mirrors the completion behavior already proven in `HighlightedInput`; the ranking,
filtering, and insert semantics are the identical pure functions, so the two surfaces
cannot drift.

## Acceptance Criteria

- AC-001: In the request **Body** editor, placing the caret right after a typed `{{`
  opens a completion dropdown listing every in-scope token (resolved variables + active
  environment's vars + `.env` keys as `process.env.X`), ordered/grouped identically to
  the `HighlightedInput` dropdown (nearest scope first; groups variable -> environment ->
  dotenv; alphabetical within a group).
- AC-002: Typing a prefix after `{{` filters the candidates by case-insensitive substring
  (identical to `tokenCompletionAt`); a prefix matching nothing shows no dropdown.
- AC-003: Accepting a candidate replaces the typed prefix with the full token name and
  auto-closes with `}}` **unless** a `}}` already follows the caret (no doubled braces);
  the caret lands just after the closing `}}`.
- AC-004: The dropdown does NOT open when the caret is in plain text (no open `{{`) or is
  just past an already-closed `{{...}}` token.
- AC-005: The body candidates are resolved against the **active request's** scope (its
  effective variables + active environment + folded `.env`), matching what the Body-tab
  `{{var}}` highlight already previews.
- AC-006: In the **folder-config** raw-JSON editor, `{{` completion offers that folder's
  own resolved scope tokens, and it composes with the existing JSON-schema completion
  (schema keyword completion still fires; both sources' options can appear).
- AC-007: In the **request-Settings** raw-JSON editor, `{{` completion offers the
  request's resolved scope tokens and composes with the schema completion.
- AC-008: The **theme-colors** JSON editor and the **script** editor get NO `{{var}}`
  completion (unchanged from today).

## Test Cases

- TC-001 (happy, AC-001/005): a `CompletionContext` over doc `{{` with the caret after it
  returns all candidates, with `from` = the index just after `{{`. Maps to: AC-001, AC-005.
- TC-002 (filter, AC-002): doc `{{ba`, caret at end -> the source returns only candidates
  whose name contains `ba` (e.g. `BASE_URL`). Maps to: AC-002.
- TC-003 (no match, AC-002): doc `{{zzz`, caret at end -> the source returns null. Maps
  to: AC-002.
- TC-004 (apply auto-close, AC-003): accepting `BASE_URL` at `{{ba` yields `{{BASE_URL}}`
  with the caret after the `}}`. Maps to: AC-003.
- TC-005 (apply no double-close, AC-003): accepting at `{{ba}}` (caret before `}}`) yields
  `{{BASE_URL}}` (one pair of braces, caret after). Maps to: AC-003.
- TC-006 (closed-token, AC-004): doc `{{BASE_URL}}/x`, caret at end -> null. Maps to: AC-004.
- TC-007 (plain text, AC-004): doc `/api/path`, caret at end -> null. Maps to: AC-004.
- TC-008 (body integration, AC-001): render `BodyEditor` with candidates, type `{{` into
  the live editor -> `.cm-tooltip-autocomplete` renders with the candidate names. Maps to:
  AC-001.
- TC-009 (config composes, AC-006/007): the folder-config and request-Settings editors
  carry BOTH the token source and the JSON-schema source in their language-data
  autocomplete. Maps to: AC-006, AC-007.
- TC-010 (excluded surfaces, AC-008): the theme-colors editor and the script editor mount
  with NO token completion source. Maps to: AC-008.

## UI States

| State   | Behavior                                                                       |
| ------- | ------------------------------------------------------------------------------ |
| Loading | N/A - candidate data is synchronous, resolved in-memory from the tree.         |
| Empty   | No in-scope tokens -> `{{` opens nothing (the source returns null on an empty candidate list). |
| Error   | N/A - no async, no failure surface.                                            |
| Success | `{{` (optionally + a prefix) shows the themed autocomplete popup; Enter/Tab/click accepts, inserting `{{name}}`. |

### Wireframe - Body editor, caret after `{{ba`

URL bar (active request): `{{BASE_URL}}/users`

```
+----------------------------------------------------------------+
| JSON | None | Form URL Encoded | Multipart Form                |  <- body-type bar
+----------------------------------------------------------------+
| {                                                              |
|   "id": "{{ba|"                                                |  <- caret after {{ba
|          +--------------------------------------------+        |
|          | BASE_URL                            asd1   |        |  <- variable group (nearest scope first)
|          | DB_BASE                             lts    |        |
|          | process.env.BASE_HOST               .env   |        |  <- dotenv group last
|          +--------------------------------------------+        |
| }                                                              |
+----------------------------------------------------------------+
```

The popup chrome is the already-themed `.cm-tooltip-autocomplete` (see
`editor-theme.ts` `makeChrome`): popover background/foreground, a 1px `--border` outline,
no rounded corners (design contract), accent background on the selected row, `--primary`
on the matched characters.

### Wireframe - Folder-config JSON editor, caret after `{{`

```
+----------------------------------------------------------------+
| Vars | Auth | Headers | Script | Env | Settings                |  <- folder pane tabs
+----------------------------------------------------------------+
| {                                                              |
|   "headers": [                                                 |
|     { "key": "Authorization", "value": "Bearer {{|" }          |  <- caret after {{
|          +--------------------------------------------+        |
|          | API_TOKEN                                  |        |  <- token source
|          | "value" (schema)                           |        |  <- JSON-schema source (composed)
|          +--------------------------------------------+        |
|   ]                                                            |
| }                                                              |
+----------------------------------------------------------------+
```

## Data Model

No data-model change. This feature is presentation-only.

- Reuses `TokenCandidate` / `TokenCompletion` from `token-complete.ts` verbatim.
- Reuses `EffectiveConfig` (via `resolveConfig`) and the folded `.env`
  (`resolveProcessEnv`) already computed for each scope's `{{var}}` highlight.
- No new fields on `RequestNode` / `FolderNode` / `ConfigScope`; nothing is persisted.

## Edge Cases

- E-1: `{{` with nothing in scope -> `tokenCompletionAt` returns null (existing behavior)
  -> no dropdown.
- E-2: `{{` inside vs outside a JSON string -> the source reads the raw doc and is
  language-agnostic, so it fires either way; a token outside a string is invalid JSON but
  harmless (the existing lint flags it).
- E-3: `closeBrackets` in the body editor auto-inserts `}}` when `{{` is typed - the
  `hasClose` branch of `applyTokenCandidate` prevents doubled braces. The config editors
  have no `closeBrackets`, so `apply` adds the `}}` itself.
- E-4: Editing an existing `{{ba}}` token with the caret inside it -> `tokenCompletionAt`
  already supports a trailing `}}`; apply replaces only the prefix.
- E-5: A `process.env.KEY` candidate has a dot in its name -> `validFor` includes `.` so
  the dropdown keeps filtering as the dotted key is typed.
- E-6: A multi-line body with an unclosed `{{` on a prior line -> `openTokenAt` scans the
  flat doc string, so the token still counts as open (same semantics as the input;
  acceptable).

## Dependencies

- `@codemirror/autocomplete` (^6.20.3, already a dep) - `CompletionSource`,
  `CompletionContext`, `Completion`.
- `@codemirror/lang-json` `jsonLanguage.data.of({ autocomplete })` - the compose seam
  (same one `schema-intellisense.ts` uses).
- Existing pure core `token-complete.ts` (`tokenCandidates`, `tokenCompletionAt`,
  `applyTokenCandidate`) - reused unchanged.
- Existing `resolveConfig` / `resolveProcessEnv` and the workspace context's
  `effectiveConfig` / `processEnv` / `rootProcessEnv` / `tree` / `activeEnvironment`.
- No new packages.

## Out of Scope (YAGNI)

- Script editor and theme-colors editor completion (see Overview).
- Completing token *values* (only names, as today).
- A new keybinding or a manual "trigger completion" affordance beyond CodeMirror's default
  auto-trigger.
