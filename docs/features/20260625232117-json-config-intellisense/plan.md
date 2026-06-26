# Plan: JSON Config IntelliSense

Implements [spec.md](spec.md). TDD, red-green-refactor. Coverage threshold: none.

## Approach

One JSON Schema per editor surface, **generated from `zod`** at module load, fed to the
`codemirror-json-schema` extension set, composed into the existing editor-extension
factory. The wiring is additive: the three in-scope editors get a *new* extension list
(`schemaConfigExtensions`) that layers schema lint (as **warnings**), schema autocomplete,
and schema hover on top of today's `json()` + chrome + highlight. The body/viewer/console/
env/script consumers keep their current extension lists untouched.

The schema is advisory only. `codemirror-json-schema`'s linter is wrapped so its
diagnostics are downgraded to `severity: "warning"` and merged with the existing
empty-tolerant `jsonParseLinter` (which keeps emitting `severity: "error"` for malformed
JSON). `canSave` stays wired to the existing structural `parse` in `RawJsonEditor` - schema
warnings never touch it. That keeps AC-006 true with zero change to the save path.

zod is the single source for each generated schema. A drift-guard test asserts each zod
schema's `z.infer` matches the corresponding hand-written TS model type, so the schema
can't silently diverge from `ConfigScope` / the request-settings shape / `ThemeColors`.

No on-disk format change, no Rust change, no new editor surface.

### Why a separate extension list (not reusing `configExtensions`)

`useEditorExtensions` returns one `configExtensions` shared by folder config, request
settings, **and** is keyed only on theme colors. The three editors need *different*
schemas, so the schema can't live in the shared memo as-is. Plan: `useEditorExtensions`
gains a `schemaExtensions(schema)` builder (or the three editors call a small
`useSchemaEditorExtensions(schema)` hook) that composes the base config extensions + the
schema-specific lint/complete/hover for the passed schema. Base chrome/highlight stay
shared and theme-keyed.

## Library surface (`codemirror-json-schema`)

Exports used: `jsonSchemaLinter()`, `jsonSchemaHover()`, `jsonCompletion()`,
`stateExtensions(schema)`. Wiring mirrors the README json4 example:

```
[ json(),
  linter(emptyTolerantJsonLinter()),                 // existing: syntax -> error
  linter(asWarning(jsonSchemaLinter())),             // new: schema -> warning
  jsonLanguage.data.of({ autocomplete: jsonCompletion() }),
  hoverTooltip(jsonSchemaHover()),
  stateExtensions(jsonSchema),                        // holds the active schema
  makeChrome(...), makeHighlight(...) ]
```

`asWarning` maps each `Diagnostic` to `severity: "warning"`. (If the library already emits
warnings for everything we care about, `asWarning` collapses to identity - confirm during
GREEN against the real diagnostics.)

## Files

### Create

- `src/lib/config-schema/zod-schemas.ts` - `zod` schemas: `configScopeSchema`,
  `requestSettingsSchema`, `themeColorsSchema`, each built `.strict()` (closed) with
  `.describe(...)` on documented keys. Exports the inferred types for the drift guard.
- `src/lib/config-schema/json-schemas.ts` - runs `z.toJSONSchema(.., {target:"draft-7"})`
  on each, exports
  `configScopeJsonSchema`, `requestSettingsJsonSchema`, `themeColorsJsonSchema`. Wrapped so
  a generation throw degrades to `undefined` (editor falls back to syntax-only lint).
- `src/components/workspace/schema-intellisense.ts` - `makeSchemaExtensions(jsonSchema,
  colors, isDark): Extension[]` composing the library extensions + `asWarning` linter +
  base chrome/highlight. Pure factory (mirrors `editor-theme.ts` style).
- Tests:
  - `src/lib/config-schema/__tests__/zod-schemas.test.ts` - drift guard (AC-007): type-level
    assignability (`expectTypeOf`/`assertType`) zod-infer <-> `ConfigScope`,
    request-settings shape, `ThemeColors`; plus a couple of `safeParse` behavior checks
    (valid passes, unknown key fails, wrong type fails).
  - `src/lib/config-schema/__tests__/json-schemas.test.ts` - generated schema has the
    expected top-level keys, `additionalProperties:false`, method enum present; generation
    never throws.
  - `src/components/workspace/__tests__/schema-intellisense.test.ts` - factory returns the
    expected extension set; the schema linter's diagnostics come out as `warning`, the
    syntax linter still emits `error` for malformed JSON (drive via a live `EditorState`
    like `script-lint.test.ts`).
  - `src/components/workspace/__tests__/schema-intellisense-editor.test.tsx` - render-level:
    in a config editor, an unknown key / wrong type yields a warning diagnostic but
    `canSave` stays true (save still fires `onTreeChange`); malformed JSON blocks save.

### Modify

- `src/components/workspace/use-editor-extensions.ts`
  - Add a builder so the three editors can request schema-aware extensions for a given
    schema while sharing theme-keyed chrome/highlight. Either expose `makeSchemaExtensions`
    bound to current colors, or add `useSchemaEditorExtensions(schema)`. Keep the existing
    `configExtensions` for any consumer that wants schema-less behavior.
- `src/components/workspace/config-editor.tsx`
  - `ConfigEditorForm` -> pass `configScopeJsonSchema` to the editor.
  - `RequestSettingsForm` -> pass `requestSettingsJsonSchema`.
  - `RawJsonEditor` gains an optional `schema?` prop; when present it uses the schema
    extension list, else the plain `configExtensions` (back-compat). `canSave`/`parse`
    untouched.
- `src/components/settings/theme-section.tsx`
  - `ColorEditor` -> pass `themeColorsJsonSchema` to `RawJsonEditor`.
- `package.json` - add `codemirror-json-schema`, `zod` (v4; built-in `z.toJSONSchema()`).
- `README.md` - note the three new deps if the deps list is enumerated there (check before
  committing per CLAUDE.md drift rule).

## Edge cases handled (from spec section 6)

- **Warn-not-block:** `asWarning` + `canSave` untied from schema lint -> AC-006.
- **Closed schemas:** `.strict()` on every zod object -> unknown-key warnings (AC-004).
- **`{{var}}` values:** string fields stay `z.string()` -> templating never warns.
- **Schema-gen failure:** `json-schemas.ts` catches generation errors -> `undefined` ->
  `makeSchemaExtensions` skips the schema pieces, editor degrades to syntax-only.
- **Empty doc:** existing empty-tolerant syntax linter + structural parse unchanged.
- **Performance:** schema linter uses the library's debounce (set `delay` like the README's
  300ms) so large docs don't re-lint per keystroke.

## Tests to write (>= 1 per AC)

| AC | Test |
| -- | ---- |
| AC-001 | completion offers ConfigScope keys (factory/editor test) |
| AC-002 | completion offers method/auth.type/bodyMode enums |
| AC-003 | wrong-type value -> warning diagnostic |
| AC-004 | unknown key -> warning diagnostic |
| AC-005 | hover known key -> description tooltip |
| AC-006 | schema warning keeps canSave true; malformed JSON blocks save |
| AC-007 | zod<->TS drift guard (type-level) |
| AC-008 | schema extensions compose through the themed chrome/highlight |

## Execution order

1. RED: drift-guard + zod/json schema tests, factory + editor tests (all failing).
2. GREEN: `zod-schemas.ts` -> `json-schemas.ts` -> `schema-intellisense.ts` -> wire the
   three editors + `RawJsonEditor` `schema?` prop.
3. REFACTOR: fold `asWarning`/identity, dedupe extension composition with `editor-theme.ts`.
4. VERIFY: `npm run lint`, `npm run typecheck`, `npm test`; fresh verifier subagent.

## Risks

- **Library diagnostic severity unknown:** `codemirror-json-schema` may already emit
  warnings or may emit errors. Mitigation: `asWarning` normalizes regardless; confirm real
  output in GREEN, drop the wrapper if redundant.
- **jsdom + CodeMirror completion/hover:** completion popups and hover tooltips are hard to
  assert in jsdom (see existing learnings - radix portals, CM driven via live EditorView).
  Mitigation: unit-test the completion/lint *sources* against a live `EditorState` (as
  `script-lint.test.ts` does) rather than asserting rendered popups; cover the visible
  popup path by manual test, noted in the test file.
- **zod v4 API (RESOLVED during setup):** `zod-to-json-schema` v3 emits an empty schema
  under zod v4 - dropped it; use zod v4's built-in `z.toJSONSchema(schema, { target:
  "draft-7" })` instead (verified: emits proper `properties`/enums/`additionalProperties`/
  `description`). The json-schema test guards against a broken generation.
- **Bundle size:** three new deps. Mitigation: all small, tree-shaken; acceptable for the
  feature value.
