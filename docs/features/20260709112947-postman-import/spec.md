# Spec: Import Postman collection

**Version:** 0.1.0
**Created:** 2026-07-09
**Status:** Approved (user pre-approved spec + plan + implementation)

## 1. Overview

purerequest already imports a single request from a cURL string and a whole **Bruno collection** (a folder
of `.bru`/`.yml` files) as a new top-level folder. This feature adds importing a **Postman collection**
(`*.postman_collection.json`, schema v2.1) - the most common export format purerequest cannot read yet - into
the current workspace as a **new top-level folder**. Additive, like Bruno/cURL import: it never replaces
or clobbers the open workspace; the imported subtree persists through the existing `onTreeChange` write
path.

Unlike Bruno, a Postman collection is a **single JSON file** whose `item` arrays nest to form the whole
tree; the directory only matters for locating sibling `*.postman_environment.json` files (folded into
`config.environments`) and a `.env` (merged into the workspace `.env`). So the tree walk lives inside the
parser, not the file-map fold.

### Scope

- **In:** an `Import Postman collection` action (command palette + default hotkey `Mod+Shift+P`) that
  opens a native **multi-select file picker** (`*.json`), reads the picked files, parses the v2.1
  collection into a purerequest `TreeNode[]` subtree, inserts it as one new top-level folder, opens/selects it,
  and persists. Two pure modules do the work: a Postman-JSON parser
  (`parse-postman.ts`) and a file-map -> tree mapper (`postman-to-tree.ts`) that picks the collection +
  environment files and folds them together. Plus a `pm.*` script alias in the QuickJS runner so imported
  Postman scripts run instead of `ReferenceError`-ing.
- **Out:** export TO Postman (deferred); OpenAPI/HAR import (deferred, item #4); introspection; file
  multipart parts (`formdata` type `file` -> value kept as literal text, no file src, like Bruno/cURL);
  Postman auth types other than bearer/basic/noauth (`apikey`/`oauth2`/`digest`/... -> `inherit`, not
  fatal); running Postman `test`/assertion logic (scripts are imported + runnable via the `pm.*` alias,
  but `pm.expect`/`pm.test` assertions are best-effort no-throw, not evaluated as pass/fail); merging into
  / overwriting an existing folder (we always create a new sibling folder); the Postman `pm.sendRequest`
  chained-request API.

### Decisions captured (recommended defaults, no clarifying questions per directive)

- **Surface = multi-select file picker** (revised - originally a folder picker mirroring Bruno). A Postman
  collection is a single JSON file, so a file picker is the natural surface (a folder picker cannot select
  a file and forces a clean single-collection dir). Multi-select still lets a `*.postman_environment.json`
  (and a `.env`) come along in the same pick, so environments fold into `config.environments` / the
  workspace `.env`. A new `PostmanCollectionReader` port (pick + read the chosen `.json`/`.env` files) is
  threaded loader -> layout -> main exactly like the Bruno `reader`.
- **Import target = a new top-level folder** named from the collection's `info.name` (fallback = the
  picked dir base name), inserted at workspace root, persisted via the existing `persistTree`/
  `onTreeChange` path. Mirrors Bruno import's "create a new folder, never touch the active request" rule.
- **Environments fold into config** (ADR 2026-06-20): each `*.postman_environment.json` (`{name, values}`)
  maps onto the imported root folder's `config.environments.<name>`.
- **Lenient parse, like the Bruno importer.** Invalid JSON or a non-collection-shaped file yields no
  collection (import is a no-op / that file is ignored), never a throw; unknown/unsupported fields are
  skipped.
- **`{{var}}` needs no transform** - Postman and purerequest share the `{{name}}` token syntax.
- **First collection wins.** If the picked dir holds several `*.postman_collection.json` files, the first
  (path-sorted) is imported; the rest are ignored (documented limitation).

## 2. Data model

No new persisted fields. Import produces ordinary `FolderNode`/`RequestNode`s. Internal (not persisted):

```ts
type PostmanFileMap = Record<string, string>; // collection-relative path -> file text
```

`parsePostmanCollection(text, fallbackName): FolderNode | null` is total (never throws; invalid JSON or a
doc without `info`+`item` -> `null`). `parsePostmanEnvironment(text): Environment | null` is total.
`postmanToTree(files, fallbackName): TreeNode[]` returns the single imported root folder wrapped in an
array (or `[]` when no collection file is present).

## 3. Postman v2.1 mapping

A Postman collection JSON:

```jsonc
{
  "info": { "name": "My API", "schema": ".../v2.1.0/collection.json" },
  "item": [ /* items: folders (have `item`) or requests (have `request`) */ ],
  "variable": [ { "key": "baseUrl", "value": "https://api.example.com" } ],
  "auth": { "type": "bearer", "bearer": [ { "key": "token", "value": "t" } ] },
  "event": [ { "listen": "prerequest", "script": { "exec": ["..."] } } ]
}
```

### 3a. Item -> node

| Postman item                                   | purerequest node                                                    |
| ---------------------------------------------- | ------------------------------------------------------------- |
| `{ name, item: [...], variable?, auth?, event? }` | `FolderNode` (name; config from `variable`/`auth`/`event`; children = walk `item`) |
| `{ name, request: {...}, event? }`             | `RequestNode` (see 3b; `event` -> `config.scripts`)           |

### 3b. Request object -> RequestNode fields

| Postman `request`                                          | purerequest                                                              |
| ---------------------------------------------------------- | ------------------------------------------------------------------ |
| `method`                                                   | `method` (upper-cased; non-standard -> `GET`)                      |
| `header: [{ key, value, disabled? }]`                      | `config.headers` (`disabled:true` -> `enabled:false`)              |
| `url` (string) or `url.raw`                                | `url`                                                              |
| `url.query: [{ key, value, disabled? }]`                   | `params.query` (`disabled:true` -> `enabled:false`; a key already in `url.raw`'s `?query` is dropped - the url wins, no duplicate) |
| `url.variable: [{ key, value }]`                           | `params.path` (`:name` -> value rows)                              |
| `body.mode: "raw"` + `body.raw`                            | json slot, verbatim (any `options.raw.language`)                   |
| `body.mode: "urlencoded"` + `body.urlencoded`              | `bodyMode:"form"` + rows (`disabled` -> `enabled:false`)           |
| `body.mode: "formdata"` + `body.formdata`                  | `bodyMode:"multipart"` + rows (text parts; a `type:"file"` row keeps its `value` as literal text, no file src) |
| `body.mode: "graphql"` + `body.graphql: {query, variables}`| `bodyMode:"graphql"` + query/variables (variables kept as its string) |
| `body.mode: "file"` / absent / `body: null`                | no body (`none`)                                                  |
| `auth: { type:"bearer", bearer:[{key:"token",value}] }`    | `{active:"bearer", token}`                                         |
| `auth: { type:"basic", basic:[{key:"username"|"password",value}] }` | `{active:"basic", username, password}`                    |
| `auth: { type:"noauth" }`                                  | `{active:"none"}`                                                  |
| `auth: { type:"apikey"|"oauth2"|... }`                     | omitted -> request inherits (unsupported, not fatal)              |
| `event: [{listen:"prerequest", script:{exec}}]`            | `scripts.pre` (exec array joined with `\n`, or exec string)       |
| `event: [{listen:"test", script:{exec}}]`                  | `scripts.post`                                                    |

### 3c. Collection root + environments

- `info.name` -> root folder name (fallback = provided picked-dir name).
- `variable` -> root `config.variables`; root `auth` -> `config.auth`; root `event` -> `config.scripts`.
- Each `*.postman_environment.json` (or a `{name, values:[{key,value,enabled?}]}`-shaped `.json`) ->
  root `config.environments.<name>` (`values` -> variable rows; `enabled:false` -> `enabled:false`).
- The collection root `.env` (the reader captures it, at any depth) -> **merged into the workspace `.env`**
  by `importPostman` via `mergeDotenv` (imported keys win on a clash), so any `{{process.env.X}}` resolves.
- Everything is wrapped in **one** root `FolderNode`. Node ids are synthetic (`postman-<n>`); the next
  disk reload regenerates path-based ids (same accepted convention as Bruno/cURL import).

## 4. `pm.*` script alias (QuickJS runner)

Imported Postman scripts call `pm.*`. Like Bruno's `bru.*`, alias the reachable surface onto the existing
host API (purerequest has one variable space + no filesystem), enough for pasted/imported Postman scripts to run
instead of `ReferenceError`-ing:

- `pm.variables.get/set`, `pm.environment.get/set`, `pm.collectionVariables.get/set`, `pm.globals.get/set`
  -> `purerequest.getVar`/`purerequest.setVar`.
- Post stage (`__hasRes`): `pm.response = { code, responseTime, json(), text(), headers:{ get(n) } }`
  mapping to `res.getStatus`/`getResponseTime`/`getJson`/`getBody`/`getHeader`.
- `pm.test(name, fn)` runs `fn()` and swallows a thrown assertion (a failing assertion doesn't abort the
  rest of the script). `pm.expect` is **not** provided (assertions inside `pm.test` throw-and-are-swallowed;
  documented limitation).
- `pm.request` (mutating the in-flight request from a pre-request script) is **out of scope** for v1
  (pre-request var writes via `pm.variables.set` still work); documented.

## 5. Reader port + UI

- `PostmanCollectionReader = { pick: () => Promise<{ name: string; files: PostmanFileMap } | null> }`.
  - `createTauriPostmanReader()` - `open({multiple:true, filters:[{extensions:["json"]}]})` then read each
    picked file (keyed by base name); returns `null` on cancel/error. `name` = the picked files' parent
    dir name (the mapper derives the real name from `info.name`).
  - `createNoopPostmanReader()` - returns `null` (dev-browser / no native host).
- **Action** `import-postman` (palette + default hotkey `Mod+Shift+P`). Handler in `Main`:
  `postmanReader.pick().then(picked => picked && importPostman(picked.files, picked.name))`.
- **Context** `importPostman(files, name)` - `postmanToTree(files, name)` -> guard empty (no requests and
  no child folders -> no-op) -> insert the root folder at workspace root via the existing insert/expand/
  select/persist sequence, merge any collection `.env`, toast "Imported Postman collection".
- No new dialog component; the picker is the only UI surface (like Bruno import / open-workspace).

### UI States

| State                | Behavior                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| Picker cancelled     | No-op: no tree change, no toast.                                         |
| Empty / unreadable   | Reader returns null, or no collection file, or an empty collection -> no-op, no folder added. |
| Valid collection     | A new top-level folder appears (named from `info.name`), selected + expanded; tree persisted; toast. |
| Dev browser          | Noop reader -> action is a silent no-op (no native picker).             |

## 6. Acceptance criteria

- **AC-001:** `parsePostmanCollection` maps a request item to a `RequestNode`: `method` (upper-cased;
  non-standard -> `GET`) and `url` (from `url.raw` or a bare string url).
- **AC-002:** request `header` rows map to `config.headers`, a `disabled:true` header -> `enabled:false`,
  others `enabled:true`.
- **AC-003:** request `body` maps by mode: `raw` -> json slot verbatim (default mode); `urlencoded` ->
  `bodyMode:"form"` + rows; `formdata` -> `bodyMode:"multipart"` + rows (a `type:"file"` row keeps its
  literal value); `graphql` -> `bodyMode:"graphql"` + query/variables; `file`/absent/`null` -> no body.
- **AC-004:** request `auth` maps: `bearer` -> `{active:"bearer",token}`; `basic` ->
  `{active:"basic",username,password}`; `noauth` -> `{active:"none"}`; an unsupported type
  (`apikey`/`oauth2`/...) -> no auth set (request inherits).
- **AC-005:** `url.query` -> `params.query` rows (`disabled:true` -> `enabled:false`), dropping a key
  already present in `url.raw`'s `?query` (no duplicate); `url.variable` -> `params.path` rows.
- **AC-006:** `event` scripts map: `listen:"prerequest"` -> `scripts.pre`, `listen:"test"` ->
  `scripts.post`; a `script.exec` array is joined with `\n`, a string `exec` is kept verbatim.
- **AC-007:** parsing is lenient/total: invalid JSON or a doc without `info`+`item` yields `null` (from
  `parsePostmanCollection`) / is ignored (in `postmanToTree`); unknown fields are skipped and nothing
  throws.
- **AC-008:** `postmanToTree` builds the nested tree from the collection JSON: an item with a nested
  `item` array -> `FolderNode` (named; config from its `variable`/`auth`/`event`), an item with `request`
  -> `RequestNode`, all wrapped in one root folder named from `info.name` (fallback = provided name);
  collection-level `variable`/`auth`/`event` land on the root folder's config.
- **AC-009:** `postmanToTree` folds a `*.postman_environment.json` (or `{name,values}`-shaped file) into
  the root folder's `config.environments.<name>` (`values` -> variable rows, `enabled:false` kept), and
  `collectDotenv` captures the collection `.env` for the workspace merge.
- **AC-010:** `importPostman(files, name)` inserts the parsed collection as a new top-level folder,
  selects + expands it, persists via `onTreeChange`, and merges any collection `.env` into the workspace
  `.env`; an empty collection (no requests and no child folders) adds nothing and does not persist.
- **AC-011:** `import-postman` is registered in the shortcut registry (palette entry + default hotkey
  `Mod+Shift+P`) and, when run, invokes the reader and imports a picked collection (no-op when the picker
  returns null).
- **AC-012:** the QuickJS runner aliases `pm.*`: `pm.variables`/`pm.environment`/`pm.collectionVariables`/
  `pm.globals` `.get`/`.set` map onto the host `purerequest.getVar`/`setVar`; in the post stage
  `pm.response.code`/`.json()`/`.text()`/`.headers.get()` map onto `res.*`; `pm.test(name, fn)` runs `fn`
  without a thrown assertion aborting the script.

## 7. Test cases

- **TC-001** (happy request, AC-001/002/004): a GET request item with `method`, `url.raw`, a `header`
  block (incl. a `disabled:true` header), `auth:bearer` -> method GET, url, header rows (one disabled),
  bearer auth.
- **TC-002** (body, AC-003): `raw` body -> json slot verbatim; `urlencoded` -> `form` + rows; `formdata`
  -> `multipart` + rows (a `file` part kept as literal text); `graphql` -> `graphql` query + variables;
  no `body` -> none.
- **TC-003** (auth, AC-004): `basic` -> basic auth; `noauth` -> `{active:"none"}`; `apikey` -> no auth.
- **TC-004** (params, AC-005): `url.query` with a `disabled` row + a key already in `url.raw` -> params
  rows (disabled kept, dup dropped); `url.variable` -> path rows.
- **TC-005** (scripts, AC-006): a `prerequest` event `exec` array + a `test` event `exec` string ->
  `scripts.pre` (joined) / `scripts.post` (verbatim).
- **TC-006** (lenient, AC-007): garbage JSON -> `null`; a `{}` doc -> `null`; a collection with an
  unknown top-level field parses (field skipped) without throwing.
- **TC-007** (tree, AC-008): a collection with a folder item (nested `item`) containing a request item ->
  root folder -> child folder (named) -> request; collection `variable`/`auth` on the root config.
- **TC-008** (environments + dotenv, AC-009): a `*.postman_environment.json` in the file map ->
  root `config.environments.<name>` rows; a `.env` in the map is captured by `collectDotenv`.
- **TC-009** (integration, AC-010/011): the palette lists `Import Postman collection`; running it with a
  fake reader that returns a collection inserts a new top-level folder (visible in the tree) and persists
  via `onTreeChange`; a reader returning null inserts nothing; an empty collection inserts nothing.
- **TC-010** (pm alias, AC-012): a script `pm.variables.set('a', pm.variables.get('b'))` calls host
  setVar with the resolved value; a post-stage `pm.test('x', () => { pm.response.json(); })` runs without
  throwing; a `pm.test` whose `fn` throws does not fail the script.

## 8. Edge cases

- **Picker cancelled / reader error:** reader returns `null` -> no-op (no folder, no persist, no toast).
- **No collection file in the picked dir:** `postmanToTree` returns `[]` -> `importPostman` no-op.
- **Empty collection** (`info` + empty `item`): the root folder is empty; AC-010 says an import with no
  requests AND no child folders adds nothing (avoids a stray empty folder).
- **`url` as an object without `raw`** (host/path arrays only): reconstruct the url from
  `protocol://host/path?query` best-effort, else `""` (lenient).
- **`disabled` rows** in header/query/urlencoded/formdata -> `enabled:false` (kept, excluded from send).
- **Query duplicated in `url.raw` and `url.query`:** the url wins; the matching `url.query` row is dropped
  (mirrors the OpenCollection importer's `urlQueryKeys` rule).
- **`formdata` `type:"file"`:** value kept as literal text (no file part) - documented limitation.
- **Auth key casing / missing keys** (`bearer` array without a `token` key): treated as empty string.
- **Several collection files in one dir:** first path-sorted collection wins; others ignored (documented).
- **No native host (dev browser):** noop reader -> the action does nothing (no picker dialog exists).
- **No workspace open (empty state):** import inserts in-memory; with no `onTreeChange` it isn't written
  to disk (identical to Bruno/cURL import). Documented.

## 9. Dependencies

- Reuses the Bruno import threading pattern (loader -> layout -> main) for the new `PostmanCollectionReader`
  port; `insertNode` + `persistTree`/`onTreeChange`; `collectDotenv` + `mergeDotenv`; `KeyValue`/`Auth`/
  `HttpMethod`/`BodyMode`/`ConfigScope`/`ScriptConfig`/`Environment`/`TreeNode` model types + `authOf`;
  the `@tauri-apps/plugin-dialog` `open` + `@tauri-apps/plugin-fs` `readDir`/`readTextFile` (already used
  by the Bruno reader); the shortcut registry + command palette; `useToast`. **No new npm dependency**
  (Postman collections are plain JSON - `JSON.parse`, no `yaml`). **No Rust change** (read is plugin-fs
  from the frontend; capabilities already grant `fs:read-dir`/`fs:read-text-file`). No on-disk format
  version bump (import produces ordinary nodes serialized by the existing `serialize`).
