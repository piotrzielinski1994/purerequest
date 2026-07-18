# Plan: Import OpenAPI document

From the approved [spec.md](spec.md). TDD order. Mirrors the Bruno / Postman import features (pure core +
context/UI wiring), but the source is a **single file** (JSON or YAML) whose **flat `paths` map** is
walked into a synthesised per-tag tree. **No Rust change**, **no new npm dep** (reuses the existing `yaml`
dependency + `JSON.parse`).

## Approach

Two pure, React-free modules carry the logic:

- **Parse** = `parseOpenapiDocument(text): OpenapiDoc | null` in `parse-openapi.ts` - total (no throw). Try
  `JSON.parse`, else `yaml.parse`; version-gate on `openapi: "3.x"` (a `swagger` field or missing/other
  `openapi` -> `null`). Returns a typed-ish `OpenapiDoc` (fields validated lazily during mapping; all
  reads are `unknown`-narrowed, no `any`). A local `$ref` resolver (`#/a/b/c` JSON-pointer walk over the
  root doc, with a `seen`-set / depth guard for cycles) is used by the mapper for path items, parameters,
  requestBody, and example nodes.
- **Map** = `openapiToTree(text, fallbackName): TreeNode[]` in `openapi-to-tree.ts` - parses, then:
  1. `serversOf(doc)` -> a `baseUrl` variable (first server, template-filled, trailing `/` stripped) +
     (when 2+ servers) an `Environment[]`.
  2. `authOf(doc)` from global `security` + `components.securitySchemes` (http/bearer|basic -> `authOf`,
     else none).
  3. Walk `paths`: for each path key, resolve a `$ref` path-item, merge path-level `parameters`, then for
     each supported method key build a `RequestNode` (name, url `{{baseUrl}}` + `{x}`->`:x`, param grids,
     json-example body). Group each op under its **first** tag (a `Map<tag, FolderNode>` created lazily,
     first-appearance order); untagged ops go directly on the root's `children`.
  4. Wrap in one root `FolderNode` (name = `info.title` || fallback) carrying the baseUrl var / envs /
     auth in `config`. Empty (no ops) -> `[]`. Synthetic `openapi-<n>` ids from a shared id-gen.

Body / param / auth mapping use small dispatch tables (strategy, not if-ladders) mirroring the Postman
parser's style. Path-templating rewrite `{name}` -> `:name` is a single regex.

The reader port (`OpenapiReader`) is the third seam - native single-file pick + `readTextFile`, returning
`{ name, text }` (NOT a file map - one file). Threaded loader -> layout -> main as a prop, exactly like the
Bruno / Postman readers. No `.env` merge (OpenAPI carries none).

## File changes

**Pure core (no UI, no React):**
- `src/lib/openapi/parse-openapi.ts` (new) - `parseOpenapiDocument(text): OpenapiDoc | null` +
  `OpenapiDoc` type + a local `resolveRef(root, node, seen)` helper (exported for the mapper). JSON-then-
  YAML parse, version gate, cycle-guarded `#/` pointer resolution.
- `src/lib/openapi/openapi-to-tree.ts` (new) - `openapiToTree(text, fallbackName): TreeNode[]`. Internal:
  `serversOf` (baseUrl var + envs), `securityAuthOf` (root auth), `operationToRequest` (name/url/params/
  body), tag grouping, root wrap. Body-example extraction + `{name}`->`:name` rewrite live here.

**Reader port:**
- `src/lib/openapi/reader.ts` (new) - `OpenapiReader` type, `createTauriOpenapiReader()`
  (`open({multiple:false, filters:[{extensions:["json","yaml","yml"]}]})` + `readTextFile`),
  `createNoopOpenapiReader()`. Mirrors `src/lib/postman/reader.ts` (simpler - single file, no dir walk).

**Shortcut registry:**
- `src/lib/shortcuts/registry.ts` - add `import-openapi` (default `Mod+Shift+O`) to the `ShortcutActionId`
  union + `SHORTCUT_ACTIONS` (after `import-postman`). `Mod+Shift+O` is free (only `Mod+O` = open-workspace
  exists).
- `src/lib/shortcuts/__tests__/resolve.test.ts` - add `"import-openapi"` to the hard-coded `ACTION_IDS`
  (asserted exhaustively against the registry; adding the action without it goes RED).

**Context (action + insert):**
- `src/components/workspace/workspace-context.tsx` - add `importOpenapi(text, name)` to the context value
  + type: `openapiToTree` -> guard empty (no children -> no-op) -> insert the root folder at workspace root
  (reuse the exact `importBruno`/`importPostman` insert/expand/select/persist idiom) -> toast "Imported
  OpenAPI document". No `.env` merge.

**UI wiring (mirror the `postmanReader` thread):**
- `src/components/workspace/main.tsx` - accept an `openapiReader` prop, add
  `"import-openapi": importOpenapiDocument` (via `openapiReader.pick()`) to `handlers`.
- `src/components/workspace/workspace-layout.tsx` - thread `openapiReader` through to `Main`.
- `src/components/workspace/workspace-loader.tsx` - accept + pass `openapiReader` (both empty + loaded
  branches).
- `src/routes/index.tsx` - construct `createTauriOpenapiReader()` / `createNoopOpenapiReader()` in
  `createAdapters` + pass to `WorkspaceLoader`; extend the `Adapters` type.

## Edge cases handled (from spec §7)

- Picker cancelled / reader error -> reader null -> handler no-op.
- Invalid / non-3.x doc / no operations -> `openapiToTree` `[]` or empty-guard -> no insert, no persist.
- `{name}` path templating -> `:name` (a `{user-id}` -> `:user-id`; purerequest `:name` matches leading word
  chars - documented rough edge).
- Server url trailing `/` stripped so `{{baseUrl}}` + `/path` never doubles the slash.
- Server-variable template `{x}` filled from `variables.x.default`, else left literal.
- Multiple tags -> first tag only (no duplication).
- Local `$ref` resolved (cycle/depth guard); external `$ref` (not `#/`) treated as absent.
- YAML anchors/aliases -> resolved natively by the `yaml` parser.
- Dev browser -> noop reader -> silent no-op.
- No workspace open -> in-memory insert, no `onTreeChange` write (documented).

## Tests to write (RED first, one+ per AC)

Pure (Vitest, no React):
- `src/lib/openapi/__tests__/parse-openapi.test.ts` - JSON + YAML parse, version gate (3.0/3.1 pass,
  swagger 2.0 / missing / garbage -> null) (AC-001/010); `$ref` resolution + external-ref-absent (AC-008).
  TC-001/008.
- `src/lib/openapi/__tests__/openapi-to-tree.test.ts` - operation->request + method filter + name
  fallback (AC-002), url + `{name}`->`:name` + no-server bare path (AC-003), param grids + seed + path-
  level merge (AC-004), json-example body variants + none (AC-005), servers var + envs + template
  (AC-006), tag grouping + untagged-at-root (AC-007), auth seed (AC-009), root wrap + title fallback +
  empty->[] (AC-011). TC-002..007/009/010.
- `src/lib/shortcuts/__tests__/openapi-actions-registry.test.ts` (new, mirrors
  `postman-actions-registry.test.ts`) - `import-openapi` registered with default `Mod+Shift+O` +
  name/description (AC-013), `resolveShortcuts` exposes it.

React (Vitest + RTL):
- `src/components/workspace/__tests__/openapi-import.test.tsx` (new, mirrors `postman-import.test.tsx`) -
  palette lists "Import OpenAPI document" (AC-013); running it with a fake reader returning a doc inserts
  a new top-level folder + persists via `onTreeChange` (AC-012); a reader returning null inserts nothing;
  a doc with no operations inserts nothing (AC-012). TC-011.

## Execution order

1. RED: spawn a fresh test-writer subagent (skill Phase 3) for the ACs/TCs above.
2. GREEN per AC group: `parse-openapi` -> `openapi-to-tree` -> reader -> registry (+ resolve.test fix) ->
   context `importOpenapi` -> main/layout/loader/route wiring.
3. REFACTOR: keep body/param/auth/server dispatch as clean tables; share the folder-insert idiom with
   `importBruno`/`importPostman`; tighten types (no `any`, `unknown` + narrowing).
4. VERIFY: fresh verifier subagent; `npm test`, `npm run typecheck`, `npm run lint`,
   `cd src-tauri && cargo test` (must stay green - no Rust delta).

## Acceptance verification

- AC-001..013 each map to a named test (trace table filled at verify). Gates: vitest all-green, tsc clean,
  eslint clean, cargo test green (no Rust change). Coverage threshold: none enforced (checked
  `vitest.config.*` / `package.json` - no coverage gate).

## Risks

- **3.0 vs 3.1 shape drift** (nullable vs type-array, `example` vs `examples`, `$ref` placement):
  mitigate with explicit per-shape tests + total lenient parsing (best-effort defaults, never throw).
- **`$ref` resolution scope creep**: v1 resolves only local `#/` pointers with a cycle guard; external /
  URL refs are out (treated absent). A ref chain deeper than the guard stops - documented, not a bug.
- **`{name}` -> `:name` with non-word chars** (`{user-id}`): the rewrite produces `:user-id` but purerequest's
  `:name` substitution matches only leading word chars - the url is readable/sendable, param row present;
  documented rough edge, not blocking.
- **Empty-credential auth**: root auth seeds the *mode* (bearer/basic) with blank token/password (OpenAPI
  carries no secret). Approved by user - shows intent, one less click than pure inherit.

## Decision Log

Append-only. One row per architectural/design decision made while working this ticket.

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-09 | Domain gate: **ACL** (anti-corruption layer) recognised, but neither `pz-ddd` nor `pz-archetypes` *invoked* as a structural backbone | Same shape as the Bruno / Postman importers: a lenient format translator producing ordinary `FolderNode`/`RequestNode`s - no new domain model / aggregate / boundary / recognised archetype (accounting/inventory/...). The ACL concept is already embodied by the sibling importers; no skill output needed. |
| 2026-07-09 | Versions = OpenAPI **3.0 + 3.1 only**; Swagger 2.0 deferred | User decision. 2.0 (2014) is a distinct shape (`definitions`/`basePath`/`in:body`); mixing it doubles parser work. A `swagger:"2.0"` doc -> `null` (no-op) so a follow-up can add it additively. |
| 2026-07-09 | Grouping = **by tag only** (untagged ops flat at root) | User decision. Tags are OpenAPI's own grouping mechanism (= Swagger-UI). OpenAPI has no directory tree to mirror (unlike Bruno), so path-segment nesting was rejected. |
| 2026-07-09 | Body seed = **explicit examples only** (no schema synthesis) | User decision. A schema-to-skeleton walker is significant extra code for a v1; explicit `example`/`examples`/`schema.example` covers the common case. Synthesis deferrable additively. |
| 2026-07-09 | Servers -> **environments** (+ a `baseUrl` variable) | User decision. Each server becomes a switchable `Environment` (mirrors purerequest's env model); the first also seeds a root `baseUrl` var so `{{baseUrl}}` always resolves even with one server. |
| 2026-07-09 | Surface = **single-file picker** (no file map, no `.env` merge) | An OpenAPI doc is one self-contained file (servers/envs live inside it) - unlike Postman's multi-select (env sidecar) or Bruno's dir walk. `OpenapiReader` yields `{name, text}`. |
| 2026-07-09 | Default hotkey `Mod+Shift+O` | Free (only `Mod+O` = open-workspace); `O` = OpenAPI, parallels `Mod+Shift+B` (Bruno) / `Mod+Shift+P` (Postman) / `Mod+Shift+I` (cURL). |
| 2026-07-09 | Path templating `{name}` rewritten to purerequest `:name` | purerequest's path-param model + substitution use `:name`; without the rewrite `{id}` would be an unrecognised literal and path params wouldn't populate the grid. `{{var}}` tokens are untouched (shared syntax). |
