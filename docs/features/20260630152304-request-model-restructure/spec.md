# Request model restructure: unified `body` + `params`

## Overview

Today a `RequestNode` spreads body/param state across five sibling fields:
`body: string`, `bodyMode?`, `bodyForm?`, `pathParams?`, and `config.params`
(query grid, inherited down the folder chain). Switching body mode in the UI
keeps the old payload only incidentally, query lives in `config` while path
lives in its own request-only record, and the two param kinds are modelled in
two unrelated ways.

This feature collapses that into two cohesive request-node fields:

```ts
body: {
  active: "json" | "none" | "form" | "multipart";
  types: {
    json: string;        // raw editor text (StoredBody on disk)
    form: KeyValue[];
    multipart: KeyValue[];
  };
};
params: {
  path: Record<string, string>;   // request-only `:name` -> value
  query: KeyValue[];               // the Query grid (enabled/order/dups kept)
};
```

`config.params` and folder-level query inheritance are removed. Path params are
inherently request-specific (URL `:name`-driven) and query is now request-only
too, so neither is inherited.

## Why

- One `body` object holds every type side-by-side, so switching mode never
  discards the other payloads (a real bug today for json<->form).
- `params` co-locates the two param kinds under one field with a clear
  `path`/`query` split, matching the Params tab's Path/Query sub-tabs.
- Removes the conceptual split where query sat in inherited `config` but path
  sat request-only - both are now plainly request-owned.

## Acceptance criteria

- AC-001: `RequestNode.body` is `{ active, types: { json, form, multipart } }`;
  `bodyMode`/`bodyForm`/the old `body: string` no longer exist on the node.
- AC-002: `RequestNode.params` is `{ path: Record<string,string>, query: KeyValue[] }`;
  `pathParams` and `ConfigScope.params` no longer exist.
- AC-003: Switching `body.active` between modes preserves every other type's
  payload (json text, form rows, multipart rows all survive a round-trip of
  mode switches).
- AC-004: `buildHttpRequest` encodes the body from `body.active` + the matching
  `body.types` payload, sets the canonical Content-Type, and `none` sends no body
  (bodyless methods GET/DELETE still send no body, unchanged).
- AC-005: `buildHttpRequest` appends the request's own enabled `params.query`
  rows to the URL, skipping any key already present in the URL's literal query
  (the existing dedup rule), and applies `params.path` to `:name` tokens.
- AC-006: Folder/collection `config` no longer contributes query params; an
  ancestor folder's params do NOT appear on a descendant request.
- AC-007: On-disk `*.req.json` writes the new shape: `body: { active, types }`
  (json payload as tagged `StoredBody`), `params: { path, query }`. Empty
  sub-payloads (empty json text, empty form/multipart rows, empty path/query)
  are omitted for a minimal diff. `schemaVersion` is bumped 3 -> 4.
- AC-008: Legacy on-disk requests still load (tolerant read): old `body`
  (string or `StoredBody`) + `bodyMode` + `bodyForm` map to the new `body`
  object; old `config.params` -> `params.query`; old `pathParams` ->
  `params.path`. Legacy folder `config.params` is dropped.
- AC-009: The request-settings JSON editor (Settings sub-tab) shows and parses
  the new shape; the generated IntelliSense schema (`requestSettingsSchema`)
  matches the new model and `configScopeSchema` no longer lists `params`.
- AC-010: Bruno/OpenCollection import maps parsed query params into
  `params.query`, parsed body/mode/form into the new `body` object, and no
  longer writes `config.params`.
- AC-011: The Body panel reads/writes `body.active` + `body.types`; the Path tab
  reads/writes `params.path`; the Query tab reads/writes `params.query` and
  keeps the URL<->Query bidirectional sync intact (enabled toggle, order,
  duplicate keys).

## User test cases

- TC-001 (happy, AC-003): Request in json mode with `{"a":1}`; user adds two
  form rows, switches to form, switches to multipart, adds a row, switches back
  to json -> json text and form rows are exactly as left; multipart has its row.
- TC-002 (happy, AC-004/005): GET `req/:id?x=1` with `params.path.id = 5`,
  `params.query = [{key:"y",value:"2",enabled:true}]` -> wire URL is
  `req/5?x=1&y=2`, no body.
- TC-003 (edge, AC-005 dedup): URL already has `?x=1`; `params.query` also has
  `x=override` enabled -> URL keeps `x=1`, `x` not sent twice.
- TC-004 (edge, AC-006): Folder with legacy `config.params` loaded; descendant
  request's wire URL has no folder param.
- TC-005 (migration, AC-008): Load a 3-era `*.req.json` with `body: "{...}"`,
  `bodyMode: "multipart"`, `bodyForm: [...]`, `config.params: [...]`,
  `pathParams: {...}` -> node has `body.active = "multipart"`,
  `body.types.multipart = [...]`, `body.types.json = "{...}"`,
  `params.query = [...]`, `params.path = {...}`.
- TC-006 (round-trip, AC-007): serialize -> deserialize a new-shape tree is
  identity for body + params.
- TC-007 (edge, AC-004): `active: "none"` -> wire body is null, no Content-Type
  added.

## UI States

| State   | Behavior                                                            |
| ------- | ------------------------------------------------------------------- |
| Body    | Mode select drives `body.active`; json shows editor bound to        |
|         | `types.json`; form/multipart show the grid bound to the active      |
|         | type's rows; `none` shows the no-body hint.                         |
| Params  | Path sub-tab edits `params.path`; Query sub-tab edits `params.query`|
|         | and mirrors the URL `?query` both ways.                            |
| Folder  | No Params tab (folder query removed).                               |

## Data model

In-memory (`src/lib/workspace/model.ts`):

```ts
export type RequestBody = {
  active: BodyMode;
  types: { json: string; form: KeyValue[]; multipart: KeyValue[] };
};
export type RequestParams = { path: Record<string, string>; query: KeyValue[] };
export type RequestNode = {
  kind: "request"; id; name; method; url;
  body: RequestBody;
  params: RequestParams;
  config: ConfigScope;          // ConfigScope no longer has `params`
  response?;
};
```

On-disk (`*.req.json`), minimal-diff:

```jsonc
{
  "name": "...", "method": "GET", "url": "...",
  "body": { "active": "multipart",
            "types": { "json": {"type":"json","payload":{}},
                       "multipart": [ {"key":"a","value":"1"} ] } },
  "params": { "path": { "id": "{{ENV}}" },
              "query": [ {"key":"x","value":"1","enabled":true} ] },
  "config": { ... },
  "order": 0
}
```

## Edge cases

- Empty everything: new request has `body {active:"json", types:{json:"",form:[],multipart:[]}}`,
  `params {path:{}, query:[]}`; disk omits all empty sub-payloads.
- Legacy `bodyForm` was shared by form+multipart; on migration it lands in the
  slot named by the legacy `bodyMode` (form or multipart); the other stays empty.
- Legacy `body` that was a bare scalar/text string -> `types.json` raw text.
- Query<->URL sync continues to operate on `params.query` (KeyValue[]); a Record
  was rejected precisely to keep enabled/order/dups.
- `req.getBody()/setBody()` (script API) keep operating on the json text only
  (preserves today's behavior; form/multipart exposure to scripts stays out of
  scope).

## Dependencies

- No new packages. zod v4 schema generator already in use.
- No purequery prior art (checked `~/projects/private/purequery` - no equivalent model).

## Out of scope

- Exposing form/multipart bodies to the script `req` API.
- A distinct raw `text` body mode (kept to today's 4 modes).
- Migrating folder-level query params anywhere (dropped).
