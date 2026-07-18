# Spec: Import Bruno collection

**Version:** 0.1.0
**Created:** 2026-06-25
**Status:** Approved (user pre-approved spec + plan)

## 1. Overview

purerequest already imports a single request from a cURL string. This feature adds importing a whole
**Bruno collection** - a folder tree of `.bru` files (Bruno's plain-text markup) - into the current
workspace as a **new top-level folder**. Additive, like cURL import: it never replaces or clobbers
the open workspace; the imported subtree persists through the existing `onTreeChange` write path.

Bruno is the file-based API client purerequest mirrors (Bruno-style variables, `{{var}}` interpolation,
`folder.bru`-style per-folder config, environments). So the on-disk shapes map cleanly.

### Scope

- **In:** an `Import Bruno collection` action (command palette + default hotkey) that opens a native
  folder picker, reads a Bruno collection directory in **either on-disk format** - the legacy `.bru`
  markup (`.bru` files + `bruno.json` + `environments/*.bru`) **or** the newer **OpenCollection YAML**
  (`*.yml` request files + `opencollection.yml`/`folder.yml` + `environments/*.yml`) - parses it into a
  purerequest `TreeNode[]` subtree, inserts it as one new top-level folder, opens/selects it, and persists.
  Three pure modules do the work: a `.bru` parser, an OpenCollection-YAML parser (both yielding the same
  `ParsedBru` shape), and a file-map -> tree mapper that dispatches per file extension.

  **Why both:** real-world Bruno exports (the user's AS24/Postman-converted collections) are
  OpenCollection YAML, not `.bru` - 487 `.yml`, zero `.bru`. The two formats are alternative
  serializations of the same model, so the importer must read either.
- **Out:** export TO Bruno (deferred); GraphQL body, file-upload multipart parts (deferred, like cURL
  import's `-F`); OpenAPI/Postman/HAR import (still deferred); merging into / overwriting an existing
  folder (we always create a new sibling folder); encrypted secrets / `.bru` secret vars; running Bruno
  `tests`/`assert`/`docs` blocks (parsed-then-skipped, never fatal).

### Decisions captured (recommended defaults, no clarifying questions per directive)

- **Surface = folder picker, not a paste dialog.** A collection is a directory, so it reuses the
  `FolderPicker`/open-workspace pattern, not cURL's textarea dialog. A new `BrunoCollectionReader` port
  (pick + read `.bru` files) is threaded loader -> layout -> main exactly like `FolderPicker`.
- **Import target = a new top-level folder** named from `bruno.json` (`name`) - or the picked dir name -
  inserted at workspace root, persisted via the existing `onTreeChange`/`persistTree` path. Mirrors
  cURL import's "create a new node, never touch the active request" rule, scaled to a subtree.
- **Environments fold into config.** purerequest stores environments inside node `config.environments`
  (ADR 2026-06-20), not in `environments/*` files, so Bruno `environments/<name>.bru` `vars` blocks
  map onto the imported root folder's `config.environments.<name>`.
- **Lenient parse, like the cURL importer.** Unknown/unsupported blocks (`tests`, `assert`, `docs`,
  `body:graphql`, file `@file` multipart values) are skipped, never fatal. A malformed `.bru` yields a
  best-effort node rather than aborting the whole import.

## 2. Data model

No new persisted fields. Import produces ordinary `FolderNode`/`RequestNode`s. Internal (not persisted):

```ts
type BrunoFileMap = Record<string, string>; // collection-relative path -> file text

type ParsedBru = {
  name?: string; // meta.name
  method?: HttpMethod; // from the get/post/... block name
  url?: string; // method block `url`
  headers: KeyValue[]; // headers block (~ -> enabled:false)
  params: KeyValue[]; // params:query block
  bodyMode?: BodyMode; // json (default) | form | multipart  (none when no body)
  body: string; // json/text/xml body verbatim (json slot sends it as-is)
  bodyForm: KeyValue[]; // form-urlencoded / multipart rows
  auth?: Auth; // bearer{token} | basic{user,pass} | none | inherit
  variables: Record<string, string>; // vars / vars:pre-request
  scripts?: ScriptConfig; // script:pre-request -> pre, script:post-response -> post
  environments: Record<string, Record<string, string>>; // only set for environment files
};
```

`parseBru(text): ParsedBru` is total (never throws). `brunoToTree(files, fallbackName): TreeNode[]`
returns the single imported root folder (wrapped in an array for the insert path).

## 3. Bru-lang parsing (`parseBru`)

Bru is a block language: `blockname { ... }` and `blockname:subtype { ... }`, brace-delimited.

- **Dictionary blocks** (`key: value` lines, `~key` = disabled): `meta`, the method block
  (`get`/`post`/`put`/`patch`/`delete` - carries `url`, `body`, `auth` selectors), `headers`,
  `params:query`, `params:path`, `auth:bearer`, `auth:basic`, `vars`, `vars:pre-request`.
- **Text blocks** (raw inner text, dedented): `body`/`body:json`/`body:text`/`body:xml`,
  `script:pre-request`, `script:post-response`, `tests`, `docs`.

Mapping a request `.bru` -> `ParsedBru`:

| Bru source                          | ParsedBru                                                  |
| ----------------------------------- | ---------------------------------------------------------- |
| `meta { name: X }`                  | `name = X`                                                 |
| `get { url: U, body: json, auth: bearer }` | `method = GET`, `url = U`, body/auth selectors          |
| `headers { K: V, ~D: V }`           | `headers = [{K,V,enabled:true},{D,V,enabled:false}]`       |
| `params:query { K: V }`             | `params = [{K,V,enabled:true}]`                            |
| `body:json {..}` / `body {..}`      | `body = <inner>`, `bodyMode = json` (default, omitted)     |
| `body:text {..}` / `body:xml {..}`  | `body = <inner>`, `bodyMode = json` (json slot sends verbatim) |
| `body:form-urlencoded { K: V }`     | `bodyMode = form`, `bodyForm = rows`                       |
| `body:multipart-form { K: V }`      | `bodyMode = multipart`, `bodyForm = rows`                  |
| `auth:bearer { token: T }`          | `auth = { type:"bearer", token:T }`                        |
| `auth:basic { username, password }` | `auth = { type:"basic", username, password }`              |
| method block `auth: none`/`inherit` | `auth = { type:"none" }` / `{ type:"inherit" }` (when no creds block) |
| `vars { K: V }` / `vars:pre-request`| `variables = { K: V }`                                     |
| `script:pre-request {..}`           | `scripts.pre = <inner>`                                    |
| `script:post-response {..}`         | `scripts.post = <inner>`                                   |
| `tests`/`assert`/`docs`/`body:graphql` | skipped                                                |

Active-body selection: the method block's `body: <type>` names which body block is the real one; if
absent, take the single present body block. `none` -> no body.

## 3b. OpenCollection YAML parsing (`parseOpenCollection`)

`parseOpenCollection(text): ParsedBru` parses a YAML request/folder file into the **same `ParsedBru`
shape** as `parseBru`, so the mapper is format-agnostic. YAML parsed via the `yaml` dep (no hand-roll).

| YAML source                                              | ParsedBru                                              |
| -------------------------------------------------------- | ------------------------------------------------------ |
| `info: { name }`                                         | `name`                                                 |
| `http: { method, url }`                                  | `method` (upper-cased), `url`                           |
| `http.headers: [{ name, value, disabled }]`              | `headers` (`disabled:true` -> `enabled:false`)         |
| `http.params: [{ name, value, type: query }]`            | `params` (only `type: query`/absent; `path` skipped; a key already in the url's `?query` string is dropped - Bruno mirrors query in both, the url wins, else it'd duplicate) |
| `http.body: { type, data }`                              | `type:json/text/xml` -> `body` verbatim; `form-urlencoded`/`multipart-form` -> `bodyMode` + rows from `data:[{name,value,disabled}]` |
| `http.auth: "inherit"`/`"none"`                          | `{type:"inherit"}` / `{type:"none"}`                   |
| `http.auth: { type: bearer, token }`                     | `{type:"bearer", token}`                               |
| `http.auth: { type: basic, username, password }`         | `{type:"basic", username, password}`                   |
| `request.variables: [{ name, value }]` (folder/collection) | `variables`                                          |
| `request.scripts` / `runtime.scripts: [{type, code}]`    | `before-request`/`pre-request` -> `scripts.pre`; `after-response`/`post-response` -> `scripts.post`; `tests` skipped |
| environment file `variables: [{ name, value }]`          | `variables` (folded by the mapper into `environments`) |

Folder/collection files (`folder.yml`, `opencollection.yml`) carry config under a top-level
`request:` block (`request.variables`, `request.scripts`, `request.auth`) + `info.name`; the mapper
reads those the same way it reads `folder.bru`.

## 4. File-map -> tree (`brunoToTree`)

Input = `BrunoFileMap` (collection-relative path -> text), built by the reader. Mirrors `deserialize`,
**dispatching the per-file parser by extension** (`.bru` -> `parseBru`, `.yml`/`.yaml` ->
`parseOpenCollection`):

- Each directory becomes a `FolderNode`; its `folder.bru`/`folder.yml` (if present) supplies `name` +
  config (headers/auth/vars/scripts). A dir with no folder file keeps the directory name. A **nested
  `opencollection.yml`** (the Postman-converted repos nest sub-collections) is treated like a
  `folder.yml` config carrier for that dir, not a request.
- Each request file (`*.bru`/`*.yml`/`*.yaml`) that is **not** a folder/collection config file
  (`folder.bru`/`folder.yml`/`collection.bru`/`opencollection.yml`/`bruno.json`) and **not** under
  `environments/` becomes a `RequestNode`.
- `bruno.json` (`name`) or root `opencollection.yml` (`info.name`) -> the root folder's name; fallback
  = the picked directory's base name.
- `collection.bru` / root `opencollection.yml` -> root folder config.
- `environments/*.{bru,yml,yaml}` -> `config.environments.<fileBaseName> = { vars }` on the **root**
  folder (YAML env files use `variables: [{name,value}]`, `.bru` use a `vars` block).
- the collection root `.env` (the reader captures it) -> **merged into the workspace `.env`** by
  `importBruno` via `mergeDotenv` (imported keys win on a clash), so `{{process.env.X}}` tokens the
  collection references actually resolve. This is a side effect of import, not part of the subtree.
- Everything is wrapped in **one** root `FolderNode` so the import is a single insertable subtree.
- Node ids are synthetic (`bruno-<n>`); the next disk reload regenerates path-based ids (same accepted
  convention as cURL import / new-request `new-<n>` ids).

## 5. Reader port + UI

- `BrunoCollectionReader = { pick: () => Promise<{ name: string; files: BrunoFileMap } | null> }`.
  - `createTauriBrunoReader()` - `open({directory:true})` then recursively read `*.bru`/`*.yml`/
    `*.yaml`/`bruno.json` under the chosen dir; returns `null` on cancel/error. `name` = the dir base
    name (the mapper derives the real name from `bruno.json`/`opencollection.yml`).
  - `createNoopBrunoReader()` - returns `null` (dev-browser / no native host).
- **Action** `import-bruno` (palette + default hotkey `Mod+Shift+B`). Handler in `Main`:
  `reader.pick().then(picked => picked && importBruno(picked.files, picked.name))`.
- **Context** `importBruno(files, name)` - `brunoToTree(files, name)` -> insert the root folder at
  workspace root via the existing insert/expand/select/persist sequence, open nothing extra (a folder
  has no tab; select + expand it), toast "Imported Bruno collection".
- No new dialog component; the picker is the only UI surface (like open-workspace).

### UI States

| State                | Behavior                                                                 |
| -------------------- | ------------------------------------------------------------------------ |
| Picker cancelled     | No-op: no tree change, no toast.                                          |
| Empty / unreadable   | Reader returns null (or empty files) -> no-op, no folder added.          |
| Valid collection     | A new top-level folder appears (named from `bruno.json`), selected + expanded; tree persisted; toast. |
| Dev browser          | Noop reader -> action is a silent no-op (no native picker).              |

## 6. Acceptance criteria

- **AC-001:** `parseBru` extracts the method (from the `get`/`post`/`put`/`patch`/`delete` block name,
  upper-cased) and the `url` field from that block.
- **AC-002:** `parseBru` extracts `headers` rows, mapping a `~`-prefixed key to `enabled:false` and a
  plain key to `enabled:true`.
- **AC-003:** `parseBru` extracts the body: a `body`/`body:json`/`body:text`/`body:xml` block -> the
  `body` string (json slot, verbatim, default mode); `body:form-urlencoded` -> `bodyMode:"form"` + rows;
  `body:multipart-form` -> `bodyMode:"multipart"` + rows; no body block -> empty body.
- **AC-004:** `parseBru` extracts auth: `auth:bearer { token }` -> `{type:"bearer",token}`;
  `auth:basic { username, password }` -> `{type:"basic",...}`; a method block `auth: none`/`inherit`
  with no creds block -> `{type:"none"}` / `{type:"inherit"}`.
- **AC-005:** `parseBru` extracts `params:query` -> `params` rows, `vars`/`vars:pre-request` ->
  `variables`, and `script:pre-request`/`script:post-response` -> `scripts.pre`/`scripts.post`.
- **AC-006:** `parseBru` is lenient: unknown blocks (`tests`, `assert`, `docs`, `body:graphql`) are
  skipped and a malformed/garbage input yields a best-effort `ParsedBru` without throwing.
- **AC-007:** `brunoToTree` builds the folder tree from a `BrunoFileMap`: directories -> folders
  (named from `folder.bru` `meta.name` or the dir name, config from `folder.bru`), `*.bru` files ->
  request nodes, all wrapped in a single root folder.
- **AC-008:** `brunoToTree` names the root folder from `bruno.json` (`name`), falling back to the
  provided name; `environments/<env>.bru` `vars` map to the root folder's
  `config.environments.<env>`.
- **AC-009:** `importBruno(files, name)` inserts the parsed collection as a new top-level folder,
  selects + expands it, and persists via `onTreeChange`; an empty/whitespace collection (no requests
  or folders) adds nothing and does not persist.
- **AC-010:** `import-bruno` is registered in the shortcut registry (palette entry + default hotkey)
  and, when run, invokes the reader and imports a picked collection (and is a no-op when the picker
  returns null).
- **AC-011:** `parseOpenCollection` parses an OpenCollection YAML request file into a `ParsedBru`:
  `info.name` -> name; `http.method`/`http.url` -> method (upper)/url; `http.headers`
  (`disabled:true` -> `enabled:false`) -> headers; `http.params` (`type: query`) -> params;
  `http.body {type,data}` -> json/text verbatim or `form-urlencoded`/`multipart-form` mode + rows;
  `http.auth` string (`inherit`/`none`) or object (`bearer`/`basic`) -> auth.
- **AC-012:** `brunoToTree` dispatches per file extension: a `BrunoFileMap` of `*.yml` files
  (`opencollection.yml` root, nested `folder.yml` dirs, request `*.yml`, `environments/*.yml`) builds
  the same folder/request/environment tree as the `.bru` path, named from `opencollection.yml`
  `info.name`, with `request.variables` from folder/collection files in their folder config.

## 7. Test cases

- **TC-001** (happy, AC-001/002/003/004): a GET `.bru` with `meta`, a method block + url, a `headers`
  block (incl. a `~disabled` header), `auth:bearer { token }` -> method GET, url, header rows
  (one disabled), bearer auth.
- **TC-002** (body, AC-003): a `body:json` POST parses to the json body verbatim (default mode); a
  `body:form-urlencoded` -> `bodyMode:"form"` + rows; a `body:multipart-form` -> `bodyMode:"multipart"`.
- **TC-003** (auth, AC-004): `auth:basic { username, password }` -> basic auth; a method block
  `auth: none` with no block -> `{type:"none"}`.
- **TC-004** (vars/params/scripts, AC-005): `params:query`, `vars`, and `script:pre-request`/
  `script:post-response` blocks land in `params`, `variables`, `scripts.pre`/`scripts.post`.
- **TC-005** (lenient, AC-006): a `.bru` with a `tests`/`docs`/`assert` block parses (those skipped),
  and a garbage string returns a `ParsedBru` (no throw).
- **TC-006** (tree, AC-007): a `BrunoFileMap` with a nested dir (`users/get-user.bru` + `users/folder.bru`)
  builds a root folder containing a `users` folder (named from its `folder.bru`) containing the request.
- **TC-007** (collection + env, AC-008): `bruno.json {name}` names the root folder; an
  `environments/local.bru` `vars { baseUrl }` -> root `config.environments.local.baseUrl`.
- **TC-008** (integration, AC-009/010): the palette lists `Import Bruno collection`; running it with a
  fake reader that returns a collection inserts a new top-level folder (visible in the tree) and
  persists via `onTreeChange`; a reader returning null inserts nothing.

## 8. Edge cases

- **Picker cancelled / reader error:** reader returns `null` -> no-op (no folder, no persist, no toast).
- **Empty collection** (only `bruno.json`, no requests/folders): the root folder is empty; AC-009 says
  an import with no requests AND no child folders adds nothing (avoids a stray empty folder).
- **`.bru` with no method block** (folder.bru-shaped file at request position): treated as a folder
  config carrier where applicable, else a request defaulting to method GET, url "" (lenient).
- **Disabled rows (`~key`)** in headers/params/form -> `enabled:false` (kept, excluded from send, same
  as purerequest's own disabled rows).
- **Body type ambiguity** (multiple body blocks, no `body:` selector): pick the method block's declared
  type; if none declared, the first present body block wins.
- **`@file` multipart values / `body:graphql`:** skipped (no file parts) - a value beginning with `@`
  is kept as a literal text value (documented limitation, not a crash), graphql body dropped.
- **No native host (dev browser):** noop reader -> the action does nothing (no picker dialog exists).
- **No workspace open (empty state):** import inserts in-memory; with no `onTreeChange` it isn't
  written to disk (identical to cURL import / new-request in the empty state). Documented.

## 9. Dependencies

- Reuses `FolderPicker` threading pattern (loader -> layout -> main) for the new `BrunoCollectionReader`
  port; `insertNode` + `persistTree`/`onTreeChange`; `KeyValue`/`Auth`/`HttpMethod`/`BodyMode`/
  `ConfigScope`/`ScriptConfig`/`TreeNode` model types; the `@tauri-apps/plugin-dialog` `open` +
  `@tauri-apps/plugin-fs` `readDir`/`readTextFile` already used by `tauri-fs`/`folder-picker`; the
  shortcut registry + command palette; `useToast` (`showToastRef`). No new npm dependency. **No Rust
  change** (read is pure plugin-fs from the frontend; capabilities already grant `fs:read-dir`/
  `fs:read-text-file` under `$HOME/**`). No on-disk format version bump (import produces ordinary nodes
  serialized by the existing `serialize`).
</content>
</invoke>
