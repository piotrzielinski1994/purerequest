# HTTP QUERY Method Support

**Status: IMPLEMENTED + VERIFIED (2026-07-17).** All 12 ACs pass. Gates: tsc clean, 2110 vitest pass, 64 cargo pass, eslint clean. Not yet committed (awaiting approval).

## AC -> Test Traceability

| AC     | Test(s)                                                                                                   |
| ------ | --------------------------------------------------------------------------------------------------------- |
| AC-001 | tsc: `HttpMethod` union compiles with `"QUERY"` (fixtures across build-request/to-curl/to-fetch/tree-to-bruno). |
| AC-002 | url-bar.test.tsx `should list QUERY in the method dropdown and set the method to QUERY when picked`.        |
| AC-003 | method-color.test.ts `should map QUERY to a teal color class`; url-bar.test.tsx `should give the method trigger a teal color class when QUERY is active`. |
| AC-004 | zod-schemas.test.ts `should accept method QUERY` + `should reject an unknown method FETCH`.                 |
| AC-005 | request-settings-tab.test.tsx `should keep saving enabled if the Raw JSON method is QUERY`.                 |
| AC-006 | build-request.test.ts `should carry the body and method for QUERY` + `should still null the body for GET/DELETE after QUERY is added`. |
| AC-007 | src-tauri lib.rs `should_accept_query_as_a_reqwest_extension_method`.                                        |
| AC-008 | parse-curl.test.ts `should keep -X QUERY as the method` + `should keep --request QUERY as the method`.      |
| AC-009 | parse-postman.test.ts `should map a QUERY method to QUERY`.                                                 |
| AC-010 | parse-bru.test.ts `should read QUERY from a query method block`; parse-opencollection.test.ts `should map an http.method of QUERY to QUERY`. |
| AC-011 | openapi-to-tree.test.ts `should map a query operation key to method QUERY`.                                 |
| AC-012 | to-curl.test.ts `should emit -X QUERY for a QUERY wire request`; to-fetch.test.ts `should emit the method QUERY and its body for a QUERY request`; tree-to-bruno.test.ts `should emit a query { block for a QUERY request and round-trip its method`. |

## Overview

Add the HTTP `QUERY` method as a first-class, selectable method throughout ReqUI.

QUERY is a new, standardized HTTP verb (RFC 10008, June 2026): a **safe, idempotent** request method that **carries a request body**. It fills the gap between GET (safe/idempotent, no body) and POST (has body, neither safe nor idempotent) - the canonical use is a large/complex read-only search whose parameters are too big for a URL. See <https://datatracker.ietf.org/doc/rfc10008/>.

Today ReqUI's supported methods are a closed set: `GET | POST | PUT | PATCH | DELETE`. This feature widens that set to include `QUERY` end-to-end: pick it, send it (with a body), see it badged, validate it, and import it from every supported format. Exports already interpolate the raw method string, so they carry QUERY through with no code change.

## Acceptance Criteria

- AC-001: `HttpMethod` union includes `"QUERY"`.
- AC-002: The method dropdown in the URL bar lists `QUERY` as a selectable option; selecting it sets the active request's method to `QUERY`.
- AC-003: `QUERY` renders with a distinct badge color (teal) in the method dropdown/trigger, consistent with the existing per-method color scheme.
- AC-004: The request-config Zod schema accepts `method: "QUERY"` and rejects unknown methods as before.
- AC-005: The config-editor's raw-JSON `parseRequest` validation accepts `QUERY` as a valid method.
- AC-006: `buildHttpRequest` for a `QUERY` request **keeps the body** (QUERY is NOT bodyless; only GET/DELETE are), and sends method `"QUERY"` to the transport.
- AC-007: The Rust transport (`send_via_reqwest`) sends a request whose method is `QUERY` without error (reqwest `Method::from_bytes` already accepts it - verified, no Rust change expected).
- AC-008: curl import: `curl -X QUERY ...` (and `--request QUERY`) parses to a request with method `QUERY`.
- AC-009: Postman import: an item with `request.method: "QUERY"` maps to method `QUERY`.
- AC-010: Bruno import: both the native `.bru` parser (`query { ... }` block) and the OpenCollection parser accept `QUERY`.
- AC-011: OpenAPI/Swagger import: a `query` operation key on a path item maps to method `QUERY` (forward-looking - not yet a standard OpenAPI field, but handled for parity).
- AC-012: curl export (`-X QUERY`), fetch codegen (`method: "QUERY"`), and Bruno export (`query` block, lowercased) round-trip a QUERY request. (No new code - assert existing interpolation carries it.)

## Test Cases

- TC-001 (happy, AC-002/003): Given a request, when the user opens the method dropdown, then `QUERY` appears; selecting it sets `activeRequest.method === "QUERY"` and the trigger carries the teal color class. Maps to: AC-002, AC-003.
- TC-002 (happy, AC-006): Given a `QUERY` RequestNode with a JSON body, when `buildHttpRequest` runs, then the result has `method: "QUERY"` and `body` is the encoded payload (not null). Maps to: AC-006.
- TC-003 (boundary, AC-006): Given a `GET` and a `DELETE` node with bodies, `buildHttpRequest` still nulls the body (regression guard that QUERY was added without widening the bodyless set). Maps to: AC-006.
- TC-004 (happy, AC-004): `requestSettingsSchema.safeParse({...,method:"QUERY"})` succeeds. Maps to: AC-004.
- TC-005 (error, AC-004): `requestSettingsSchema.safeParse({...,method:"FETCH"})` fails. Maps to: AC-004.
- TC-006 (happy, AC-005): `parseRequest` on JSON text with `"method":"QUERY"` returns a non-null patch. Maps to: AC-005.
- TC-007 (happy, AC-008): `parseCurl('curl -X QUERY https://x')` -> `{ok:true, request.method:"QUERY"}`. Maps to: AC-008.
- TC-008 (happy, AC-009): Postman import of an item with `method:"QUERY"` -> node method `QUERY`. Maps to: AC-009.
- TC-009 (happy, AC-010): `.bru` text with a `query { ... }` block parses to method `QUERY`; OpenCollection JSON with `method:"QUERY"` too. Maps to: AC-010.
- TC-010 (happy, AC-011): `openapi-to-tree` on a doc with a `query` operation -> request method `QUERY`. Maps to: AC-011.
- TC-011 (happy, AC-012): `toCurl` of a QUERY request contains `-X QUERY`; `toFetch` contains `"method": "QUERY"` (or equivalent); Bruno export emits a `query` block. Maps to: AC-012.

## UI States

| State   | Behavior                                                                 |
| ------- | ------------------------------------------------------------------------ |
| Loading | N/A - method list is static, no async.                                   |
| Empty   | N/A - method always has a value; QUERY is one more option in a fixed list. |
| Error   | Selecting QUERY then sending an unsupported-by-server request surfaces the normal server/transport error path (unchanged). |
| Success | QUERY selectable, teal-badged, sends with body, imports/exports carry it. |

### Method dropdown (ASCII)

```
+--------+
| GET    |
| POST   |
| PUT    |
| PATCH  |
| DELETE |
| QUERY  |   <- new, teal text
+--------+
```

## Data Model

`HttpMethod` (in `src/lib/workspace/model.ts`) is the single union of the type; every method allow-list elsewhere is an independent literal list kept in sync by hand (existing pattern). Change:

```
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | "QUERY";
```

`RequestNode.method` and `HttpRequest.method` reference `HttpMethod`, so they widen automatically. Persisted requests are unaffected (QUERY is additive; old files never contain it).

## Edge Cases

1. QUERY must NOT be added to `BODYLESS_METHODS` (GET/DELETE only) - it carries a body. Guarded by TC-003.
2. Bruno uses lowercase method tokens (`query`), OpenAPI/Swagger use lowercase operation keys (`query`); those allow-lists take the lowercase form.
3. `METHOD_COLOR` is an exhaustive `Record<HttpMethod,string>` - omitting QUERY is a compile error, so the color is forced (good).
4. The url-bar/config-editor `METHODS` arrays are `HttpMethod[]` subsets - NOT compiler-forced; must be edited by hand (that is why AC-002/005 have explicit tests).
5. OpenAPI `query` operation is not a standard path-item field yet; adding it is forward-looking and harmless (only fires if a doc actually contains one).
6. reqwest `Method::from_bytes(b"QUERY")` returns a valid extension method - no Rust change expected; AC-007 confirms by inspection/test.

## Dependencies

None new. Pure widening of an existing enum + its hand-maintained mirrors. No new package, no migration, no infra.
