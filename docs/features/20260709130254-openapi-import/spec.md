# Spec: Import OpenAPI document

**Version:** 0.1.0
**Created:** 2026-07-09
**Status:** Draft (awaiting approval)

## 1. Overview

purerequest imports a single request from a cURL string, a whole **Bruno collection** (a folder of
`.bru`/`.yml` files), and a **Postman collection** (`*.postman_collection.json`). This feature adds
importing an **OpenAPI 3.x document** (`openapi.yml` / `openapi.json`, versions **3.0 and 3.1**) into
the current workspace as a **new top-level folder**: one request per operation, grouped into per-tag
folders, with method / url / params / headers / body scaffolded from the spec. It turns an API
description into a ready-to-send collection.

Additive, exactly like Bruno / Postman / cURL import: it never replaces the open workspace; the
imported subtree persists through the existing `onTreeChange` write path.

Unlike Bruno (a folder tree) and Postman (a nested `item` array), an OpenAPI doc is a **single file**
(JSON or YAML) whose **flat `paths` map** describes operations; the tree structure is synthesised from
`tags`. So the mapper takes one file's text, not a file map.

### Scope

- **In:** an `Import OpenAPI document` action (command palette + default hotkey `Mod+Shift+O`) that
  opens a native **single-file picker** (`json`/`yaml`/`yml`), reads the file, parses the 3.0/3.1 doc
  into a purerequest `TreeNode[]` subtree, inserts it as one new top-level folder, opens/selects it, and
  persists. Two pure modules do the work: an OpenAPI parser (`parse-openapi.ts`, JSON + YAML, local
  `$ref` resolution) and a doc -> tree mapper (`openapi-to-tree.ts`).
- **Out:** **Swagger 2.0** (2014 shape - `definitions`/`basePath`/`in:body`) - deferred to a follow-up;
  export TO OpenAPI; HAR import; **external `$ref`** (other files / URLs - can't fetch, treated as
  absent); **schema-synthesised bodies** (only *explicit* examples seed a body - no schema walker);
  **request bodies other than `application/json`** (urlencoded / multipart request bodies -> no body,
  documented); **operation-level `security`** (only the global `security` seeds root auth); apiKey /
  oauth2 / openIdConnect security schemes (-> inherit, not fatal); `webhooks` (3.1) and `callbacks`;
  response schemas / example responses; server-variable enum choices (only the `default` is used);
  merging into an existing folder (always a new sibling).

### Decisions (recommended defaults)

- **Versions = OpenAPI 3.0 + 3.1 only** (2017 + 2021). A `swagger: "2.0"` doc, or a doc with no
  `openapi` field, parses to `null` (import no-op) - Swagger 2.0 is a distinct shape, deferred.
- **Surface = single-file picker** (`json`/`yaml`/`yml`), `multiple:false`. An OpenAPI doc is one file
  (servers + environments live *inside* it), so no multi-select / no file map / no `.env` merge (unlike
  Postman). A new `OpenapiReader` port (pick + read the one file) is threaded loader -> layout -> main
  exactly like the Bruno / Postman readers.
- **Import target = a new top-level folder** named from `info.title` (fallback = picked file base name),
  inserted at workspace root, persisted via the existing `persistTree` / `onTreeChange` path.
- **Grouping = by tag only.** Each operation's **first** `tag` -> a child folder of that name (created
  once, ops folded in first-appearance order). An operation with **no** tags -> a `RequestNode` directly
  under the root folder.
- **Body seed = explicit examples only.** A request body is seeded only from an `application/json`
  example (`example`, else first `examples[*].value`, else the media-type `schema.example`); no example
  / non-json -> no body. No schema-to-skeleton synthesis (out of scope).
- **Servers -> environments.** The first server's url seeds root `config.variables.baseUrl` (so
  `{{baseUrl}}` always resolves); when the doc has **2+ servers**, each server also becomes an
  `Environment` (`config.environments.<name>`, name from `description` or `Server N`) carrying its own
  `baseUrl`. With **no** servers, requests carry the bare path (no `{{baseUrl}}` prefix).
- **Lenient parse, like Bruno / Postman.** Invalid JSON/YAML or a doc without `openapi`+`paths` -> `null`
  (no-op); unknown / unsupported fields skipped; nothing throws.
- **`{{var}}` needs no transform** - OpenAPI and purerequest share the `{{name}}` syntax; but **OpenAPI path
  templating `{name}` is rewritten to purerequest's `:name`** so path-param substitution works.

## 2. Data model

No new persisted fields. Import produces ordinary `FolderNode` / `RequestNode`s. `OpenapiReader` yields
`{ name: string; text: string }` (one file, not a map). The mapper is total:

- `parseOpenapiDocument(text): OpenapiDoc | null` - JSON-or-YAML parse + version gate; `null` for invalid
  text or a non-3.x doc (never throws).
- `openapiToTree(text, fallbackName): TreeNode[]` - the single imported root folder wrapped in an array
  (or `[]` when the doc is invalid or has no operations).

## 3. OpenAPI 3.x mapping

```yaml
openapi: "3.0.3"          # or "3.1.0"
info: { title: My API, version: 1.0.0 }
servers:
  - { url: "https://api.example.com/v1", description: Production }
  - { url: "https://{host}/v1", variables: { host: { default: staging.example.com } } }
tags:
  - { name: users }
paths:
  /users/{id}:
    parameters: [ { name: id, in: path, required: true, schema: { type: string } } ]  # shared
    get:
      tags: [users]
      summary: Get a user
      operationId: getUser
      parameters:
        - { name: verbose, in: query, schema: { type: boolean }, example: true }
        - { name: X-Trace, in: header, schema: { type: string } }
      responses: { "200": { description: ok } }
    put:
      tags: [users]
      requestBody:
        content:
          application/json:
            schema: { $ref: "#/components/schemas/User" }
            example: { name: Ada }
components:
  securitySchemes: { bearerAuth: { type: http, scheme: bearer } }
security: [ { bearerAuth: [] } ]
```

### 3a. Operation -> RequestNode

| OpenAPI                                                | purerequest                                                                     |
| ------------------------------------------------------ | ------------------------------------------------------------------------- |
| path key + method key (`get`/`post`/`put`/`patch`/`delete`) | one `RequestNode` per (path, method); other method keys (`head`/`options`/`trace`) skipped |
| method key                                             | `method` (upper-cased)                                                    |
| `summary` \|\| `operationId` \|\| `"METHOD path"`      | `name`                                                                    |
| path key `/users/{id}`                                 | `url` = `{{baseUrl}}` + path, `{id}` rewritten to `:id` (bare path when no servers) |
| `parameters[in:path]` (op + path-level, op wins)       | `params.path` rows (`:name` -> value)                                     |
| `parameters[in:query]`                                 | `params.query` rows (all enabled)                                         |
| `parameters[in:header]`                                | `config.headers` rows (all enabled)                                       |
| param value                                            | `example` \|\| `schema.example` \|\| `schema.default` \|\| `""`           |
| `requestBody.content["application/json"]` example      | `body` json slot (stringified, 2-space); `example`, else first `examples[*].value`, else `schema.example` |
| non-json body / no requestBody / no example            | no body (`none`)                                                          |

`$ref` (local `#/...`) is resolved for path items, parameters, requestBody, and example nodes before mapping.

### 3b. Root folder + servers + auth

- `info.title` -> root folder name (fallback = provided picked-file base name).
- **servers:** first server url (server-template `{x}` filled from `variables.<x>.default`, trailing `/`
  stripped) -> root `config.variables` row `baseUrl`. If `servers.length >= 2`, each server also ->
  `config.environments.<name>` with its own `baseUrl` row (name = `description` trimmed, else `Server N`).
- **auth:** the global `security` requirement + `components.securitySchemes` seed root `config.auth`: a
  referenced `http`+`bearer` scheme -> `{active:"bearer", token:""}`; `http`+`basic` ->
  `{active:"basic", "", ""}`; any other scheme type -> no auth (request/folder inherits). Credentials are
  empty (OpenAPI describes the scheme, carries no secret).
- Everything wraps in **one** root `FolderNode`; per-tag child folders hold the tagged operations,
  untagged operations sit directly in the root. Node ids are synthetic (`openapi-<n>`); the next disk
  reload regenerates path-based ids (same convention as Bruno / Postman import).

## 4. Reader port + UI

- `OpenapiReader = { pick: () => Promise<{ name: string; text: string } | null> }`.
  - `createTauriOpenapiReader()` - `open({multiple:false, filters:[{extensions:["json","yaml","yml"]}]})`
    then `readTextFile`; `null` on cancel/error. `name` = the picked file's base name.
  - `createNoopOpenapiReader()` - returns `null` (dev-browser / no native host).
- **Action** `import-openapi` (palette + default hotkey `Mod+Shift+O`). Handler in `Main`:
  `openapiReader.pick().then(picked => picked && importOpenapi(picked.text, picked.name))`.
- **Context** `importOpenapi(text, name)` - `openapiToTree(text, name)` -> guard empty (no operations ->
  no-op) -> insert the root folder at workspace root via the existing insert/expand/select/persist
  sequence, toast "Imported OpenAPI document". No `.env` merge (OpenAPI has none).
- No new dialog component; the picker is the only UI surface (like Bruno / Postman import).

### UI States

| State                | Behavior                                                                                  |
| -------------------- | ----------------------------------------------------------------------------------------- |
| Picker cancelled     | No-op: no tree change, no toast.                                                          |
| Empty / unreadable   | Reader returns null, or invalid doc, or no operations -> no-op, no folder added.          |
| Valid document       | A new top-level folder appears (named from `info.title`), selected + expanded; tree persisted; toast. |
| Dev browser          | Noop reader -> action is a silent no-op (no native picker).                               |

## 5. Acceptance criteria

- **AC-001:** `parseOpenapiDocument` parses **JSON and YAML** and version-gates: a doc with
  `openapi: "3.0.x"` / `"3.1.x"` parses; `swagger: "2.0"`, a missing/other `openapi` value, or invalid
  text -> `null` (never throws).
- **AC-002:** each (path, method) pair -> one `RequestNode`; the method is upper-cased; only
  `get`/`post`/`put`/`patch`/`delete` are imported (`head`/`options`/`trace` skipped);
  `name` = `summary` \|\| `operationId` \|\| `"METHOD path"`.
- **AC-003:** the request `url` = `{{baseUrl}}` + path with OpenAPI `{name}` rewritten to purerequest `:name`;
  when the doc has **no** `servers`, the url is the bare path (no `{{baseUrl}}` prefix).
- **AC-004:** `parameters` map by `in`: `path` -> `params.path`, `query` -> `params.query`, `header` ->
  `config.headers`; each value seeded from `example` \|\| `schema.example` \|\| `schema.default` \|\| `""`;
  a path-level `parameters` entry merges with the operation's (operation wins on same `name`+`in`).
- **AC-005:** an `application/json` request body example -> `body` json slot (stringified): `example`,
  else the first `examples[*].value`, else the media-type `schema.example`; a non-json body, no
  `requestBody`, or no example -> no body (`none`).
- **AC-006:** `servers` map: the first server url (server-vars filled from `variables.<x>.default`,
  trailing `/` stripped) -> root `config.variables.baseUrl`; when there are **2+** servers, each also ->
  `config.environments.<name>` (name from `description`, else `Server N`) with its own `baseUrl`.
- **AC-007:** grouping by tag: an operation's **first** `tag` -> a child folder of that name (created
  once, reused for later ops with the same tag); an operation with **no** tags -> a `RequestNode`
  directly under the root folder.
- **AC-008:** local `$ref` (`#/...` JSON pointer) is resolved for path items, parameters, requestBody,
  and example nodes (with a cycle/depth guard); an external `$ref` (not starting `#/`) is treated as
  absent (skipped, not fatal).
- **AC-009:** the global `security` + `components.securitySchemes` seed root `config.auth`: a referenced
  `http`+`bearer` scheme -> `{active:"bearer", token:""}`; `http`+`basic` -> `{active:"basic"}`; any
  other scheme type -> no auth set (inherit).
- **AC-010:** parse is lenient/total: invalid JSON/YAML, or a 3.x doc without `paths`, yields `null` /
  `[]`; unknown fields are skipped and nothing throws.
- **AC-011:** `openapiToTree(text, name)` wraps the result in one root folder named `info.title`
  (fallback = provided name); a doc with no operations -> `[]`.
- **AC-012:** `importOpenapi(text, name)` inserts the parsed doc as a new top-level folder, selects +
  expands it, and persists via `onTreeChange`; a doc with no operations adds nothing and does not persist.
- **AC-013:** `import-openapi` is registered in the shortcut registry (palette entry + default hotkey
  `Mod+Shift+O`) and, when run, invokes the reader and imports the picked doc (no-op when the reader
  returns `null`).

## 6. Test cases

- **TC-001** (version gate + format, AC-001/010): a minimal `openapi:"3.0.0"` JSON doc parses; the same
  as YAML parses equivalently; `swagger:"2.0"` -> `null`; a doc with no `openapi` -> `null`; garbage text
  -> `null`; a `3.1.0` doc parses.
- **TC-002** (operation -> request, AC-002): a path with `get` + `post` -> two request nodes (GET, POST);
  a `head`/`options` key on the same path -> skipped; `name` from `summary`, falling back to
  `operationId`, then `"GET /x"`.
- **TC-003** (url, AC-003): `/users/{id}` with a server -> `{{baseUrl}}/users/:id`; with no servers ->
  `/users/:id`.
- **TC-004** (params, AC-004): path/query/header params -> the three grids; a param `example` seeds the
  value, else `schema.default`; a path-level shared param + an operation param merge (op wins on clash).
- **TC-005** (body, AC-005): a PUT with an `application/json` `example` -> json body (stringified); an
  `examples` map (no `example`) -> first entry's `value`; a `schema.example` -> used; a request with no
  json content or no example -> no body.
- **TC-006** (servers, AC-006): one server -> `baseUrl` variable, no environments; two servers -> the
  variable (first) + two environments; a server-template `{host}` filled from its `variables.host.default`.
- **TC-007** (grouping, AC-007): two operations tagged `users` -> one `users` child folder holding both;
  an untagged operation -> a request directly under the root folder.
- **TC-008** (`$ref`, AC-008): a parameter `$ref: "#/components/parameters/limit"` resolves to the target
  param; a `requestBody: { $ref: "#/components/requestBodies/UserBody" }` resolves; an external
  `$ref: "other.yaml#/x"` is treated as absent (no throw).
- **TC-009** (auth, AC-009): a global `security` referencing an `http`+`bearer` scheme -> root auth
  `{active:"bearer"}`; an `http`+`basic` scheme -> basic; an `apiKey` scheme -> no auth.
- **TC-010** (tree wrap, AC-011): a valid doc -> one root folder named from `info.title` (fallback when
  absent); a doc with `paths: {}` -> `[]`.
- **TC-011** (integration, AC-012/013): the palette lists `Import OpenAPI document`; running it with a
  fake reader returning a doc inserts a new top-level folder (visible in the tree) and persists via
  `onTreeChange`; a reader returning `null` inserts nothing; a doc with no operations inserts nothing.

## 7. Edge cases

- **Picker cancelled / reader error:** reader returns `null` -> no-op (no folder, no persist, no toast).
- **Invalid / non-3.x doc:** `openapiToTree` returns `[]` -> `importOpenapi` no-op.
- **No operations** (`paths: {}` or only unsupported method keys): root folder empty -> AC-012 adds
  nothing (no stray empty folder).
- **OpenAPI path templating `{name}`:** rewritten to `:name`. A param name with non-word chars
  (`{user-id}`) becomes `:user-id`; purerequest's `:name` substitution matches only the leading word chars -
  documented rough edge, still readable.
- **Server url trailing slash + leading-slash path:** the server url's trailing `/` is stripped so
  `{{baseUrl}}` + `/users` never doubles the slash.
- **Server-variable template** (`https://{host}/v1`): each `{x}` is filled from `variables.x.default`;
  an unlisted `{x}` is left literal.
- **Multiple tags on one operation:** the operation is placed under its **first** tag only (not
  duplicated).
- **Path item / parameter / requestBody `$ref`:** resolved when local (`#/...`); a cyclic or too-deep
  chain stops at the depth guard and is treated as absent.
- **YAML anchors/aliases:** resolved natively by the `yaml` parser.
- **No native host (dev browser):** noop reader -> the action does nothing (no picker dialog).
- **No workspace open (empty state):** import inserts in-memory; with no `onTreeChange` it isn't written
  to disk (identical to Bruno / Postman / cURL import). Documented.

## 8. Dependencies

- Reuses the Bruno / Postman import threading pattern (loader -> layout -> main) for the new
  `OpenapiReader` port; `insertNode` + `persistTree` / `onTreeChange`; `KeyValue` / `Auth` / `HttpMethod`
  / `BodyMode` / `ConfigScope` / `Environment` / `TreeNode` model types + `authOf` / `emptyBody`; the
  `@tauri-apps/plugin-dialog` `open` + `@tauri-apps/plugin-fs` `readTextFile` (already used by the Bruno /
  Postman readers); the shortcut registry + command palette; `useToast`. **Reuses the existing `yaml`
  dependency** (already used by `parse-opencollection.ts`) - no new npm dependency. **No Rust change**
  (read is plugin-fs from the frontend). No on-disk format version bump (import produces ordinary nodes).
