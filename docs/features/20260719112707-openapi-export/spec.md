# OpenAPI document export

Backlog: `.pzielinski/todos.md` F5c (F5 decomposed; this is the OpenAPI target, third of four export slices)

Status: DONE (branch `20260719112707-openapi-export`). All 12 ACs verified by a fresh-context verifier;
`npx tsc`, `npm run lint` (0 errors), full `npx vitest` (250 files / 2188 tests) green.

## AC traceability

| AC | Test file :: test |
| -- | ----------------- |
| AC-001 | tree-to-openapi.test.ts :: "should emit a 3.0.3 document with info.title, a server, and a get operation if the root has one request" |
| AC-002 | tree-to-openapi.test.ts :: same (method lowercased + summary) + "should merge a GET and a POST on the same path into one path item" |
| AC-003 | tree-to-openapi.test.ts :: "...convert :id to a {id} path..." + "...strip the {{baseUrl}} prefix from paths" |
| AC-004 | tree-to-openapi.test.ts :: "...required in:path parameter with the value example" + "...in:query...in:header..." + "...omit the example key...empty" |
| AC-005 | tree-to-openapi.test.ts :: "...application/json example equal to the parsed json body" + "...form/multipart/graphql...media types..." + "...no requestBody key for a none body" |
| AC-006 | tree-to-openapi.test.ts :: "...tag a foldered request...leave a loose request untagged" + "...immediate parent folder B and drop the outer folder A" |
| AC-007 | tree-to-openapi.test.ts :: "...one server from the baseUrl variable..." + "...exactly one server per environment and no duplicate..." |
| AC-008 | tree-to-openapi.test.ts :: "...http+bearer scheme...leak no token" + "...http+basic...leak no credentials" + "...no securitySchemes and no security for an inherit auth" |
| AC-009 | tree-to-openapi.test.ts :: "should reconstruct the importer-expressible subset after emitting then re-importing" (round-trip via real openapiToTree) |
| AC-010 | collection-writer.test.ts (cancel/write/noop) + exports.test.ts (OpenAPI routing quartet) |
| AC-011 | openapi-export.test.tsx :: "should show Export as OpenAPI on a folder row menu but not on a request row menu" + "...export the folder subtree when its menu item is clicked" |
| AC-012 | export-openapi-registry.test.ts (Mod+Alt+O) + openapi-export.test.tsx (palette folder/whole-ws) + exports.test.ts (routing quartet incl. error toast) |

## Overview

Four importers exist (`lib/bruno`, `lib/postman`, `lib/openapi`, `lib/curl`). F5a shipped Bruno export and
F5b shipped Postman export. This feature delivers the **OpenAPI 3.0.x** export target: the inverse of the
existing OpenAPI importer (`openapiToTree` / `parseOpenapiDocument`).

**OpenAPI is a deliberately lossy target, and more lossy than Bruno or Postman.** Postman and Bruno model a
*request collection* - the same thing purerequest's tree is - so their exporters round-trip almost losslessly.
OpenAPI instead models an *API surface*: a set of `paths` x `operations`, servers, and reusable security
schemes. It has no concept of a folder tree, of stored auth secrets, of per-request scripts, of environments
beyond `servers`, or of non-`application/json` request examples the importer can read back. So the export
maps the tree onto the OpenAPI shape as faithfully as OpenAPI allows and drops what OpenAPI cannot represent.

The output is a **single JSON document** `<slug(name)>.openapi.json` (decision D1), written under
`<parent>/<slug(name)>/` via the same shared `CollectionWriter` F5a/F5b use (a one-entry file map).

The export **unit** matches F5a/F5b: a selected folder becomes the document root (its name -> `info.title`),
its subtree -> paths/tags; with no folder selected (nothing, or a request) the whole workspace is exported,
titled after the workspace.

The round-trip contract is scoped to the **importer-expressible subset** (see §Round-trip below): a tree
already in the shape `openapiToTree` produces round-trips modulo node ids, auth secret values, JSON body
whitespace, and non-JSON bodies. A tree with arbitrary nesting/scripts/secrets does not - by design.

## Round-trip contract (what survives `openapiToTree(treeToOpenapiDoc(root))`)

`openapiToTree` produces a specific canonical shape; the exporter targets exactly that shape so the subset
below round-trips. Everything else is a documented, accepted loss.

**Survives:**
- The single root folder named `info.title` (= `root.name`).
- One level of tag folders + loose (untagged) requests under the root, in encounter order.
- Per request: name (-> `summary`), method, path (with `{param}` templating), query params, path params,
  header rows, and a JSON request body.
- Servers <-> `baseUrl` variable / environments (single server -> `baseUrl` variable; multiple -> one
  environment per server, named after the server description = the environment name).
- Root/scope auth **mode** for `bearer` / `basic` (via `securitySchemes` + `security`).

**Lost (documented, accepted):**
- Node ids (importer mints fresh `openapi-N`).
- Auth **secret values** - OpenAPI `securitySchemes` carry no token/username/password, so a bearer token or
  basic credentials re-import as empty strings (mode preserved, secret reset).
- JSON body **whitespace** - a JSON body is parsed to an `example` and re-serialized by the importer with
  2-space indent, so formatting normalizes (semantics preserved).
- **Non-JSON bodies** - `form` / `multipart` / `graphql` are emitted with correct media types for external
  OpenAPI tooling (decision D2) but the importer only reads `application/json` back, so they re-import as
  no-body.
- Nesting **deeper than one folder level**, per-request/scope **scripts**, `dotenv`, `timeoutMs`,
  `httpVersion`, `environmentColors`, request-level environments, disabled-row flags - none exist in OpenAPI.

## Decisions

- **D1 - single JSON file.** Emit one `<slug>.openapi.json` (not YAML, not both). Matches the F5b Postman
  exporter's single-document shape; the importer reads JSON first so it round-trips cleanly.
- **D2 - best-effort media types for non-JSON bodies.** `json` + `graphql` -> `application/json`, `form` ->
  `application/x-www-form-urlencoded`, `multipart` -> `multipart/form-data`. Round-trip loss is identical
  whether or not these are emitted (the importer reads only `application/json`), so emitting them costs no
  fidelity and makes the document useful to Swagger UI / codegen.
- **D3 - immediate parent folder = tag.** A request's tag is the name of the folder that *directly* contains
  it; requests directly under the root are untagged. Folders nested deeper than one level are flattened onto
  the immediate parent's tag; two same-named immediate-parent folders merge under one tag.

## Acceptance Criteria

- AC-001: A pure `treeToOpenapiDoc(root: OpenapiExportRoot): OpenapiDocument` returns an OpenAPI 3.0.x
  document object `{ openapi: "3.0.3", info: { title: root.name, version: "1.0.0" }, paths, ... }` where
  `info.title` is the root name.
- AC-002: Each `RequestNode` emits a path-item operation keyed by its OpenAPI path and lowercased method
  (`get`/`post`/`put`/`patch`/`delete`/`query`), with `summary` = the request name. Multiple requests sharing
  one path merge under the same path-item key (one operation per method).
- AC-003: The OpenAPI **path** is derived from `node.url` by stripping a leading `{{var}}` token, dropping any
  `?query` string, converting `:seg` segments to `{seg}`, and ensuring a leading `/`. A stripped leading
  `{{baseUrl}}` (or any `{{var}}`) contributes its resolved value as a `servers` entry (AC-007).
- AC-004: `params.query` rows emit `parameters` with `in: "query"`; `params.path` rows emit `in: "path"` with
  `required: true`; `config.headers` rows emit `in: "header"`. Each parameter carries `name`, `schema:
  { type: "string" }`, and an `example` equal to the row value when the value is non-empty (empty value omits
  `example`).
- AC-005: The request body maps by active type to `requestBody.content`: `json` -> `application/json` with an
  `example` (the JSON text parsed when valid, else the raw string); `graphql` -> `application/json` with an
  `example` `{ query, variables }`; `form` -> `application/x-www-form-urlencoded`; `multipart` ->
  `multipart/form-data`; `none` emits no `requestBody`.
- AC-006: A request whose immediate parent is a folder gets `tags: [parentFolderName]` on its operation and
  that name is added once to the document's top-level `tags: [{ name }]` list; a request directly under the
  root has no `tags`. Folders nested deeper than one level are flattened onto the immediate parent's tag.
- AC-007: A `{{baseUrl}}` variable on the root/scope config emits `servers: [{ url: <value> }]`; when the root
  config carries multiple `environments` each with a `baseUrl` variable, one `servers` entry per environment
  is emitted, `url` = that environment's `baseUrl`, `description` = the environment name (so the importer's
  server->environment mapping round-trips).
- AC-008: A root/scope `auth` of mode `bearer` emits a `components.securitySchemes` entry `{ type: "http",
  scheme: "bearer" }` plus a top-level `security` requirement referencing it; `basic` emits `{ type: "http",
  scheme: "basic" }` + its requirement; `inherit` / `none` (or absent auth) emit no `securitySchemes` and no
  `security`. Secret values are never emitted.
- AC-009: A round-trip `openapiToTree(JSON.stringify(treeToOpenapiDoc(root)), root.name)` reconstructs the
  importer-expressible subset: a single root folder (`info.title`), one level of tag folders + loose requests,
  and each request's name / method / url / query params / path params / header rows / JSON body / servers /
  auth **mode**, modulo node ids, auth secret values (reset to empty), JSON whitespace, and dropped non-JSON
  bodies (§Round-trip).
- AC-010: An `OpenapiExportWriter.save(files, suggestedName)` (the shared `CollectionWriter`) writes the
  single `<slug(suggestedName)>.openapi.json` under `<parent>/<slug(suggestedName)>/`, returns `true` on write
  and `false` on cancel; the no-op writer (dev browser) returns `false`.
- AC-011: A folder row's context menu exposes an **Export as OpenAPI...** item (folder rows only; request rows
  unaffected). Selecting it exports that folder as an OpenAPI document.
- AC-012: An `export-openapi` shortcut action (command palette + rebindable hotkey, default `Mod+Alt+O`)
  exports the target folder as the document root; with no folder selected it exports the whole workspace,
  titled after the workspace. On success a toast `Exported OpenAPI document`; on cancel nothing changes; on
  write failure an error toast `Failed to export OpenAPI document`.

## User Test Cases

- TC-001 (happy path, single request): a root named "My API" with one `GET {{baseUrl}}/users` request ->
  `treeToOpenapiDoc` returns `{ openapi:"3.0.3", info:{title:"My API",version:"1.0.0"}, servers:[{url:...}],
  paths:{ "/users":{ get:{ summary:"..." } } } }`. Maps to: AC-001, AC-002, AC-003.
- TC-002 (path templating + path param): a `GET {{baseUrl}}/users/:id` request with `params.path:
  [{key:"id",value:"7"}]` -> path key `/users/{id}`; the operation has a parameter `{name:"id", in:"path",
  required:true, schema:{type:"string"}, example:"7"}`. Maps to: AC-003, AC-004.
- TC-003 (query + header params): a request with `params.query:[{key:"page",value:"2"}]` and
  `config.headers:[{key:"X-Api",value:"k"}]` -> two parameters, `in:"query"` (page) and `in:"header"`
  (X-Api), each with its `example`. Maps to: AC-004.
- TC-004 (empty param value omits example): a query row `{key:"q",value:""}` -> a parameter with no `example`
  key. Maps to: AC-004.
- TC-005 (JSON body): a request with a `json` body `{"a":1}` (indented) -> `requestBody.content
  ["application/json"].example` deep-equals `{a:1}` (parsed). Maps to: AC-005.
- TC-006 (non-JSON bodies): three requests with `form` / `multipart` / `graphql` bodies -> media types
  `application/x-www-form-urlencoded`, `multipart/form-data`, `application/json` (graphql, example
  `{query,variables}`) respectively. Maps to: AC-005.
- TC-007 (none body): a request with `body.active:"none"` -> the operation has no `requestBody`. Maps to:
  AC-005.
- TC-008 (tags from folder): root -> folder "Users" -> a request; plus a loose request under root -> the
  first operation has `tags:["Users"]`, the loose one has no `tags`, and the document's top-level `tags`
  contains `{name:"Users"}` exactly once. Maps to: AC-006.
- TC-009 (deep nesting flattened): root -> folder "A" -> folder "B" -> request -> the operation's tag is "B"
  (the folder that directly contains the request), and "A" contributes no tag; on re-import the request lands
  in a single flat folder "B" under the root. Maps to: AC-006.
- TC-010 (single server): root config `variables:[{key:"baseUrl",value:"https://api.example.com"}]` -> `servers:
  [{url:"https://api.example.com"}]`, and request paths carry no `{{baseUrl}}` prefix. Maps to: AC-007.
- TC-011 (multiple environments -> servers): root config with two environments `dev`/`prod`, each a `baseUrl`
  variable -> `servers:[{url:<dev>,description:"dev"},{url:<prod>,description:"prod"}]`. Maps to: AC-007.
- TC-012 (bearer security): root auth `bearer` -> `components.securitySchemes` has an http+bearer scheme and
  top-level `security` references it; no token value appears anywhere in the document. Maps to: AC-008.
- TC-013 (basic security): root auth `basic` -> an http+basic scheme + requirement. Maps to: AC-008.
- TC-014 (no security): root auth `inherit` (or absent) -> no `components.securitySchemes`, no `security`.
  Maps to: AC-008.
- TC-015 (round-trip): a tree in importer-canonical shape (root; one tag folder + one loose request; requests
  with query/path/header rows and a JSON body; a `baseUrl` variable; root bearer auth) ->
  `openapiToTree(JSON.stringify(treeToOpenapiDoc(root)), name)` yields a single root folder whose nesting +
  per-request name/method/url/query/path/headers/JSON-body + baseUrl variable + auth **mode** equal the
  originals, modulo node ids and the reset bearer token. Maps to: AC-009.
- TC-016 (writer writes): `save` with a fake picker + in-memory fs -> `<dir>/<slug(name)>/<slug(name)>.openapi
  .json` is written; resolves `true`. Maps to: AC-010.
- TC-017 (writer cancel): `save` when the picker returns null -> resolves `false`, writes nothing. Maps to:
  AC-010.
- TC-018 (folder menu): right-click a folder row -> an **Export as OpenAPI...** item is present; a request row
  -> it is absent. Maps to: AC-011.
- TC-019 (shortcut/palette, folder target): select a folder, run `export-openapi` -> the writer is called with
  that folder as the root (suggestedName = folder name) and a success toast fires. Maps to: AC-012.
- TC-020 (shortcut/palette, whole workspace): select a request (or nothing), run `export-openapi` -> the writer
  is called with the whole workspace as the root, titled after the workspace. Maps to: AC-012.
- TC-021 (write failure): a rejecting `save` -> an error toast `Failed to export OpenAPI document`; the tree is
  unchanged. Maps to: AC-012.

## UI States

| State   | Behavior                                                                                          |
| ------- | ------------------------------------------------------------------------------------------------- |
| Loading | N/A - the emit is synchronous; only the directory pick + file write are async (no spinner).       |
| Empty   | Exporting an empty folder emits a valid document with an empty `paths` `{}`; an empty workspace exports a bare document. |
| Error   | Write failure (fs error) -> an error toast; the tree is unchanged. Picker cancel -> silent no-op. |
| Success | File written -> a toast `Exported OpenAPI document`.                                               |

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
| Export as Postman...       |
| Export as OpenAPI...       |   <- new (folder rows only)
+----------------------------+
| Delete                     |
+----------------------------+
```

### Emitted layout (example)

```
<parent>/<doc-slug>/
  my-api.openapi.json     # { openapi:"3.0.3", info, servers?, paths, components?, security?, tags? }
```

## Data model

No new persisted model. Reuses `TreeNode` / `FolderNode` / `RequestNode` / `ConfigScope` / `Environment` /
`KeyValue` / `Auth` / `RequestBody` from `lib/workspace/model.ts`.

New in-memory types (not persisted):

- `OpenapiExportRoot = { name: string; config: ConfigScope; children: TreeNode[] }` - the document root handed
  to the emitter (a folder subtree, or a synthetic wrap of the whole workspace). Mirrors F5b's
  `PostmanExportRoot`. No `dotenv` (OpenAPI has no `.env` concept).
- `OpenapiDocument = Record<string, unknown>` - the emitted document object (`treeToOpenapiDoc` returns the
  object; the writer/round-trip serializes it via `JSON.stringify`).
- `OpenapiExportWriter = CollectionWriter` alias (reuses `lib/export/collection-writer.ts`; no writer change).

## Edge cases

1. **Absolute / bare URLs (not `{{baseUrl}}`-prefixed).** The path derivation strips a leading
   `scheme://host` so a full `https://host/path` yields path `/path`; a bare `/foo` -> `/foo`; a token-less
   `foo` -> `/foo` (OpenAPI paths must start with `/`). The stripped host is NOT lifted into a `servers`
   entry: `servers` is derived solely from config (`baseUrl` variable / environments, AC-007), because
   OpenAPI's single top-level `servers` array cannot faithfully carry a distinct host per operation. This is
   an external-tooling fidelity gap only - it never affects the round-trip (the importer emits
   `{{baseUrl}}/path` or `/path`, never a per-request absolute host).
2. **Path templating collisions / duplicate method on one path.** Two requests with the same path + method:
   last wins on the operation slot (documented; OpenAPI keys operations by path+method).
3. **Query already in the url string.** The path derivation drops any `?a=b` from the path; query params come
   only from `params.query`, matching the importer (which never puts `?` in a request url).
4. **Empty / all-symbol names.** The document file slug and any tag reuse `slugify` -> `untitled` for an empty
   name (file), tag names are the raw folder names (may repeat -> merged, D3).
5. **Non-JSON `json` body text.** A `json` body whose text is not valid JSON is emitted as a raw-string
   `example` (not `null`); it re-imports as a JSON string literal (documented normalization).
6. **Picker cancel** - `save` resolves `false`, nothing written, no toast (TC-017).
7. **Write failure** - a rejecting `save` is caught and surfaced as a `Failed to export OpenAPI document`
   toast; no partial-state cleanup (a one-shot dump, not the reconciling workspace writer).
8. **`QUERY` method.** Emitted as a lowercase `query` operation key; the importer's `METHODS` map reads it
   back to `QUERY`, so it round-trips (non-standard OpenAPI, but symmetric with the importer).

## Dependencies

- Existing: shared `CollectionWriter` (`lib/export/collection-writer.ts`) - `createTauriCollectionWriter` /
  `createNoopCollectionWriter`, aliased as the OpenAPI writer (mirrors `lib/postman/writer.ts`).
- Existing: `slugify` / `uniqueSlug` from `lib/workspace/slug.ts`.
- Existing importer as the round-trip oracle: `openapiToTree` / `parseOpenapiDocument` / `resolveRef`.
- Existing UI wiring points (mirror F5b): `tree-row.tsx` (menu), `shortcuts/registry.ts` (action + hotkey),
  `workspace-context/exports.ts` (routing), `workspace-context/types.ts` + `index.tsx` + `main.tsx` +
  `workspace-loader.tsx` (writer ref plumbing).
- No new npm packages.
