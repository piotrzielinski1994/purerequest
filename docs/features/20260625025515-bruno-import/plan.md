# Plan: Import Bruno collection

From the approved [spec.md](spec.md). TDD order. Mirrors the cURL-import feature (pure core +
context/UI wiring) but the surface is a **folder picker** (a collection is a directory), not a paste
dialog, and the result is a **subtree** (one new top-level folder), not a single node. **No Rust
change** - reading `.bru` files is plugin-fs from the frontend, capabilities already permit it.

## Approach

Two pure, React-free modules carry the logic so the hard parts (the brace-block tokenizer, the
file-map -> tree fold) are unit-tested directly:

- **Parse** = `parseBru(text: string): ParsedBru` - a total function (no throw, ADT-free since the
  output is always a best-effort record). A small hand-written block scanner splits `name { ... }` /
  `name:sub { ... }` blocks respecting brace nesting; a block-name dispatch table (strategy table,
  not an if-ladder) folds each known block into the record; unknown blocks are dropped.
- **Map** = `brunoToTree(files: BrunoFileMap, fallbackName: string): TreeNode[]` - mirrors
  `disk-format.ts` `deserialize`: walk the file map by directory depth, build `FolderNode`s from dirs
  (config from `folder.bru`), `RequestNode`s from request `.bru`s (via `parseBru`), fold
  `environments/*.bru` + `bruno.json`/`collection.bru` into the root folder. Returns the single root
  folder wrapped in an array.

The reader port (`BrunoCollectionReader`) is the third seam - it does the native pick + recursive read
(`@tauri-apps/plugin-dialog` + `@tauri-apps/plugin-fs`, the same imports `tauri-fs.ts`/`folder-picker.ts`
already use), returning a `{ name, files }` map the pure mapper consumes. Threaded loader -> layout ->
main as a prop, exactly like `FolderPicker`.

## File changes

**Pure core (no UI, no React):**
- `src/lib/bruno/parse-bru.ts` - `parseBru(text): ParsedBru` + exported `ParsedBru` type;
  internal `splitBlocks(text)` brace tokenizer, `parseDict(inner)` (key/value, `~` disabled),
  `dedent(inner)` for text blocks, a block dispatch table.
- `src/lib/bruno/parse-opencollection.ts` (new) - `parseOpenCollection(text): ParsedBru` (same shape
  as `parseBru`); parses YAML via the `yaml` dep, maps `info`/`http`/`request`/`runtime` to `ParsedBru`.
  Total (never throws - a YAML parse failure yields the empty best-effort record).
- `src/lib/bruno/bruno-to-tree.ts` - `brunoToTree(files, fallbackName): TreeNode[]` +
  `BrunoFileMap` type; **dispatches per file extension** (`.bru` -> `parseBru`, `.yml`/`.yaml` ->
  `parseOpenCollection`) and recognizes `folder.yml`/`opencollection.yml` as folder/collection config
  files alongside `folder.bru`/`collection.bru`/`bruno.json`. Synthetic `bruno-<n>` ids.

**New dep:** `yaml` (^2.9) - the OpenCollection format is YAML; no parser was present. Mirrors the
project's "use the right small lib, don't hand-roll" stance (cmdk, dnd-kit, quickjs).

**Reader port:**
- `src/lib/bruno/reader.ts` (new) - `BrunoCollectionReader` type, `createTauriBrunoReader()`
  (pick dir, recursive `readDir`/`readTextFile` of `*.bru`/`bruno.json`, read `bruno.json` name),
  `createNoopBrunoReader()`.

**Shortcut registry:**
- `src/lib/shortcuts/registry.ts` - add `import-bruno` (default `Mod+Shift+B`) to the union +
  `SHORTCUT_ACTIONS`.
- `src/lib/shortcuts/__tests__/resolve.test.ts` - add `"import-bruno"` to the hard-coded `ACTION_IDS`
  (this list is asserted exhaustively against the registry; adding the action without it goes RED).

**Context (action + insert):**
- `src/components/workspace/workspace-context.tsx` - add `importBruno(files, name)` to the context
  value + type: `brunoToTree` -> guard empty (no requests and no child folders -> no-op) -> insert the
  root folder at workspace root (reuse `createRequestNode`'s insert/expand/select/persist idiom, but
  for a folder: `insertNode(tree, null, tree.length, folder)`, expand + select it, `persistTree`),
  toast "Imported Bruno collection". Mirror `newFolder`'s folder-insert path.

**UI wiring:**
- `src/components/workspace/main.tsx` - accept the `reader` prop (alongside `picker`), add
  `"import-bruno": importBruno via reader.pick()` to `handlers` (no-op when no reader / null pick).
- `src/components/workspace/workspace-layout.tsx` - thread `reader` prop through to `Main`.
- `src/components/workspace/workspace-loader.tsx` - accept + pass `reader` to `WorkspaceLayout`
  (both empty + loaded branches).
- `src/routes/index.tsx` - construct `createTauriBrunoReader()` / `createNoopBrunoReader()` in
  `createAdapters` and pass to `WorkspaceLoader`.

## Edge cases handled (from spec §8)

- Picker cancelled / reader error -> reader returns null -> handler no-op (no insert, no toast).
- Empty collection (no requests, no child folders) -> `importBruno` guard returns without persisting.
- `~key` disabled rows -> `enabled:false` (parseDict).
- Multiple body blocks -> method block's `body:` selector picks; else first present.
- `@file` multipart value -> kept as literal text (no file part); `body:graphql` dropped.
- Dev browser -> noop reader -> silent no-op.
- No workspace open -> in-memory insert, no `onTreeChange` write (documented, same as cURL/new-request).

## Tests to write (RED first, one+ per AC)

Pure (Vitest, no React):
- `src/lib/bruno/__tests__/parse-bru.test.ts` - method/url (AC-001), headers + `~`disabled (AC-002),
  body json/text/form/multipart/none (AC-003), bearer/basic/none/inherit auth (AC-004), params/vars/
  scripts (AC-005), lenient skip + garbage no-throw (AC-006). TC-001..005.
- `src/lib/bruno/__tests__/bruno-to-tree.test.ts` - nested dir -> folder tree (AC-007), bruno.json
  name + environments fold (AC-008), empty -> empty root. TC-006/007.
- `src/lib/shortcuts/__tests__/bruno-actions-registry.test.ts` - `import-bruno` registered with its
  default + name/description (AC-010), `resolveShortcuts` exposes it.

React (Vitest + RTL):
- `src/components/workspace/__tests__/bruno-import.test.tsx` - palette lists "Import Bruno collection"
  (AC-010); running it with a fake reader returning a collection inserts a new top-level folder
  (visible in the tree) + persists via `onTreeChange` (AC-009); a reader returning null inserts nothing
  (AC-009/010). TC-008.

## Execution order

1. RED: spawn a fresh test-writer subagent (skill Phase 3) for the ACs/TCs above.
2. GREEN per AC group: `parse-bru` -> `bruno-to-tree` -> reader -> registry (+ resolve.test fix) ->
   context `importBruno` -> main/layout/loader/route wiring.
3. REFACTOR: keep the block dispatch a clean table; share the folder-insert idiom with `newFolder`
   where it doesn't muddy either; tighten types (no `any`).
4. VERIFY: fresh verifier subagent; `npm test`, `npm run typecheck`, `npm run lint`,
   `cd src-tauri && cargo test` (must stay green - no Rust delta).

## Acceptance verification

- AC-001..010 each map to a named test (trace table filled in after verify). Gates: vitest all-green,
  tsc clean, eslint clean, cargo test green (no Rust change). Coverage threshold: none enforced.

## Risks

- **Bru-lang brace nesting in bodies:** a JSON body block contains `{`/`}`; the block scanner must
  brace-count, not stop at the first `}`. Mitigation: an explicit nested-brace body test (TC-002).
- **Dir-walk ordering in `brunoToTree`:** mirror `deserialize`'s prefix-based level build rather than
  inventing a new walk, so deep nesting and `folder.bru`-less dirs behave like the existing loader.
  Mitigation: a nested-dir test (TC-006).
- **Reader is the one untested seam** (native fs, like `tauri-fs`/`folder-picker` which are also
  unit-untested). Mitigation: keep it a thin port; all logic lives in the pure mapper the fake reader
  feeds in tests. Same accepted gap as the other native ports.

## AC traceability (verified PASS, 986 frontend tests)

| AC | Test |
| ---- | ---- |
| AC-001 | parse-bru "should extract the upper-cased method and url from the method block" / "should read GET from a get method block" |
| AC-002 | parse-bru "should map a ~-prefixed header key to enabled:false and a plain key to enabled:true" |
| AC-003 | parse-bru body suite: json verbatim + nested-brace, bare body, form, multipart, no-body, selector-picks |
| AC-004 | parse-bru auth suite: bearer / basic / method-block none / inherit |
| AC-005 | parse-bru "should map a params:query block..." / "...vars:pre-request..." / "...bare vars..." / "...script:pre-request to scripts.pre and script:post-response to scripts.post" |
| AC-006 | parse-bru "should skip tests, docs, assert and body:graphql blocks..." / garbage + empty no-throw |
| AC-007 | bruno-to-tree "should wrap the collection in a single root folder" / "...nested folder containing the request..." / "...name a folder from its folder.bru meta.name" / "...top-level request .bru into a request node..." |
| AC-008 | bruno-to-tree "should name the root folder from bruno.json name" / fallback / "...fold environments/<env>.bru vars..." / "...not create a request node for an environments file" |
| AC-009 | bruno-import "should insert a new top-level folder and persist..." / "...insert nothing and not persist if the reader returns null" / "...if the collection is empty" |
| AC-010 | bruno-actions-registry (default + name/desc + resolveShortcuts) + bruno-import "should list Import Bruno collection in the command palette" |
| AC-011 | parse-opencollection suite: info/http, headers+disabled, query/path params, json/text/form body, inherit/none/bearer/basic auth, request.variables, before/after scripts, invalid+empty YAML |
| AC-012 | bruno-to-tree "should build a request node from a .yml file...", "...nested folder from folder.yml with request.variables...", "...fold a YAML environments/<env>.yml...", "...nested opencollection.yml as a folder config carrier" + bruno-import "should import an OpenCollection YAML collection..." |

Status: **Implemented + verified** (fresh-context verifier PASS). typecheck clean, lint 0 errors
(7 pre-existing warnings), 986 frontend tests, cargo 7/7 (no Rust change). One deviation from plan:
added a direct empty-collection integration test (`importBruno` no-op) the verifier flagged as a gap.
</content>
