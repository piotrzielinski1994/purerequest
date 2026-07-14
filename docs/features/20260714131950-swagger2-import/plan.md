# Plan - Swagger 2.0 import support

Approach per spec: a pure `normalizeSwagger2` adapter rewrites a 2.0 doc into the 3.x in-memory shape; `parseOpenapiDocument` applies it on `swagger:"2.0"`. The existing `openapi-to-tree.ts` mapper runs unchanged. TDD. Coverage threshold: none.

## File structure map

Create:
- `src/lib/openapi/swagger2.ts` - `normalizeSwagger2(doc: Record<string, unknown>): Record<string, unknown>` (pure; the 2.0→3.x field rewrite).
- `src/lib/openapi/__tests__/swagger2.test.ts` - unit tests for the adapter (servers/body-split/security/definitions) + parse-gate + a real-file import (carmedia).

Modify:
- `src/lib/openapi/parse-openapi.ts` - in `parseOpenapiDocument`, when `parsed.swagger === "2.0"`, run `normalizeSwagger2(parsed)` then continue through the existing 3.x gate. Comment updated (no longer "swagger 2.0 → null").

No mapper change. No reader change (text→parse path identical). Existing `parse-openapi.test.ts` "should return null for a swagger 2.0 document" case gets FLIPPED (now non-null) - the only existing-test edit.

## normalizeSwagger2 algorithm

```
input: a parsed 2.0 doc (isRecord, swagger === "2.0")
output: a new doc object (do not mutate input):

base = { ...doc, openapi: "3.0.0" }; delete base.swagger

// servers (E-1/E-2/E-3)
if typeof host === "string" && host !== "":
  scheme = Array.isArray(schemes) && typeof schemes[0]==="string" ? schemes[0] : "https"
  basePath = typeof doc.basePath==="string" ? doc.basePath : ""
  base.servers = [{ url: `${scheme}://${host}${basePath}` }]
// else: no servers key (mapper -> baseUrl undefined -> relative paths)

// security schemes
if isRecord(securityDefinitions):
  base.components = { ...(isRecord(doc.components)?doc.components:{}), securitySchemes: securityDefinitions }

// definitions: RETAINED as-is (base already spreads doc, so #/definitions/X resolves).
//   Also expose components.schemas = definitions for forward-compat (harmless).

// per-operation body param -> requestBody
for each path in base.paths (isRecord):
  for each method key in {get,post,put,patch,delete} whose value isRecord:
    op = pathItem[key]
    if Array.isArray(op.parameters):
      bodyParam = op.parameters.find(p => isRecord(p) && p.in === "body")
      if bodyParam && bodyParam.schema !== undefined:
        op.requestBody = { content: { "application/json": { schema: bodyParam.schema } } }
      op.parameters = op.parameters.filter(p => !(isRecord(p) && p.in === "body"))
```

Implemented immutably (map/spread, no in-place mutation of the input), returning a fresh doc. The body param's `schema` may be a `#/definitions/X` `$ref`; the mapper's `bodyOf` → `resolveRef` follows it against the retained `definitions`, then `jsonExample` reads `schema.example` (E-4: none → `active:"none"`).

Note on `paramValue` (already in the mapper): a 2.0 non-body param's `example`/`default` sit at the param's TOP level, which `paramValue` reads first (`param.example`, then `resolveRef(param.schema)` which is undefined for a 2.0 param → falls through returning ""). So a 2.0 param with only `default` (no `example`) needs `paramValue` to also read a TOP-LEVEL `default`. CHECK the mapper: `paramValue` currently reads top-level `example` then `schema.example`/`schema.default` - it does NOT read a top-level `default`. TC-005 (query `default:"x"`) requires it. FIX = a one-line mapper tweak: read `param.default` after `param.example` before the schema branch. This is the only mapper edit and it is 3.x-safe (3.x params legitimately may carry `default`? no - 3.x default lives in schema; but reading a top-level `param.default` when absent is a harmless no-op for 3.x). Record in decision log.

## Task 1: normalizeSwagger2 adapter + parse gate

**Files:** Create `swagger2.ts`; modify `parse-openapi.ts`. Test `swagger2.test.ts` + edit `parse-openapi.test.ts` (flip the 2.0 case).

**Interfaces:**
- Produces: `normalizeSwagger2(doc): Record<string, unknown>`. `parseOpenapiDocument` accepts 2.0.

- [ ] RED: `parseOpenapiDocument({swagger:"2.0", paths:{"/x":{get:{}}}})` non-null (TC-001); adapter builds `servers` from host/basePath/schemes (TC-003); splits `in:body` → requestBody, filters it from params (TC-004 shape); leaves non-body params; sets components.securitySchemes; retains definitions.
- [ ] GREEN: implement the algorithm; wire into `parseOpenapiDocument`.
- [ ] Commit `feat: AC-001 accept + normalize swagger 2.0 documents`.

## Task 2: end-to-end mapping (body, params, baseUrl, real file)

**Files:** modify `openapi-to-tree.ts` (the one `paramValue` top-level `default` line). Test in `swagger2.test.ts` via `openapiToTree`.

**Interfaces:**
- Consumes: `normalizeSwagger2` + the untouched mapper.

- [ ] RED: `openapiToTree(2.0 doc)` → tag folders + requests (TC-002); `{{baseUrl}}` var + request url (TC-003); body `$ref` example → json body, not in grids (TC-004); path/query param `example`/`default` → grids (TC-005); real `carmedia.openapi.json` → non-empty tree + correct baseUrl (TC-006).
- [ ] GREEN: add the `param.default` read in `paramValue`; everything else already flows.
- [ ] Commit `feat: AC-003..AC-007 map swagger 2.0 operations/body/params/baseUrl`.

## Execution order

Task 1 (parse + adapter) → Task 2 (mapper tweak + e2e). Run the full openapi suite after Task 2 (AC-008 regression) then full `vitest run`.

## Edge cases (from spec)

E-1 no host → no servers; E-2 no schemes → https; E-3 multi-scheme → first only; E-4 body no example → active none; E-5 non-http security → no auth; E-6 `#/definitions/X` resolves (definitions retained); E-7 body + other params don't cross-contaminate.

## Risks

- `paramValue` top-level `default` read could in theory change a 3.x import if a 3.x param carried a stray top-level `default` - but 3.x puts default in `schema`, and reading an absent field is a no-op, so 3.x output is unchanged (guarded by AC-008 running the full existing suite).
- Real-file test reads `.pzielinski/carmedia.openapi.json` (a private, git-ignored file). It exists locally; the test must skip gracefully if absent so CI (which lacks it) stays green. Use `fs.existsSync` guard → `it.skipIf`.

## Acceptance verification

Every AC maps to a TC. Real-file import (TC-006) is the concrete proof point. Final: fresh-context verifier + live import of the actual file through the running app.

---

## AC traceability (post-implementation)

All ACs green. `npx vitest run` = 1900 passed (218 files); `tsc --noEmit` clean; `eslint .` 0 errors (9 pre-existing react-refresh warnings). Live-verified in the running app (chrome-devtools): the real `carmedia.openapi.json` imports to 36 requests / 3 tag folders / baseUrl `https://api.carmedia2p0.com/api/1.0`.

| AC | Test file / name |
| --- | --- |
| AC-001 | swagger2.test.ts `should accept a swagger 2.0 document`; parse-openapi.test.ts `should accept a swagger 2.0 document (normalized to 3.x)`; `should still accept a 3.0 document` |
| AC-002 | swagger2.test.ts `should still reject a swagger 1.0 document` / `...no version tag`; parse-openapi.test.ts existing null cases |
| AC-003 | swagger2.test.ts `should group tagged 2.0 operations into a folder with a request per method` |
| AC-004 | swagger2.test.ts `should derive a baseUrl variable and prefix request urls...` + `should use a bare relative url and no baseUrl var when there is no host` |
| AC-005 | swagger2.test.ts `should seed a json body from a body-param $ref example and keep it out of the grids` |
| AC-006 | swagger2.test.ts `should map non-body params to the path/query grids seeding example and default` |
| AC-007 | swagger2.test.ts `should import the real carmedia 2.0 file to a non-empty tree with the expected baseUrl` (skipIf file absent) |
| AC-008 | openapi-to-tree.test.ts unchanged + full suite green; `should return an empty array for a swagger 2.0 doc with no operations` (new) pins the accepted-but-operationless path |
| E-1..E-7 | swagger2.test.ts normalizeSwagger2 unit block (servers/no-host/multi-scheme/body-split/non-body/security/definitions/purity) |

## Decision log (implementation)

| Date | Decision | Rationale |
| --- | --- | --- |
| 2026-07-14 | `jsonExample` now `resolveRef`s the media-type `schema` before reading its `example`. | The plan wrongly assumed `bodyOf` resolved the schema; it didn't. A 2.0 body schema is a `$ref` to `#/definitions/X`, so the example lives on the resolved definition. 3.x-safe (also fixes 3.x `#/components/schemas` body refs with an example) and guarded by the full existing suite. |
| 2026-07-14 | Did NOT add `components.schemas = definitions` (plan item 5 called it "harmless forward-compat"). | Unnecessary: 2.0 `$ref`s target `#/definitions/X`, which resolves against the retained `definitions`. Omitting it keeps the adapter minimal. |
| 2026-07-14 | Avoided a `const { swagger, ...rest }` discard (eslint `no-unused-vars`, no underscore-ignore configured). | Build a fresh `{...doc, ...}` then `delete normalized.swagger` on the copy - keeps purity (the copy, not the input, is mutated). |

**Deviations from plan:** the two above (jsonExample resolve was an unplanned but necessary fix; components.schemas omitted as unneeded). No scope change.
