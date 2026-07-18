# Postman collection export

Backlog: `.pzielinski/todos.md` F5b (F5 decomposed; this is the Postman target)

Status: DONE (branch `20260718213132-postman-export`). All 13 ACs verified by a fresh-context verifier;
`npx tsc`, `npm run lint` (0 errors), full `npx vitest` (247 files / 2161 tests) green.

## AC traceability

| AC | Test file :: test |
| -- | ----------------- |
| AC-001 | tree-to-postman.test.ts :: "should emit a collection with info.name/schema and a top-level request item..." |
| AC-002 | tree-to-postman.test.ts :: same (method/url/header on the request item) |
| AC-003 | tree-to-postman.test.ts :: "should emit disabled:true for a disabled header row..." + "should emit disabled:true for a disabled query row" |
| AC-004 | tree-to-postman.test.ts :: "should map each body type to the matching Postman body mode..." + "...no body key... if the body is none..." |
| AC-005 | tree-to-postman.test.ts :: "...bearer auth block with the {{tok}} token..." + "...basic auth block..." + "...{type:noauth}..." + "...no auth key... inherit" |
| AC-006 | tree-to-postman.test.ts :: "should emit a folder item with a nested item array and its own variable block" |
| AC-007 | tree-to-postman.test.ts :: "should emit a postman_environment.json per environment with enabled flags per row" |
| AC-008 | tree-to-postman.test.ts :: "should emit query params as url.query and path params as url.variable" |
| AC-009 | tree-to-postman.test.ts :: "should map pre/post scripts to prerequest and test events with exec line arrays" |
| AC-010 | tree-to-postman.test.ts :: "should reconstruct the tree shape after emitting then re-importing via postmanToTree" (round-trip via real postmanToTree) |
| AC-011 | collection-writer.test.ts :: cancel->false / writes-under-slug->true / noop->false |
| AC-012 | postman-export.test.tsx :: "should show Export as Postman on a folder row menu but not on a request row menu" + "...export the folder subtree when its menu item is clicked" |
| AC-013 | export-postman-registry.test.ts (Mod+Alt+P) + postman-export.test.tsx (palette folder/whole-ws) + exports.test.ts (routing quartet incl. §8.7 error toast) |

## Overview

Four importers exist (`lib/bruno`, `lib/postman`, `lib/openapi`, `lib/curl`) and F5a shipped the first
exporter (Bruno). This feature delivers the **Postman v2.1** export target: the inverse of the existing
Postman importer (`postmanToTree` / `parsePostmanCollection` / `parsePostmanEnvironment`).

Export is **structure-preserving**: it emits a Postman collection with `{{tokens}}`, folder nesting, vars,
auth, headers, query + path params, body and scripts intact. It does NOT resolve the wire form; the emitted
collection stays reusable and re-importable, and imports into real Postman without manual fixup (the
collection document carries the canonical `info.schema` v2.1 URL).

Unlike Bruno (a directory of `.bru` files), a Postman collection is a **single JSON document**. Postman
keeps environments in separate `*.postman_environment.json` files. So the export emits a small file-map:
one `<slug>.postman_collection.json` plus one `<slug>.postman_environment.json` per environment, written
under `<parent>/<slug(collectionName)>/` (mirrors F5a's on-disk shape and reuses one shared writer).

The export **unit** matches F5a: a selected folder becomes the collection root; with no folder selected
(nothing, or a request) the whole workspace is exported wrapped in one synthetic collection root named after
the workspace.

The round-trip contract: `postmanToTree(treeToPostmanFiles(root), root.name)` reconstructs the same tree as
a single root folder (`info.name`), modulo node ids (the importer mints fresh `postman-N` ids) and modulo
fields Postman has no concept of (see Edge cases §8).

## Acceptance Criteria

- AC-001: A pure `treeToPostmanFiles(root: PostmanExportRoot): PostmanFileMap` emits a `<slug(name)>.postman_collection.json` whose `info` carries `name` (the root name) and `schema` = `https://schema.getpostman.com/json/collection/v2.1.0/collection.json`.
- AC-002: Each `RequestNode` emits a Postman item `{ name, request: { method, url, header?, body?, auth? }, event? }` inside its folder's `item` array (root-level requests sit in the collection's top-level `item`).
- AC-003: A disabled `KeyValue` row (`enabled === false`) in headers / query / form / multipart is emitted with `disabled: true`; an enabled or `enabled`-absent row omits `disabled` (matches the importer's `disabled !== true` -> `enabled:true` convention).
- AC-004: The request `body` maps by active type: `json` -> `{ mode: "raw", raw, options: { raw: { language: "json" } } }`, `form` -> `{ mode: "urlencoded", urlencoded }`, `multipart` -> `{ mode: "formdata", formdata }`, `graphql` -> `{ mode: "graphql", graphql: { query, variables } }`; `none` emits no `body` key.
- AC-005: The request/scope `auth` maps by active mode: `bearer` -> `{ type: "bearer", bearer: [{ key: "token", value }] }`, `basic` -> `{ type: "basic", basic: [{ key: "username", value }, { key: "password", value }] }`, `none` -> `{ type: "noauth" }`; `inherit` emits no `auth` key (Postman inherits from the parent scope by default).
- AC-006: Each `FolderNode` emits a folder item `{ name, item: [...children] }` plus, when non-empty, its own `variable` (from `config.variables`), `auth`, and `event` (scripts); folder nesting is mirrored as nested `item` arrays.
- AC-007: Each `Environment` on the collection-root folder's `config.environments` emits a separate `<slug(envName)>.postman_environment.json` file `{ name, values: [{ key, value, enabled }] }`; an `enabled === false` row keeps `enabled: false`, else `enabled: true`.
- AC-008: A request's `url` is emitted as an object `{ raw: node.url, query?: [...node.params.query], variable?: [...node.params.path] }`, so both the Query grid and path-param values round-trip (path params are a fidelity gain over the Bruno exporter, which drops them).
- AC-009: Scripts map to Postman events: `config.scripts.pre` -> `{ listen: "prerequest", script: { type: "text/javascript", exec } }` and `config.scripts.post` -> `{ listen: "test", script: { type: "text/javascript", exec } }`, where `exec` is the script text split into a line array.
- AC-010: A round-trip `postmanToTree(treeToPostmanFiles(root), root.name)` reconstructs the tree as a single root folder: its `name`, `config` (variables / auth / scripts / environments) and nested folders, and every request's name / method / url / enabled headers / query params / path params / auth / scripts / body (json, form, multipart, graphql+vars), modulo node ids.
- AC-011: A `PostmanExportWriter.save(files, suggestedName)` (the shared collection writer) picks a destination parent directory, writes every file in the map under `<parent>/<slug(suggestedName)>/` creating intermediate dirs, returns `true` on write and `false` on cancel; the no-op writer (dev browser) returns `false`.
- AC-012: A folder row's context menu exposes an **Export as Postman...** item (folder rows only; request rows are unaffected). Selecting it exports that folder as a collection.
- AC-013: An `export-postman` shortcut action (command palette + rebindable hotkey, default `Mod+Alt+P`) exports the target folder; a folder selection exports that folder, otherwise the whole workspace wrapped in a synthetic root named after the workspace. On success a toast confirms; on cancel nothing changes; on write failure an error toast fires.

## User Test Cases

- TC-001 (happy path, single request): a collection root with one GET request (url + a header) -> `treeToPostmanFiles` emits `<slug>.postman_collection.json` whose `info.name`/`info.schema` are set and whose top-level `item` holds the request with its method, url and header. Maps to: AC-001, AC-002.
- TC-002 (disabled row): a request with a header `{key:"X-Debug",value:"1",enabled:false}` -> the emitted header row is `{key:"X-Debug",value:"1",disabled:true}`; an enabled row omits `disabled`. Maps to: AC-003.
- TC-003 (body types): four requests with json / form / multipart / graphql bodies -> each emits the matching `body.mode` + payload; graphql emits `graphql:{query,variables}`; json emits the JSON language hint. Maps to: AC-004.
- TC-004 (none body / inherit auth): a request with `body.active:"none"` and `auth.active:"inherit"` -> the emitted `request` has no `body` and no `auth` key. Maps to: AC-004, AC-005.
- TC-005 (bearer auth + token verbatim): a request with bearer auth `token:"{{tok}}"` -> `request.auth = {type:"bearer", bearer:[{key:"token", value:"{{tok}}"}]}`; the `{{tok}}` token survives verbatim. Maps to: AC-005.
- TC-006 (basic auth): a request with basic auth -> `request.auth = {type:"basic", basic:[{key:"username",value},{key:"password",value}]}`. Maps to: AC-005.
- TC-007 (none auth): a request with explicit `auth.active:"none"` -> `request.auth = {type:"noauth"}`. Maps to: AC-005.
- TC-008 (nested folders + folder config): root -> folder A (own header + variable) -> request -> folder A is a Postman folder item with a nested `item` array, a `variable` block and the header; the request sits inside it. Maps to: AC-006.
- TC-009 (environments): root config has an environment `dev` with a var -> a `dev.postman_environment.json` file with `{name:"dev", values:[{key,value,enabled:true}]}`; a disabled env row keeps `enabled:false`. Maps to: AC-007.
- TC-010 (url query + path params): a request with `params.query:[{key:"page",value:"2"}]` and `params.path:[{key:"id",value:"7"}]` -> `request.url = {raw, query:[{key:"page",value:"2"}], variable:[{key:"id",value:"7"}]}`. Maps to: AC-008.
- TC-011 (scripts): a request with `scripts:{pre:"pre();",post:"post();"}` -> two events, `prerequest` with `exec:["pre();"]` and `test` with `exec:["post();"]`. Maps to: AC-009.
- TC-012 (round-trip): a multi-level tree (folders; requests with each body type; headers with a disabled row; query + path params; vars; bearer auth; pre + post scripts; one environment) -> `postmanToTree(treeToPostmanFiles(root), name)` yields a single root folder whose nesting + per-request name/method/url/enabled-headers/query/path/vars/auth/scripts/body equal the originals. Maps to: AC-010.
- TC-013 (writer cancel): shared writer `save` when the picker returns null -> resolves `false`, writes nothing. Maps to: AC-011.
- TC-014 (writer writes): `save` with a fake picker + in-memory fs -> every file in the map is written under `<dir>/<slug(name)>/`; resolves `true`. Maps to: AC-011.
- TC-015 (folder menu): right-click a folder row -> an **Export as Postman...** item is present; a request row -> it is absent. Maps to: AC-012.
- TC-016 (shortcut/palette, folder target): select a folder, run `export-postman` -> the writer is called with that folder as the collection root (suggestedName = folder name), and a success toast fires. Maps to: AC-013.
- TC-017 (shortcut/palette, whole workspace): select a request (or nothing), run `export-postman` -> the writer is called with a synthetic root wrapping all top-level nodes, named after the workspace. Maps to: AC-013.
- TC-018 (write failure): a rejecting `save` -> an error toast `Failed to export Postman collection`; the tree is unchanged. Maps to: AC-013.

## UI States

| State   | Behavior                                                                                     |
| ------- | -------------------------------------------------------------------------------------------- |
| Loading | N/A - the emit is synchronous; only the directory pick + file write are async (no spinner).  |
| Empty   | Exporting an empty folder still emits a valid collection JSON with an empty `item`; an empty workspace exports a bare collection root. |
| Error   | Write failure (fs error) -> an error toast; the tree is unchanged. Picker cancel -> silent no-op. |
| Success | Files written -> a toast `Exported Postman collection`.                                       |

### ASCII wireframe - folder context menu (Export item added)

```
+----------------------------+
| New request                |
| New folder                 |
+----------------------------+
| Rename                     |
| Duplicate                  |
| Edit                       |
| Export as Bruno...         |
| Export as Postman...       |   <- new (folder rows only)
+----------------------------+
| Delete                     |
+----------------------------+
```

### Emitted collection layout (example)

```
<parent>/<collection-slug>/
  my-api.postman_collection.json     # { info:{name,schema}, item:[...], variable?, auth?, event? }
  dev.postman_environment.json       # { name:"dev", values:[{key,value,enabled}] }
```

## Data model

No new persisted model. Reuses `TreeNode` / `FolderNode` / `RequestNode` / `ConfigScope` / `Environment`
/ `KeyValue` / `Auth` / `RequestBody` from `lib/workspace/model.ts`, and the existing `PostmanFileMap`
(`Record<string, string>`) from `lib/postman/postman-to-tree.ts` as the emit target.

New in-memory types (not persisted):

- `PostmanExportRoot = { name: string; config: ConfigScope; children: TreeNode[] }` - the collection root
  handed to the emitter (a folder subtree, or a synthetic wrap of the whole workspace). No `dotenv`: Postman
  has no `.env` concept and does not import one, so a folder's `dotenv` is dropped (edge case §8.4).
- A shared `CollectionWriter = { save: (files: Record<string,string>, suggestedName: string) => Promise<boolean> }`
  extracted from F5a's `BrunoExportWriter` (byte-identical logic - write a string file-map under a slug
  dir). Bruno + Postman both delegate to it; `PostmanExportWriter` is an alias.

## Edge cases

1. **Fields Postman has no concept of** - `timeoutMs`, `environmentColors`, request-level environments and
   `httpVersion` are dropped on export. Round-trip loses only these; documented, acceptable.
2. **Path params** - a fidelity gain over Bruno: emitted as `url.variable[]`, which the importer reads back
   into `params.path`, so they round-trip.
3. **Query already in the url string** - the importer drops a `url.query` row whose key already appears in
   `url.raw`'s `?a=b`. The exporter emits `raw = node.url` verbatim + the grid as `url.query`; when `raw`
   carries no query the grid round-trips cleanly (matches importer dedup).
4. **`dotenv`** - not emitted (Postman does not import `.env`). A folder's `dotenv` is silently dropped.
5. **Name collisions after slugify** - the collection file and each environment file are slugged; an empty /
   all-symbol name slugifies to `untitled` (reuse `slugify`). Environment file names are disambiguated with
   `uniqueSlug` so two same-named envs don't overwrite.
6. **Picker cancel** - `save` resolves `false`, nothing written, no toast (TC-013).
7. **Write failure** - a rejecting `save` is caught and surfaced as a `Failed to export Postman collection`
   toast; no partial-state cleanup (a one-shot dump, not the reconciling workspace writer).
8. **`QUERY` method + other methods** - the method string is emitted verbatim into `request.method`; the
   importer's `METHOD_FROM` maps it back (unknown methods fall to `GET`, but our six all round-trip).

## Dependencies

- Existing: `@tauri-apps/plugin-dialog` (`open`), `@tauri-apps/plugin-fs` (`mkdir`, `writeTextFile`) - the
  logic is lifted from F5a's `bruno/writer.ts` into a shared `lib/export/collection-writer.ts`.
- Existing: `slugify` / `uniqueSlug` from `lib/workspace/slug.ts`.
- Existing importer as the round-trip oracle: `postmanToTree` / `parsePostmanCollection` /
  `parsePostmanEnvironment`.
- No new npm packages.
