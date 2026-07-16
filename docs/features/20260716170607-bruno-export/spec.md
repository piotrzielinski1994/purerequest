# Bruno collection export

Backlog: `.pzielinski/todos.md` F5 (decomposed; this is F5a - Bruno target only)

Status: DONE (branch `20260716170607-bruno-export`). All 12 ACs verified by a fresh-context verifier;
`npx tsc`, `npm run lint`, full `npx vitest` (240 files / 2091 tests) green.

## AC traceability

| AC | Test file :: test |
| -- | ----------------- |
| AC-001 | tree-to-bruno.test.ts :: "should emit bruno.json and a request .bru with the get block, url and headers..." |
| AC-002 | tree-to-bruno.test.ts :: same (parseBru re-check of method/url/headers) |
| AC-003 | tree-to-bruno.test.ts :: "should prefix a disabled header row with `~`..." |
| AC-004 | tree-to-bruno.test.ts :: "should emit the correct body selector and body block for each body type..." + "...no body block... if body is none..." |
| AC-005 | tree-to-bruno.test.ts :: "...auth: bearer selector and auth:bearer block..." + "...auth: none selector..." + "...no auth block if... inherit" |
| AC-006 | tree-to-bruno.test.ts :: "should emit a/folder.bru..." + "should emit collection.bru for root config..." |
| AC-007 | tree-to-bruno.test.ts :: "should emit environments/dev.bru with a vars block and a .env..." |
| AC-008 | tree-to-bruno.test.ts :: "should emit get.bru and get-2.bru..." |
| AC-009 | tree-to-bruno.test.ts :: "should reconstruct the tree shape after emitting then re-importing" (round-trip via real brunoToTree) |
| AC-010 | writer.test.ts :: cancel->false / writes-under-slug->true / noop->false |
| AC-011 | bruno-export.test.tsx :: "should show Export as Bruno on a folder row menu but not on a request row menu" + "...export the folder subtree when its menu item is clicked" |
| AC-012 | export-bruno-registry.test.ts (Mod+Shift+E) + bruno-export.test.tsx (palette folder/whole-ws) + exports.test.ts (routing) |
| §8.7 write-failure toast | exports.test.ts :: "should show an error toast if the writer save rejects" |

## Overview

Four importers exist (`lib/bruno`, `lib/postman`, `lib/openapi`, `lib/curl`) but no exporter: a
file-based client that can only ingest, never emit, can't round-trip a workspace to share it. F5 in the
backlog bundles four export formats (Bruno / Postman / OpenAPI / HAR); it is decomposed and this feature
delivers the **Bruno** target only. The remaining formats become their own backlog items.

Export is **structure-preserving**: it emits a Bruno collection directory (`.bru` request files, per-folder
`folder.bru`, `environments/*.bru`, `.env`, `bruno.json`) with `{{tokens}}`, folder nesting, vars, auth,
headers, params and scripts intact - the inverse of the existing Bruno importer (`brunoToTree` /
`parseBru`). It does NOT resolve the wire form; the emitted collection stays reusable and re-importable.

The export **unit** is a folder subtree: exporting a selected folder makes that folder the collection root;
when no folder is selected (nothing, or a request) the whole workspace is exported, wrapped in one synthetic
collection root named after the workspace. A destination parent directory is picked; the collection is
written as `<parent>/<slug(collectionName)>/`.

The round-trip contract: `brunoToTree(treeToBrunoFiles(root), root.name)` reconstructs the same tree shape
(folder nesting, request names/methods/urls, headers/params/vars/auth/scripts, environments) modulo node
ids (the importer mints fresh ids) and modulo fields Bruno has no concept of (see Edge cases §8).

## Acceptance Criteria

- AC-001: A pure `treeToBrunoFiles(root: BrunoExportRoot): BrunoFileMap` emits, for a collection root folder, a `bruno.json` (`{ version: "1", name, type: "collection" }`) at the collection root.
- AC-002: Each `RequestNode` emits one `<slug>.bru` file at its folder's path, carrying a `meta { name; type: http; seq }` block, a `<method> { url; body?; auth? }` block, and (when non-empty) `headers`, `params:query`, body, `auth:bearer`/`auth:basic`, `vars:pre-request`, `script:pre-request`, `script:post-response` blocks.
- AC-003: A disabled `KeyValue` row (`enabled === false`) in headers / query / form is emitted with a leading `~` on its key; an enabled or `enabled`-absent row is emitted plain (matches `parseDict`'s `~` convention).
- AC-004: The request `<method>` block's `body:` selector names the active body type (`json` / `text` -> `json`, `form-urlencoded`, `multipart-form`, `graphql`), and `none` emits no body block; the matching `body:<type> { ... }` block carries the payload (json/graphql as a text block, form/multipart as a dict). A graphql body also emits `body:graphql:vars { ... }` when its variables text is non-empty.
- AC-005: The `<method>` block's `auth:` selector names the active auth (`bearer` / `basic` / `none` / `inherit`); `bearer`/`basic` also emit the matching `auth:bearer { token }` / `auth:basic { username; password }` block. `inherit`/`none` emit no auth block.
- AC-006: Each non-root `FolderNode` emits a `<slug>/folder.bru` carrying a `meta { name }` block plus its own config blocks (headers / vars:pre-request / auth / scripts) when non-empty; folder nesting is mirrored as nested directories.
- AC-007: Each `Environment` on the collection-root folder's `config.environments` emits an `environments/<slug(name)>.bru` file with a `vars { ... }` block of its variable rows. A folder's `dotenv` string (root or nested) emits a `.env` file at that folder's path.
- AC-008: Sibling name collisions after slugifying are disambiguated with a numeric suffix (`-2`, `-3`, ...), reusing the same `slugify`/`uniqueSlug` discipline the workspace disk serializer uses, so no two siblings overwrite each other.
- AC-009: A round-trip `brunoToTree(treeToBrunoFiles(root), root.name)` reconstructs the tree shape: folder nesting, and every request's name / method / url / enabled headers / query params / vars / auth / scripts / body (json, form, multipart, graphql+vars), modulo node ids.
- AC-010: A `BrunoExportWriter.save(files, suggestedName)` picks a destination parent directory (Tauri directory dialog), writes every file in the map under `<parent>/<slug(suggestedName)>/`, creating intermediate dirs; returns `true` on write, `false` when the user cancels the dialog. A no-op writer (dev browser) returns `false`.
- AC-011: A folder row's context menu exposes an **Export as Bruno...** item (folder rows only; request rows are unaffected). Selecting it exports that folder as a collection.
- AC-012: An `export-bruno` shortcut action (command palette + rebindable hotkey, default `Mod+Shift+E`) exports the target folder; when the selection is a folder it exports that folder, otherwise it exports the whole workspace wrapped in a synthetic root named after the workspace. On success a toast confirms; on cancel nothing changes.

## User Test Cases

- TC-001 (happy path, single request): a collection root folder with one GET request (url + a header) -> `treeToBrunoFiles` emits `bruno.json` + `<slug>.bru`; the `.bru` has the `get` block with the url and a `headers` block. Maps to: AC-001, AC-002.
- TC-002 (disabled row): a request with a header `{key:"X-Debug",value:"1",enabled:false}` -> emitted `headers` block line is `~X-Debug: 1`. Maps to: AC-003.
- TC-003 (body types): four requests with json / form / multipart / graphql bodies -> each emits the correct `body:` selector and `body:<type>` block; graphql with variables also emits `body:graphql:vars`. Maps to: AC-004.
- TC-004 (none body / inherit auth): a request with `body.active:"none"` and `auth.active:"inherit"` -> no `body:*` block and no `auth:*` block; the `<method>` block omits `body:` and `auth:` (or emits `auth: inherit`). Maps to: AC-004, AC-005.
- TC-005 (bearer auth): a request with bearer auth `token:"{{tok}}"` -> `<method>` block `auth: bearer` + an `auth:bearer { token: {{tok}} }` block; the `{{tok}}` token survives verbatim. Maps to: AC-005.
- TC-006 (nested folders): root -> folder A -> request; folder A has its own header -> emits `a/folder.bru` (with the header) and `a/<slug>.bru`. Maps to: AC-006.
- TC-007 (environments + dotenv): root config has an environment `dev` with a var, and `dotenv:"K=V"` -> emits `environments/dev.bru` (a `vars` block) and `.env` with `K=V`. Maps to: AC-007.
- TC-008 (collision): two sibling requests both named "Get" -> emitted files are `get.bru` and `get-2.bru` (no overwrite). Maps to: AC-008.
- TC-009 (round-trip): a multi-level tree (folders, requests with each body type, headers with a disabled row, query params, vars, bearer auth, a pre + post script, one environment) -> `brunoToTree(treeToBrunoFiles(root), name)` yields a tree whose folder nesting + per-request name/method/url/enabled-headers/query/vars/auth/scripts/body equal the originals. Maps to: AC-009.
- TC-010 (writer cancel): `save` when the picker returns null (user cancels) -> resolves `false`, writes nothing. Maps to: AC-010.
- TC-011 (writer writes): `save` with a fake picker returning a dir + an in-memory fs -> every file in the map is written under `<dir>/<slug(name)>/`; resolves `true`. Maps to: AC-010.
- TC-012 (folder menu): right-click a folder row -> an **Export as Bruno...** item is present; right-click a request row -> it is absent. Maps to: AC-011.
- TC-013 (shortcut/palette, folder target): select a folder, run `export-bruno` -> the writer is called with that folder as the collection root (suggestedName = folder name). Maps to: AC-012.
- TC-014 (shortcut/palette, whole workspace): select a request (or nothing), run `export-bruno` -> the writer is called with a synthetic root wrapping all top-level nodes, named after the workspace. Maps to: AC-012.

## UI States

| State   | Behavior                                                                                     |
| ------- | -------------------------------------------------------------------------------------------- |
| Loading | N/A - the emit is synchronous; only the directory pick + file write are async (no spinner).  |
| Empty   | Exporting an empty folder still emits `bruno.json` + `folder.bru`; an empty workspace exports a bare collection root. |
| Error   | Write failure (fs error) -> an error toast; the tree is unchanged. Picker cancel -> silent no-op. |
| Success | Files written -> a toast `Exported Bruno collection`.                                        |

### ASCII wireframe - folder context menu (Export item added)

```
+---------------------------+
| New request               |
| New folder                |
+---------------------------+
| Rename                     |
| Duplicate                  |
| Edit                       |
| Export as Bruno...         |   <- new (folder rows only)
+---------------------------+
| Delete                     |
+---------------------------+
```

### Emitted collection layout (example)

```
<parent>/<collection-slug>/
  bruno.json                     # { version, name, type: collection }
  .env                           # from root folder dotenv (if any)
  environments/
    dev.bru                      # vars { ... }
  get-users.bru                  # a root-level request
  users/                         # a subfolder
    folder.bru                   # meta { name } + folder config blocks
    create-user.bru
```

## Data model

No new persisted model. Reuses `TreeNode` / `FolderNode` / `RequestNode` / `ConfigScope` / `Environment`
/ `KeyValue` / `Auth` / `RequestBody` from `lib/workspace/model.ts`, and the existing `BrunoFileMap`
(`Record<string, string>`) from `lib/bruno/bruno-to-tree.ts` as the emit target.

New in-memory types (not persisted):

- `BrunoExportRoot = { name: string; config: ConfigScope; dotenv?: string; children: TreeNode[] }` - the
  collection root handed to the emitter (a folder subtree, or a synthetic wrap of the whole workspace).
- `BrunoExportWriter = { save: (files: BrunoFileMap, suggestedName: string) => Promise<boolean> }` -
  mirror of the reader ports; a Tauri impl (picker + fs writes) and a no-op impl (dev browser).

## Edge cases

1. **Fields Bruno has no concept of** - `timeoutMs`, `environmentColors`, and request-level environments
   are dropped on export (Bruno models none of them). Round-trip loses only these; documented, acceptable.
2. **Path params** - `params.path` rows are not emitted as a `params:path` block (the Bruno importer only
   reads `params:query`); path values already live inline in the URL `:name` tokens, so they survive via
   the url. `params.path` is dropped from the file; noted, acceptable.
3. **Body/script text containing a `}`** - emitted as an indented text block; the importer's brace-counting
   `splitBlocks` handles nested braces, so a JSON/graphql body or script with `}` round-trips (covered by
   the round-trip TC).
4. **Empty folder / empty workspace** - still emits `bruno.json` (+ `folder.bru` for a non-root folder);
   a bare collection is valid.
5. **Name collisions after slugify** - disambiguated per-level with a numeric suffix (AC-008); an empty /
   all-symbol name slugifies to `untitled` (reuse the disk serializer's `slugify` fallback).
6. **Picker cancel** - `save` resolves `false`, nothing written, no toast beyond silence (TC-010).
7. **Write failure** - a rejecting `save` is caught and surfaced as a `Failed to export Bruno collection`
   toast (no unhandled rejection); no partial-state cleanup attempted (a one-shot dump, not the
   reconciling workspace writer).
8. **Disabled rows** - preserved via the `~` key prefix on export and re-read as `enabled:false` on import
   (round-trip AC-009 asserts enabled headers; a disabled row's `~` is covered by TC-002 directly).

## Dependencies

- Existing: `@tauri-apps/plugin-dialog` (`open`), `@tauri-apps/plugin-fs` (`mkdir`, `writeTextFile`) -
  already used by the readers and `tauri-fs`.
- Existing: `slugify` / `uniqueSlug` discipline in `lib/workspace/disk-format.ts` (mirror, or extract if a
  clean shared home exists - decided in the plan).
- Existing importer as the round-trip oracle: `brunoToTree` / `parseBru`.
- No new npm packages.
```