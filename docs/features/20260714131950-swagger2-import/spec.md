# Swagger 2.0 import support

Branch: `20260714131950-swagger2-import`

## Overview

The OpenAPI importer only accepts OpenAPI **3.0/3.1** (`parseOpenapiDocument` version-gates on `openapi: "3.x"`). A **Swagger 2.0** document (`swagger: "2.0"`, e.g. `.pzielinski/carmedia.openapi.json`) is rejected → the import shows "No importable operations in OpenAPI document" and nothing is created.

Add Swagger 2.0 support by **normalizing** a 2.0 document into the same in-memory shape the existing 3.x mapper (`openapi-to-tree.ts`) already reads, so the mapper runs unchanged. The two formats describe the same thing (paths, operations, parameters, tags, security); only a handful of fields moved between 2.0 and 3.0.

## What differs between Swagger 2.0 and OpenAPI 3.x (only the parts the mapper reads)

| Concern | Swagger 2.0 | OpenAPI 3.x (what the mapper reads) |
| --- | --- | --- |
| Version tag | `swagger: "2.0"` | `openapi: "3.x"` |
| Base URL | `schemes: ["https"]` + `host` + `basePath` | `servers: [{ url }]` |
| Request body | a parameter with `in: "body"`, its `schema` (+ top-level `consumes`) | `requestBody.content["application/json"].schema` |
| Body example | `parameters[in:body].schema.example` (or `$ref` schema's) | `requestBody.content[...].schema.example` / media `example` |
| Non-body params | `{ name, in, type, example, default }` (type inline, no `schema` wrapper) | `{ name, in, schema, example }` |
| `$ref` root | `#/definitions/X` | `#/components/schemas/X` |
| Security schemes | `securityDefinitions` | `components.securitySchemes` |
| Global security | `security: [{ name: [] }]` | same shape |

The mapper's `paramValue` already reads a param's own `example`/`default` and (for 3.x) a `schema.example`/`schema.default`; a 2.0 non-body param carries `example`/`default` at the top level, which `paramValue` reads directly — so non-body params need **no** transform beyond being left as-is. Path templating, methods (get/post/put/patch/delete), tags, and header/path/query `in` values are identical in both formats.

## Approach

A pure adapter `normalizeSwagger2(doc: Record<string, unknown>): Record<string, unknown>` in a new `swagger2.ts`, applied in `parseOpenapiDocument` when `swagger: "2.0"` is detected. It rewrites only the moved fields, producing a doc with `openapi: "3.0.0"` that the existing gate accepts and the existing mapper consumes:

1. `openapi: "3.0.0"` (so downstream is version-agnostic); drop `swagger`.
2. `servers: [{ url: "<scheme>://<host><basePath>" }]` from the first `schemes` entry (default `https`) + `host` + `basePath`. Omit `servers` entirely when there is no `host` (relative paths — the mapper already handles `baseUrl === undefined`).
3. For each operation, split its `parameters`: a single `in: "body"` param becomes `requestBody.content["application/json"].schema = <its schema>`; the rest stay as `parameters` (unchanged — `paramValue` reads their top-level `example`/`default`). Path-item-level `parameters` are left as-is (they are never `in: body` in practice; a stray body one is dropped from params and, being path-level, is not promoted).
4. `components.securitySchemes = securityDefinitions`; keep `security` as-is. (The mapper only honors `type: "http"` bearer/basic; a 2.0 `apiKey`/`oauth2`/`basic`-typed scheme yields no auth — same "unsupported → no auth" behavior as 3.x. `basic` in 2.0 is `type: "basic"`, mapped to no auth like any non-http type; acceptable, matches current 3.x scope.)
5. Move `definitions` to `components.schemas` so `#/definitions/...` **and** `#/components/schemas/...` both resolve — 2.0 `$ref`s point at `#/definitions/X`, so **also keep `definitions` in place** (copy, don't move) so `resolveRef` follows the original pointer. (Simplest correct: leave `definitions` untouched and additionally expose `components.schemas`; the body `$ref` still says `#/definitions/X`, which resolves against the retained `definitions`.)

Everything else (paths, tags, info, per-tag grouping, id generation) flows through the untouched 3.x mapper.

## Acceptance criteria

- **AC-001**: `parseOpenapiDocument` accepts a `swagger: "2.0"` document (returns non-null) and still accepts 3.0/3.1 unchanged.
- **AC-002**: A still-invalid doc is still rejected: no version tag, `swagger: "1.0"` / other, non-object, invalid text → null (no throw).
- **AC-003**: Importing a 2.0 doc yields one request per (path, method) for get/post/put/patch/delete, grouped into per-tag folders exactly like 3.x.
- **AC-004**: The base URL is derived from `schemes[0] + host + basePath` into a `{{baseUrl}}` variable on the root, and each request URL is `{{baseUrl}}<path>` with `{id}` → `:id`. A doc with no `host` yields bare relative paths (no `baseUrl`).
- **AC-005**: A 2.0 `in: "body"` parameter whose `schema` (possibly a `#/definitions/X` `$ref`) carries an `example` becomes a JSON body; body params never leak into the path/query/header grids.
- **AC-006**: Non-body params (`in` path/query/header) map to the path/query/header grids with their `example`/`default` seeded as the value, identical to 3.x.
- **AC-007**: The real `.pzielinski/carmedia.openapi.json` imports to a non-empty tree (≥1 request across its 26 paths) with a `{{baseUrl}}` of `https://api.carmedia2p0.com/api/1.0`.
- **AC-008**: 3.x import behavior is unchanged (all existing openapi tests stay green).

## Test cases

- **TC-001** (AC-001/002): `parseOpenapiDocument` on a minimal `{swagger:"2.0", paths:{"/x":{get:{}}}}` → non-null; `swagger:"1.0"` → null; missing version → null; 3.0 doc → still non-null.
- **TC-002** (AC-003): a 2.0 doc with `/x: {get, post}` under `tags:["T"]` → a "T" folder with two requests, methods GET/POST.
- **TC-003** (AC-004): `schemes:["https"], host:"api.x.com", basePath:"/v1"` → root `baseUrl` var `https://api.x.com/v1`; request url `{{baseUrl}}/x`. No `host` → url `/x`, no baseUrl var.
- **TC-004** (AC-005): a POST with `parameters:[{in:"body", schema:{$ref:"#/definitions/D"}}]` + `definitions.D.example={a:1}` → request body active "json" = `{"a":1}` pretty-printed; the body param is NOT in any grid.
- **TC-005** (AC-006): `parameters:[{name:"id",in:"path",type:"string",example:"7"},{name:"q",in:"query",default:"x"}]` → path grid `id=7`, query grid `q=x`.
- **TC-006** (AC-007): `openapiToTree(readFileSync(".pzielinski/carmedia.openapi.json"))` → tree length 1, root folder, ≥1 request, root `variables` has `baseUrl = https://api.carmedia2p0.com/api/1.0`.
- **TC-007** (AC-008): the existing openapi-to-tree + parse-openapi suites remain green.

## Edge cases

- **E-1** No `host` (relative-only 2.0 doc): omit `servers`; mapper produces bare `/path` urls (AC-004 second half).
- **E-2** `schemes` absent: default to `https`.
- **E-3** Multiple `schemes` (`["https","http"]`): use the first (`https`); no multi-environment (2.0 schemes are protocol variants of one host, not distinct servers — one baseUrl).
- **E-4** A body param with no `schema`, or a schema with no `example`/`default`: body resolves to `active: "none"` (mapper's existing `jsonExample === undefined` path).
- **E-5** `securityDefinitions` is `apiKey`/`oauth2`/`basic` (all non-`http`): no root auth (matches 3.x "only http bearer/basic" scope; the carmedia file's `apiKey` header token thus imports with no auth — acceptable, documented).
- **E-6** A 2.0 `$ref` to `#/definitions/X`: resolves because `definitions` is retained in the normalized doc.
- **E-7** An operation with a body param AND other params: body → requestBody, others → grids (no cross-contamination).

## Dependencies

- No new npm deps. No Rust change. No on-disk schema change. The `yaml` dep (already used by `parseText`) covers 2.0 YAML too.
- Reuses the entire `openapi-to-tree.ts` mapper + `resolveRef` unchanged.

## Decision log

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-14 | Design gate: pz-ddd N/A (no domain model - format adapter), pz-archetypes N/A (not a domain shape), **pz-codebase-design applies** (a new `normalizeSwagger2` module with a narrow interface feeding the existing mapper - a seam decision). | Mandatory gate. Only module-interface skill matches. |
| 2026-07-14 | Support Swagger 2.0 by **normalizing to the 3.x in-memory shape** in the parse layer, NOT by teaching the mapper two formats. | Keeps `openapi-to-tree.ts` single-format (one code path, all existing tests hold); the delta between 2.0 and 3.x is a handful of moved fields, cheap to rewrite once at the boundary. Alternative (branch inside the mapper on version) rejected: doubles every mapper function's shape handling. Mirrors the Bruno importer's "two parsers, one ParsedBru shape" precedent (ADR 2026-06-25). |
| 2026-07-14 | 2.0 `securityDefinitions` non-http types (apiKey/oauth2/basic) → **no root auth**, same as 3.x. | The Auth model has only bearer/basic/none/inherit (no apiKey). Matching the existing 3.x scope keeps the change small; the carmedia file's apiKey header is a documented gap (E-5), not a regression. |
| 2026-07-14 | `schemes` (protocol list) collapses to ONE baseUrl (first scheme), NOT a multi-environment like 3.x multiple `servers`. | 2.0 `schemes` are http/https variants of the SAME host - not distinct servers. One baseUrl is the faithful mapping; multi-env would be misleading. |
