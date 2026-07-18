# Workspace on-disk format & data model

The durable contract for how a purerequest workspace is stored on disk. This is an
**invariant** - the disk layer, importers/exporters, and migrations all depend
on these shapes. Not derivable by reading a single file, so it lives here.
(Feature behaviour is not documented here - that's derivable from the code and
the per-feature specs under [features/](features/).)

## What a workspace is

A **workspace** is a folder on disk holding the collection tree + config. By
default it lives in a `collection` subfolder of the app data dir (next to
`settings.json`), created on first write - so a fresh install is writable out of
the box. Point the app elsewhere by hand-editing `workspacePath` in that
`settings.json`; it loads on launch (a configured-but-empty or not-yet-created
folder mounts a writable empty workspace, bootstrapped by the first request you
create).

Workspace files (including auth tokens / variable values) are stored
**plaintext** - treat a workspace folder as sensitive and gitignore secrets
accordingly.

## Directory layout (schemaVersion 6)

```
<workspace>/
  purerequest.workspace.json        manifest { schemaVersion, name }
  <folder>/folder.json        { name, <config fields...>, order }
  <folder>/.env               KEY=value (per-folder, gitignored; nearest wins)
  <folder>/<request>.req.json { name, method, url, [httpVersion], body, params, <config fields...>, order }
  .env                        root base KEY=value (gitignored; {{process.env.KEY}})
```

## Config fields (flat, inheritable)

Folders/requests carry inheritable config fields: `variables`, `environments`,
`headers`, `auth`, `scripts`, `timeoutMs`. A request resolves them by inheriting
from its folder chain (child overrides parent); that resolved config is what
Send uses. On disk these sit **flat at the doc's top level** - there is no
`config` wrapper. `body` and `params` live directly on the request
(`request.body`, `request.params`) and are **never inherited**.

Legacy files (a nested `config` object, or the earlier body/param shapes) still
load and migrate to the flat shape on the next save.

Every config grid is a `[{ key, value, enabled? }]` array (variables, headers,
path, query, and each env's vars). A folder's per-env border color folds into
its `environments` entry as `color`; a colored-but-undeclared env is an entry
with empty `variables`.

```jsonc
"variables": [ { "key": "baseUrl", "value": "https://default" } ],
"environments": [
  { "name": "local", "variables": [ { "key": "baseUrl", "value": "http://localhost:3000" } ] },
  { "name": "prod", "color": "#dc262680",
    "variables": [ { "key": "baseUrl", "value": "https://api.example.com" } ] }
]
```

## `body`

```jsonc
{
  "active": "json" | "none" | "form" | "multipart" | "graphql",
  "types": {
    "json": <StoredBody>,
    "form": [rows],
    "multipart": [rows],
    "graphql": { "query": "<raw>", "variables": "<raw>" }
  }
}
```

`active` picks the sent type while every type's payload is kept side-by-side
(switching mode never discards the others). The `json` slot is a tagged
`StoredBody`: `{ "type": "json", "payload": <parsed JSON> }` (real nested JSON,
not an escaped string) or `{ "type": "text", "payload": "<raw>" }`.

## `params`

```jsonc
{ "path": [rows], "query": [rows] }
```

Both are `[{ "key", "value", "enabled"? }]` arrays, like `headers` and
`variables`. Empty body/param slots are omitted for a minimal diff.

## `httpVersion`

A request-local transport-version choice: `"auto"` (negotiate HTTP/1.1 or HTTP/2
over TCP - the default) or `"h3"` (force HTTP/3 over QUIC). Flat on the request
doc like `method`/`url`, and **never inherited**. Written **only when `"h3"`** -
an `"auto"` request omits the key entirely (minimal diff), and an absent key
loads as `"auto"`.

## `order`

The node's position among its siblings (written on a drag-move). Siblings sort
by it on load; legacy v1 files that lack it fall back to folders-first-then-name.

## Migrations

Legacy workspaces still load and migrate to the current shape on the next save:
v2 bare-string body; v3 `body`+`bodyMode`+`bodyForm`, `config.params`,
`pathParams`; pre-array record `variables` / path params; nested `config` object.
v5→v6 adds the optional `httpVersion` field (absent = `"auto"`), so a v5 doc
loads unchanged and re-serializes at v6 with no per-request rewrite needed.

## `.env` namespace

`.env` files (standard `KEY=value`, gitignore them) are a **separate namespace**
referenced as `{{process.env.KEY}}` - a bare `{{KEY}}` does not read `.env`. A
`.env` may live at the workspace root **and in any folder**; a request resolves a
key by folding its folder chain over the root - the **nearest folder** defining
the key wins, the root `.env` is the base fallback (a request outside any folder
resolves only the root `.env`).
