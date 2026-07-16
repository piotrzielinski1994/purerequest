# Plan - HTTP QUERY Method Support

## Approach

Pure additive widening. `HttpMethod` is one union type; every method allow-list elsewhere is an independent hand-maintained literal list (existing codebase pattern - no central registry). So the work is: widen the union, then add `"QUERY"` (or lowercase `query`) to each mirror list, plus one badge color. `buildHttpRequest` needs **no** method-branch change - QUERY correctly falls through to the body-carrying path because only GET/DELETE are bodyless. Rust `reqwest::Method::from_bytes` already accepts extension tokens, so the transport is untouched (confirmed by inspection; asserted).

Design gate: pz-ddd / pz-archetypes / pz-codebase-design all **evaluated, none invoked** - no new domain model, aggregate, or interface seam; just enum widening across existing modules. Recorded in Decision Log.

## File Structure

Core (must edit - type + user-facing + validation + send):
- `src/lib/workspace/model.ts:1` - add `"QUERY"` to `HttpMethod` union. (AC-001)
- `src/components/workspace/url-bar.tsx:17` - add `"QUERY"` to `METHODS` dropdown array. (AC-002)
- `src/components/workspace/method-color.ts:3` - add `QUERY: teal` to `METHOD_COLOR`. (AC-003)
- `src/lib/config-schema/zod-schemas.ts:161` - add `"QUERY"` to method `z.enum`. (AC-004)
- `src/components/workspace/config-editor.tsx:212` - add `"QUERY"` to editor `METHODS` array. (AC-005)

Importers (allow-lists - add QUERY / query):
- `src/lib/curl/parse-curl.ts:16` - add `"QUERY"` to `METHODS` Set. (AC-008)
- `src/lib/postman/parse-postman.ts:78` - add `"QUERY"` to `METHODS` Set. (AC-009)
- `src/lib/bruno/parse-bru.ts:32` - add `"query"` to `METHOD_NAMES` Set (lowercase). (AC-010)
- `src/lib/bruno/parse-opencollection.ts:57` - add `"QUERY"` to `METHODS` Set. (AC-010)
- `src/lib/openapi/openapi-to-tree.ts:26` - add `query: "QUERY"` to `METHODS` Record. (AC-011)
- `src/lib/openapi/swagger2.ts:9` - add `"query"` to `BODY_METHODS` array. (AC-011)

No edit (verify only):
- `src/lib/http/build-request.ts:9` - `BODYLESS_METHODS` stays GET/DELETE; QUERY keeps body. (AC-006)
- `src-tauri/src/lib.rs:240` - `Method::from_bytes` accepts QUERY. (AC-007)
- `src/lib/curl/to-curl.ts:13`, `src/lib/codegen/to-fetch.ts:8`, `src/lib/bruno/tree-to-bruno.ts:75` - exports interpolate method string; carry QUERY free. (AC-012)

## Tasks

### Task 1: Core method definition + send path

**Files:** Modify `src/lib/workspace/model.ts`, `src/components/workspace/method-color.ts`, `src/lib/config-schema/zod-schemas.ts`. Test `src/lib/http/__tests__/build-request.test.ts`, `src/lib/config-schema/__tests__/*` (or nearest existing), `src/components/workspace/__tests__/` for color if present.

**Interfaces:**
- Consumes: nothing.
- Produces: `HttpMethod` now includes `"QUERY"`; `METHOD_COLOR.QUERY` exists; Zod method enum accepts QUERY.

- [ ] Failing test: `buildHttpRequest` on a QUERY node with body keeps `method:"QUERY"` + non-null body; GET/DELETE still null body (TC-002, TC-003). Zod accepts QUERY / rejects FETCH (TC-004, TC-005).
- [ ] Run, confirm RED.
- [ ] Add `"QUERY"` to union, teal to color record, `"QUERY"` to zod enum.
- [ ] Run, confirm GREEN.
- [ ] Commit `feat(query): AC-001,003,004,006 core QUERY method type+color+schema+body`

### Task 2: UI dropdown + editor validation

**Files:** Modify `src/components/workspace/url-bar.tsx`, `src/components/workspace/config-editor.tsx`. Test `src/components/workspace/__tests__/url-bar.test.tsx`.

**Interfaces:**
- Consumes: `HttpMethod` from Task 1.
- Produces: dropdown lists QUERY; editor `parseRequest` accepts QUERY.

- [ ] Failing test: url-bar dropdown renders a `QUERY` option; selecting invokes `setRequestMethod` with `"QUERY"` (TC-001). parseRequest accepts `"method":"QUERY"` (TC-006).
- [ ] Run, confirm RED.
- [ ] Add `"QUERY"` to both `METHODS` arrays.
- [ ] Run, confirm GREEN.
- [ ] Commit `feat(query): AC-002,005 QUERY in method dropdown + editor validation`

### Task 3: Importers accept QUERY

**Files:** Modify `parse-curl.ts`, `parse-postman.ts`, `parse-bru.ts`, `parse-opencollection.ts`, `openapi-to-tree.ts`, `swagger2.ts`. Test the matching `__tests__` files.

**Interfaces:**
- Consumes: `HttpMethod` from Task 1.
- Produces: all importers map their QUERY/query token to method `"QUERY"`.

- [ ] Failing test per importer: curl `-X QUERY` (TC-007), Postman `method:"QUERY"` (TC-008), .bru `query{}` + opencollection `"QUERY"` (TC-009), openapi `query` op (TC-010).
- [ ] Run, confirm RED.
- [ ] Add QUERY/query to each allow-list.
- [ ] Run, confirm GREEN.
- [ ] Commit `feat(query): AC-008..011 accept QUERY in curl/Postman/Bruno/OpenAPI import`

### Task 4: Export round-trip guard (assert-only, likely already green)

**Files:** Test `src/lib/curl/__tests__/to-curl.test.ts`, `src/lib/codegen/__tests__/to-fetch.test.ts`, `src/lib/bruno/__tests__/tree-to-bruno.test.ts`.

**Interfaces:**
- Consumes: `HttpMethod` from Task 1.
- Produces: nothing (regression guards).

- [ ] Add tests: `toCurl` QUERY req -> `-X QUERY`; `toFetch` -> `"method": "QUERY"`; Bruno export -> `query {` block (TC-011).
- [ ] Run. These may pass immediately (exports interpolate the string) - that is expected for AC-012, NOT a tautology: they pin that adding QUERY did not break the export path and the string flows through. If any is red, fix the export.
- [ ] Commit `test(query): AC-012 export round-trip for QUERY (curl/fetch/bruno)`

### Task 5: Verify Rust transport (no code, assert QUERY is a valid method)

**Files:** Test in `src-tauri/` (add a `cargo test` that `reqwest::Method::from_bytes(b"QUERY")` is `Ok`) OR document as inspection-only if no method-level test seam exists.

**Interfaces:**
- Consumes: nothing.
- Produces: evidence AC-007 holds.

- [ ] Add/confirm a `cargo test` asserting `Method::from_bytes(b"QUERY").is_ok()` and that the built request method equals QUERY.
- [ ] Run `cargo test`, confirm PASS.
- [ ] Commit `test(query): AC-007 reqwest accepts QUERY extension method` (only if a test was added).

## Edge Cases (from spec)

1. QUERY stays OUT of `BODYLESS_METHODS` - TC-003 regression guard.
2. Lowercase mirrors: Bruno `query`, OpenAPI/Swagger `query` operation key.
3. `METHOD_COLOR` is exhaustive `Record<HttpMethod,_>` - compiler forces the entry.
4. url-bar/editor `METHODS` arrays are NOT compiler-forced - explicit tests (TC-001, TC-006).
5. OpenAPI `query` op is forward-looking; harmless if absent.

## Acceptance Verification

Every AC has >=1 TC (traceability in spec.md Test Cases). Gates: `npm test` (Vitest) green, `cargo test` green (Task 5), tsc via build. No coverage threshold enforced (verify in Phase 2 step 6).

## Risks

- reqwest rejects QUERY: mitigated - `from_bytes` accepts any valid HTTP token; QUERY is one. Task 5 asserts.
- Hidden method allow-list missed by the map: mitigated - full-repo investigation done; verifier subagent re-scans in Phase 4.
