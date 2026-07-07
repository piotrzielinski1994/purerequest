# Plan: Request model restructure

## Domain-modeling gate

- `pz-ddd`: evaluated. Touches the `RequestNode` aggregate's internal shape
  (value-object reshaping of body/params) but introduces no new bounded context,
  consistency boundary, or cross-module workflow. Not invoked - pure tactical
  reshape of one existing aggregate.
- `pz-archetypes`: evaluated. No accounting/inventory/ordering/pricing/party/
  product/quantity/rules/plan-vs-execution/graph shape. Not invoked.
- Verdict: neither invoked; this is an internal model refactor of one aggregate.

## Approach

Single coordinated rename/reshape across the model and every consumer. No
back-compat kept in the *in-memory* type (one shape everywhere); back-compat
lives only at the disk-read boundary (`disk-format` + bruno import map legacy ->
new). This mirrors how `bodyMode`/`pathParams` were already tolerated on read.

Key decisions:
- `body.types.json` stays a raw string (the editor's native form); only the disk
  layer tags it as `StoredBody` via the existing `bodyToStored`/`storedToBody`.
- `body.types` holds `json|form|multipart` only - `none` carries no payload.
- `params.query` stays `KeyValue[]` (enabled/order/dups -> URL sync intact);
  `params.path` stays `Record<string,string>`.
- Minimal-diff disk writes: omit empty json text, empty form/multipart arrays,
  empty path object, empty query array, and omit `body`/`params` entirely when
  fully default.

## File changes

Core model + logic (Rust untouched - body is a string on the wire):
- `src/lib/workspace/model.ts` - add `RequestBody`, `RequestParams`; reshape
  `RequestNode`; drop `params` from `ConfigScope`.
- `src/lib/workspace/body-codec.ts` - keep `StoredBody` + json<->stored; (no
  shape change, reused by disk layer).
- `src/lib/http/body-encode.ts` - `encodeBody(body: RequestBody, subst)`.
- `src/lib/http/build-request.ts` - read `node.body`/`node.params.path`/
  `node.params.query`; drop `effective.params`.
- `src/lib/workspace/resolve.ts` - remove `params` from `EffectiveConfig` +
  `resolveConfig` (no folder query inheritance).
- `src/lib/workspace/disk-format.ts` - serialize new shape (minimal-diff);
  deserialize with tolerant legacy mapping; bump `schemaVersion` 3 -> 4.
- `src/lib/workspace/update-request.ts` - `RequestPatch` field set
  (`body`/`params` instead of `body`/`bodyMode`/`bodyForm`).
- `src/lib/config-schema/zod-schemas.ts` - `body`/`params` schemas; drop
  `params` from `configScopeSchema`; `requestSettingsSchema` new shape.
- `src/lib/config-schema/json-schemas.ts` - no code change (regenerates).

Scripts:
- `src/lib/scripts/script-context.ts` - `reqDraft.body` still the json text
  (`req.getBody/setBody`). `ReqDraft` unchanged in shape.

Bruno / curl import:
- `src/lib/bruno/bruno-to-tree.ts` - build new `body`/`params`; stop writing
  `config.params`.
- `src/lib/bruno/parse-bru.ts` / `parse-opencollection.ts` - parsing output is
  internal to bruno; map at the `bruno-to-tree` boundary (keep parsers as-is,
  adapt the node builder).

UI:
- `src/components/workspace/workspace-context.tsx` - `RequestOverride` field
  set; setters (`setRequestBody` -> json text, `setRequestBodyMode` ->
  `body.active`, `setRequestForm` -> active type rows, `setRequestPathParams` ->
  `params.path`, `setRequestQueryParams` -> `params.query`); query/path sync
  patches read new fields; `createRequestNode`/`newRequest`/`importCurl`
  defaults; `sendRequest` reqDraft seeding from `body.types.json`.
- `src/components/workspace/body-panel.tsx` - bind to `body.active`/`body.types`.
- `src/components/workspace/path-params-panel.tsx` - read `params.path`.
- `src/components/workspace/request-pane.tsx` - Query sub-tab reads
  `params.query`; ParamsPanel no longer goes through `config.params`.
- `src/components/workspace/config-panels.tsx` - `ParamsPanel` reworked to take
  `query: KeyValue[]` (request) rather than `config.params`; folder Params tab
  removed (folder-pane).
- `src/components/workspace/folder-pane.tsx` - drop the Params tab.
- `src/components/workspace/config-editor.tsx` - request-settings parse/serialize
  new shape.
- `src/lib/workspace/demo-seed.ts` - reshape seeded requests.

## Execution order (TDD)

1. RED: spawn test-writer for AC-001..011 against task spec (model/encode/
   build/disk/resolve/bruno + UI panels).
2. GREEN: model.ts first (compile breaks everywhere = the work list), then
   bottom-up: body-codec/body-encode/build-request/resolve, disk-format
   (serialize+migrate), zod, bruno-to-tree, then workspace-context + panels,
   demo-seed.
3. REFACTOR: collapse duplicated default-body constructors into one helper if it
   appears 2+ times.
4. VERIFY: fresh verifier subagent; run `npm test` + `tsc` + lint.

## Acceptance verification

- `npm test` green (Vitest) incl. new AC tests.
- `npx tsc --noEmit` clean (no `any`, no orphan references to removed fields).
- Manual: `npm start`, switch body modes, edit path/query, send a request, check
  console `req.getUrl()/getBody()`.

## Status: COMPLETE

Gates (fresh run): `tsc --noEmit` exit 0; `eslint .` 0 errors (9 pre-existing
react-refresh warnings); `vitest run` 175 files / 1453 tests pass.

### AC -> test traceability

| AC | Test |
| -- | ---- |
| AC-001 body `{active,types}` | `zod-schemas.test.ts` drift guard; `build-request-body-modes.test.ts` |
| AC-002 params `{path,query}`, no `pathParams`/`config.params` | `model.ts` + `zod-schemas.test.ts` (configScope has no params) |
| AC-003 mode switch preserves payloads | `body-mode-context.test.tsx` "should preserve form rows across form<->multipart and the JSON text across json switches" |
| AC-004 encode from active+type; none = no body | `build-request-body-modes.test.ts` (json/none/form/multipart + bodyless GET/DELETE) |
| AC-005 query dedup + path apply | `build-request-query-dedup.test.ts`; `build-request-path-params.test.ts` |
| AC-006 folder no longer contributes query | `disk-format-legacy-migration.test.ts` "should drop a legacy folder config.params and not inherit it onto a descendant" |
| AC-007 disk new shape, minimal-diff, v4 | `disk-format-body-modes.test.ts`; `disk-format-path-params.test.ts`; `disk-format.test.ts` (schemaVersion 4) |
| AC-008 legacy v3 tolerant read | `disk-format-legacy-migration.test.ts` (bodyMode/bodyForm slots, config.params->query, full combined doc); `disk-format-path-params.test.ts` (pathParams) |
| AC-009 Settings JSON + schema | `request-settings-tab.test.tsx`; `zod-schemas.test.ts` |
| AC-010 Bruno import maps query/body | `parse-bru.test.ts`; `parse-opencollection.test.ts` |
| AC-011 Body/Path/Query panels + URL sync | `body-mode-context.test.tsx`; `path-params-panel.test.tsx`; `query-sync-panel.test.tsx` |

### Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-07 | Domain gate: neither pz-ddd nor pz-archetypes invoked | Internal value-object reshape of one existing aggregate; no new context/boundary or recurring domain shape |
| 2026-07-07 | `params.query` stays `KeyValue[]`, not a Record | Record would drop enabled-toggle, order, duplicate keys that the URL<->Query sync (ae96a86) needs |
| 2026-07-07 | Drop folder query inheritance; body/params leave `config` | User: query/body are "part of the request", not inherited; path was always request-only |
| 2026-07-07 | `body.types` mirrors the existing 4 modes (no new raw `text`) | User choice; keeps scope tight |
| 2026-07-07 | Tolerant legacy read + schemaVersion 3->4 | User choice; existing workspaces keep loading |
| 2026-07-07 | Bug fixed post-verify: folder `config.params` not dropped on load | Verifier gap surfaced it; `buildLevel` folder branch bypassed `configWithoutParams` |
