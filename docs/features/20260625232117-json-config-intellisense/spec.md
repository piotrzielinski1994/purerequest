# Spec: JSON Config IntelliSense

**Version:** 0.1.0
**Created:** 2026-06-25
**Status:** Draft

## 1. Overview

The three places in ReqUI where configuration is edited as raw JSON in a CodeMirror
editor have **fixed, known shapes** but today offer no schema awareness: typing into them
gives syntax highlighting + a JSON-parse linter and nothing else. No key completion, no
type/enum validation, no docs. This feature adds editor IntelliSense - **autocomplete,
schema validation (warnings), and hover documentation** - to those three editors, driven
by a JSON Schema generated from a single `zod` source of truth.

The three in-scope editors (all rendered through the shared `RawJsonEditor` shell in
`src/components/workspace/config-editor.tsx`):

| Editor surface | Component | Document shape |
| -------------- | --------- | -------------- |
| Folder config | `ConfigEditorForm` | `ConfigScope` |
| Request settings | `RequestSettingsForm` | `{ name, method, url, body, bodyMode?, bodyForm?, config }` |
| Theme colors | `ColorEditor` (`theme-section.tsx`) | `ThemeColors` (full, applied) |

### Scope boundary

- **In:** schema-driven autocomplete + validation-as-warnings + hover docs on the three
  JSON editors above, using the `codemirror-json-schema` library and `zod` +
  `zod-to-json-schema`.
- **Out:** user settings (`settings.json`) and keymappings (`keymap.json`). These are
  **not edited as JSON** - they use dedicated UI widgets (toggles, shortcut-capture rows).
  Adding raw-JSON editors for them is a separate feature (explicitly declined by the user
  for this scope).
- **Out:** rewriting the runtime load/merge validators (`mergeSettings`, disk-format
  `parseRequest`, etc.) to run zod. zod is introduced as the source of the **schema used
  for IntelliSense**; the existing structural parse gates that decide save-ability are
  left unchanged (see AC-006 / save-gate rule below). A drift-guard test keeps the zod
  schema aligned with the TS model types.
- **Out:** any change to on-disk format, Tauri commands, or Rust.

### Decisions captured (user)

- **Scope:** the three existing JSON editors only. No new editor surfaces.
- **Engine:** `codemirror-json-schema` (lint + autocomplete + hover from a JSON Schema),
  composed with the already-installed `@codemirror/lang-json` `json()`.
- **Schema source:** hand-authored `zod` (v4) schemas -> `z.toJSONSchema()` (built-in) ->
  JSON Schema. zod is the single source for the generated schema. (`zod-to-json-schema` was
  evaluated and dropped: it targets zod v3 and emits an empty schema under zod v4; zod v4's
  built-in generator works.)
- **Save gate on schema violation:** **warn, do not block.** Invalid JSON *syntax* still
  blocks save (red, unchanged). Schema violations (wrong type, missing required field,
  unknown key) render a **warning** squiggle + hover message and **do not** block save.
- **Unknown keys:** schemas are **closed** (`additionalProperties: false`) so typos
  (`aut2h`) surface as warnings - but per the rule above they still don't block save.

## 2. Acceptance Criteria

- AC-001: In each of the three editors, typing inside an object offers **key
  autocomplete** for the keys valid at that position per the schema (e.g. inside a
  `ConfigScope` object: `variables`, `environments`, `headers`, `params`, `auth`,
  `scripts`, `timeoutMs`).
- AC-002: Autocomplete offers **enum value** completion where the schema constrains a
  value to a fixed set (e.g. a request `method` completes to `GET`/`POST`/`PUT`/`PATCH`/
  `DELETE`; `auth.type` to `inherit`/`none`/`bearer`/`basic`; `bodyMode` to
  `json`/`none`/`form`/`multipart`).
- AC-003: A value whose type violates the schema (e.g. `timeoutMs: "soon"` where a number
  is required) shows a **warning** lint diagnostic with a human-readable message.
- AC-004: An **unknown key** (e.g. `aut2h` instead of `auth`) shows a **warning** lint
  diagnostic (closed schema), in every in-scope editor.
- AC-005: **Hovering** a known key shows a tooltip with that key's description sourced from
  the schema.
- AC-006: Schema violations (AC-003, AC-004, and any other zod-schema warning) **do not
  block saving**. Save remains gated only by the existing structural parse (invalid JSON
  syntax, or a document that cannot be turned into the saved object) - that gate is
  unchanged from today.
- AC-007: The generated JSON Schema is **derived from zod** via `z.toJSONSchema()`; a
  test asserts the zod schema's inferred type is assignable to / matches the corresponding
  hand-written TS model type (`ConfigScope`, the request-settings shape, `ThemeColors`), so
  the two cannot silently drift.
- AC-008: IntelliSense extensions are wired through the existing
  `useEditorExtensions`/`editor-theme` composition; the autocomplete popup and lint
  styling continue to follow the app theme tokens (no CodeMirror default-light chrome, no
  rounded corners).

## 3. User Test Cases

- TC-001 (happy path - key completion): Open a folder's config editor -> place caret in the
  top-level object -> trigger completion -> the `ConfigScope` keys are offered. Maps to:
  AC-001.
- TC-002 (happy path - enum completion): In the request settings editor, edit `"method":
  ""` -> trigger completion at the caret -> the five HTTP methods are offered; choosing one
  inserts it. Maps to: AC-002.
- TC-003 (type warning): In any editor, set a numeric field to a string (`"timeoutMs":
  "soon"`) -> a warning diagnostic appears on that line; the save shortcut still saves.
  Maps to: AC-003, AC-006.
- TC-004 (unknown-key warning): In the folder config editor, type a misspelled key
  (`"aut2h": {}`) -> a warning diagnostic flags the unknown key; save still works. Maps to:
  AC-004, AC-006.
- TC-005 (hover docs): Hover the `auth` key in a config editor -> a tooltip shows its
  description. Maps to: AC-005.
- TC-006 (syntax still blocks): Delete a closing brace so the JSON is malformed -> a red
  (error) diagnostic appears and the save shortcut does nothing (canSave false), exactly as
  today. Maps to: AC-006 (gate unchanged).
- TC-007 (drift guard): Change a zod schema so it diverges from its TS model type -> the
  drift-guard test fails. Maps to: AC-007.

## 4. UI States

| State | Behavior |
| ----- | -------- |
| Valid + schema-clean | Syntax highlight only, no diagnostics; autocomplete on demand. |
| Schema warning | Yellow/warning squiggle on the offending range + hover message; save still allowed. |
| Syntax error | Red error squiggle (existing `jsonParseLinter`); save blocked (canSave false). |
| Empty doc | No diagnostics (existing empty-tolerant behavior preserved where it applies). |
| Completion open | Popup styled with app theme tokens (popover bg/fg, accent selection, no rounded corners). |

## 5. Data Model

No persisted-data change. New **in-memory** artifacts only:

- `zod` schemas for `ConfigScope`, the request-settings document, and `ThemeColors`,
  authored to match the existing TS types in `src/lib/workspace/model.ts` and
  `src/lib/settings/settings.ts`.
- JSON Schemas generated from those zod schemas at module load via `z.toJSONSchema()`,
  each annotated with `.describe(...)` text that becomes hover documentation.

## 6. Edge Cases

- **Warn-vs-block tension:** a schema violation must not flip `canSave`. The zod-driven
  lint is advisory only; the save gate stays the existing structural `parse`. A field that
  is *structurally* required to build the saved object (e.g. request `method` must be a
  valid `HttpMethod` for `RequestPatch`) is still rejected by `parse` as today - that is
  not loosened. Only *additional* schema checks (unknown keys, optional-field type
  mismatches, enum-as-warning) are advisory.
- **Theme colors closed schema:** the applied theme doc has exactly `light`/`dark`, each
  with `tokens`/`editor` maps over the known token names. Unknown token names warn; the
  existing `parseThemeColors` structural gate (must have light/dark + maps) is unchanged.
- **`{{var}}` templating in values:** config string values may contain `{{token}}`
  placeholders. The schema treats these fields as plain strings, so templating never
  triggers a warning.
- **Empty document:** the request/folder config editors seed from `JSON.stringify(..)`, so
  an empty doc is only reachable by the user clearing everything - it then reads as a
  syntax error (not an object), which correctly blocks save; no schema warning needed.
- **Schema generation failure:** if `z.toJSONSchema()` produces an unexpected shape, the
  editor must still load (degrade to today's behavior: syntax lint only) rather than crash
  the pane.
- **Performance:** schema lint runs on a debounce (library default) so large request
  bodies/configs don't re-validate on every keystroke.

## 7. Dependencies

- New runtime deps: `codemirror-json-schema`, `zod` (v4; uses its built-in
  `z.toJSONSchema()`, no separate generator dep).
- Existing: `@codemirror/lang-json`, `@codemirror/autocomplete`, `@codemirror/lint`,
  `@uiw/react-codemirror` (all already present).
- Touches the shared editor composition (`editor-theme.ts`, `use-editor-extensions.ts`,
  `config-editor.tsx`, `theme-section.tsx`) - those editors must keep working unchanged
  for the body/viewer/console/env/script consumers that share the composition.
