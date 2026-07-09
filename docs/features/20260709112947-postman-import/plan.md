# Plan: Import Postman collection

From the approved [spec.md](spec.md). TDD order. Mirrors the Bruno-import feature (pure core + context/UI
wiring) but the collection is a **single nested JSON file** (`item` arrays form the tree), so the tree
walk lives inside the parser rather than the file-map fold. Adds a `pm.*` script alias beside the
existing `bru.*` alias. **No Rust change**, **no new npm dep** (plain `JSON.parse`).

## Approach

Two pure, React-free modules carry the logic:

- **Parse** = `parsePostmanCollection(text, fallbackName): FolderNode | null` and
  `parsePostmanEnvironment(text): Environment | null` in `parse-postman.ts` - total functions (no throw;
  invalid/non-collection -> `null`). Internal `walkItems` recurses the `item` array (folder = has `item`,
  request = has `request`) building `FolderNode`/`RequestNode`s; a mode-dispatch for body/auth (strategy
  table, not an if-ladder). Synthetic `postman-<n>` ids from a shared id-gen.
- **Map** = `postmanToTree(files: PostmanFileMap, fallbackName): TreeNode[]` in `postman-to-tree.ts` -
  picks the first path-sorted `*.postman_collection.json` (fallback: any `.json` whose parse yields a
  collection), parses it, folds every `*.postman_environment.json` (or `{name,values}`-shaped `.json`)
  into the root folder's `config.environments`, returns `[root]` (or `[]` when no collection). Re-exports
  `collectDotenv` behavior by reusing the Bruno one (moved/shared - see below).

The reader port (`PostmanCollectionReader`) is the third seam - native pick + recursive read of `*.json`
+ `.env`, returning a `{ name, files }` map. Threaded loader -> layout -> main as a prop, exactly like the
Bruno `reader`.

`pm.*` alias: extend the QuickJS `PRELUDE` with a `globalThis.pm` object mapping to the same `__call`
bridge the `bru`/`requi` objects use (no new host dispatch entries needed - reuses `requi.*`/`res.*`/
`console.*`). `pm.test` is defined in the prelude JS (runs `fn` in a `try/catch`).

## File changes

**Pure core (no UI, no React):**
- `src/lib/postman/parse-postman.ts` (new) - `parsePostmanCollection(text, fallbackName): FolderNode | null`,
  `parsePostmanEnvironment(text): Environment | null`, exported `PostmanFileMap` type re-exported from
  postman-to-tree. Internal: item walk, body-mode dispatch, auth-type dispatch, `url.raw`/object
  reconstruction, `urlQueryKeys` dup-drop (mirrors OpenCollection).
- `src/lib/postman/postman-to-tree.ts` (new) - `postmanToTree(files, fallbackName): TreeNode[]` +
  `PostmanFileMap` type; picks the collection file, folds environment files + `.env`, wraps in one root.
- **Shared dotenv collect:** reuse `collectDotenv` from `@/lib/bruno/bruno-to-tree` (it's already a
  generic "concat every `.env` in a file map" over `Record<string,string>`); import it in the context
  handler. No move needed - it's format-agnostic. (If a lint/circular concern appears, inline a 3-line
  copy in postman-to-tree; decide during GREEN.)

**Script alias:**
- `src/lib/scripts/quickjs-runner.ts` - extend `PRELUDE` with `globalThis.pm` (variables/environment/
  collectionVariables/globals get+set -> `requi.*`; a post-stage `pm.response` -> `res.*` guarded by
  `__hasRes`; `pm.test(name, fn)` try/catch). No `buildDispatch` change (reuses existing paths).

**Reader port:**
- `src/lib/postman/reader.ts` (new) - `PostmanCollectionReader` type, `createTauriPostmanReader()`
  (pick dir, recursive `readDir`/`readTextFile` of `*.json` + `.env`), `createNoopPostmanReader()`.
  Mirrors `src/lib/bruno/reader.ts`.

**Shortcut registry:**
- `src/lib/shortcuts/registry.ts` - add `import-postman` (default `Mod+Shift+P`) to the union +
  `SHORTCUT_ACTIONS` (after `import-bruno`).
- `src/lib/shortcuts/__tests__/resolve.test.ts` - add `"import-postman"` to the hard-coded `ACTION_IDS`
  (asserted exhaustively against the registry; adding the action without it goes RED).

**Context (action + insert):**
- `src/components/workspace/workspace-context.tsx` - add `importPostman(files, name)` to the context value
  + type: `postmanToTree` -> guard empty (no requests and no child folders -> no-op) -> insert the root
  folder at workspace root (reuse the exact `importBruno` insert/expand/select/persist idiom) -> merge any
  collection `.env` via `collectDotenv` + `mergeDotenv` -> toast "Imported Postman collection".

**UI wiring:**
- `src/components/workspace/main.tsx` - accept a `postmanReader` prop, add
  `"import-postman": importPostmanCollection` (via `postmanReader.pick()`) to `handlers`.
- `src/components/workspace/workspace-layout.tsx` - thread `postmanReader` prop through to `Main`.
- `src/components/workspace/workspace-loader.tsx` - accept + pass `postmanReader` to `WorkspaceLayout`
  (both empty + loaded branches).
- `src/routes/index.tsx` - construct `createTauriPostmanReader()` / `createNoopPostmanReader()` in
  `createAdapters` and pass to `WorkspaceLoader`.

## Edge cases handled (from spec §8)

- Picker cancelled / reader error -> reader null -> handler no-op.
- No collection file / empty collection -> `postmanToTree` `[]` or empty-guard -> no insert, no persist.
- `url` object without `raw` -> best-effort reconstruction, else `""`.
- `disabled` rows (header/query/urlencoded/formdata) -> `enabled:false`.
- Query dup in `url.raw` + `url.query` -> url wins, row dropped (`urlQueryKeys`).
- `formdata` `type:"file"` -> literal text value (no file src).
- Unsupported auth (`apikey`/`oauth2`) -> no auth set (inherit).
- Several collection files -> first path-sorted wins.
- Dev browser -> noop reader -> silent no-op.
- No workspace open -> in-memory insert, no `onTreeChange` write (documented).

## Tests to write (RED first, one+ per AC)

Pure (Vitest, no React):
- `src/lib/postman/__tests__/parse-postman.test.ts` - method/url (AC-001), headers + disabled (AC-002),
  body raw/urlencoded/formdata/graphql/none (AC-003), bearer/basic/noauth/apikey auth (AC-004), query +
  path params + dup-drop (AC-005), prerequest/test events (AC-006), lenient null + skip (AC-007), nested
  tree + collection config (AC-008), environment parse (AC-009 partial). TC-001..007.
- `src/lib/postman/__tests__/postman-to-tree.test.ts` - collection pick + nested tree (AC-008), env fold
  + collectDotenv (AC-009), no-collection -> `[]`, empty collection. TC-007/008.
- `src/lib/scripts/__tests__/quickjs-runner.test.ts` - append: `pm.variables.get/set` -> host getVar/
  setVar (AC-012), post-stage `pm.response` mapping, `pm.test` swallows a throw. TC-010.
- `src/lib/shortcuts/__tests__/postman-actions-registry.test.ts` (new) - `import-postman` registered with
  its default `Mod+Shift+P` + name/description (AC-011), `resolveShortcuts` exposes it.

React (Vitest + RTL):
- `src/components/workspace/__tests__/postman-import.test.tsx` (new, mirrors `bruno-import.test.tsx`) -
  palette lists "Import Postman collection" (AC-011); running it with a fake reader returning a collection
  inserts a new top-level folder + persists via `onTreeChange` (AC-010); a reader returning null inserts
  nothing; an empty collection inserts nothing (AC-010). TC-009.

## Execution order

1. RED: spawn a fresh test-writer subagent (skill Phase 3) for the ACs/TCs above.
2. GREEN per AC group: `parse-postman` -> `postman-to-tree` -> `pm.*` alias -> reader -> registry
   (+ resolve.test fix) -> context `importPostman` -> main/layout/loader/route wiring.
3. REFACTOR: keep body/auth dispatch clean tables; share the folder-insert idiom with `importBruno`;
   tighten types (no `any`).
4. VERIFY: fresh verifier subagent; `npm test`, `npm run typecheck`, `npm run lint`,
   `cd src-tauri && cargo test` (must stay green - no Rust delta).

## Acceptance verification

- AC-001..012 each map to a named test (trace table below). Gates: vitest all-green, tsc clean, eslint
  clean, cargo test green (no Rust change). Coverage threshold: none enforced.

### AC traceability (verified PASS, fresh-context verifier, 1611 frontend tests)

| AC | Test |
| ---- | ---- |
| AC-001 | parse-postman "should extract the upper-cased method and url from url.raw" / "...bare string url verbatim" / "...fall back to GET if the method is non-standard" / "...reconstruct the url from protocol/host/path if raw is absent" |
| AC-002 | parse-postman "should map header rows with disabled:true becoming enabled:false" |
| AC-003 | parse-postman body suite: raw verbatim, urlencoded->form, formdata->multipart (file row literal), graphql, absent->none, file-mode->none |
| AC-004 | parse-postman auth suite: bearer / basic / noauth / unsupported (apikey) -> undefined |
| AC-005 | parse-postman "should map url.query rows dropping a key already in the url raw query" / "...url.variable rows to path params" |
| AC-006 | parse-postman "should map a prerequest exec array to scripts.pre and a test exec string to scripts.post" |
| AC-007 | parse-postman "should return null for garbage JSON" / "...without info and item" / "...unknown top-level field without throwing" |
| AC-008 | parse-postman "should build a nested folder and put collection variable/auth/event on the root config" + postman-to-tree "should wrap the collection in a single root folder..." / "...nested folder..." / "...collection variable and auth on the root config" / "...fall back to the provided name" / "...first path-sorted collection..." |
| AC-009 | parse-postman "should map a {name, values} doc to an Environment keeping enabled:false rows" + postman-to-tree "should fold a postman_environment.json..." / "...not create a node for an environment file" / "...collectDotenv capture the collection .env" |
| AC-010 | postman-import "should insert a new top-level folder and persist..." / "...insert nothing and not persist if the reader returns null" / "...if the collection is empty" |
| AC-011 | postman-actions-registry (default Mod+Shift+P + name/desc + resolveShortcuts) + postman-import "should list Import Postman collection in the command palette" |
| AC-012 | quickjs-runner "should alias pm.variables get and set..." / "...pm.environment, pm.collectionVariables and pm.globals set..." / "...post-stage pm.test reading pm.response.json..." / "...not fail the script if a pm.test fn throws" |

Status: **Implemented + verified** (fresh-context verifier PASS, 12/12 ACs, 4/4 gates). typecheck clean,
lint 0 errors (8 pre-existing warnings), 1611 frontend tests, cargo 10/10 (no Rust change). One addition
beyond the RED plan: a url-object-reconstruction test (spec §8 edge the verifier flagged as implemented
but untested).

## Risks

- **v2.1 shape variance** (url as string vs object, exec as string vs array, auth arrays): mitigate with
  explicit tests per shape + total lenient parsing (no throw, best-effort defaults).
- **`collectDotenv` reuse across `lib/bruno` <-> `lib/postman`:** a cross-lib import is fine (it's a pure
  util); if it reads oddly, inline a small copy - decided at GREEN, not a blocker.
- **`pm.test` semantics:** we run `fn` and swallow throws (no pass/fail reporting); a Postman collection
  relying on assertion results won't see them. Documented limitation, not a correctness bug for import.

## Decision Log

Append-only. One row per architectural/design decision made while working this ticket.

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-09 | Domain gate: neither `pz-ddd` nor `pz-archetypes` invoked | Pure format-parser + UI plumbing; produces ordinary `FolderNode`/`RequestNode`s, no new domain model / aggregate / boundary / recognized archetype shape. Mirrors the Bruno-import verdict. |
| 2026-07-09 | ~~Folder picker~~ -> **multi-select file picker** as the import surface (revised post-review) | A Postman collection is a single JSON file; a folder picker can't select a file and forced a clean single-collection dir (user hit this). Switched to `open({multiple:true, filters:[json]})` - natural for single-file, still lets a `*.postman_environment.json`/`.env` come along in the same pick to fold into config. Parser + `postmanToTree` unchanged; only `reader.ts` changed. |
| 2026-07-09 | Tree walk lives in the parser, not the file-map fold | A Postman collection is a single nested-JSON file (unlike Bruno's dir-of-files), so `item` recursion belongs in `parsePostmanCollection`; `postman-to-tree` only picks files + folds envs. |
| 2026-07-09 | `pm.*` aliased in the QuickJS prelude onto the existing host API | Same approach as `bru.*`; lets imported Postman scripts run instead of `ReferenceError`-ing without new host dispatch entries. `pm.test` swallows throws; `pm.expect`/`pm.sendRequest`/`pm.request` out of scope. |
| 2026-07-09 | Default hotkey `Mod+Shift+P` | Unused; `P` = Postman, parallels `Mod+Shift+B` (Bruno), `Mod+Shift+I` (import cURL). |
| 2026-07-09 | First path-sorted collection wins when a dir has several | Keeps import a single deterministic subtree; multi-collection import is out of scope. Logged as a documented limitation. |
