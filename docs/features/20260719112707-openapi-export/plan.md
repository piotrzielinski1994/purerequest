# Plan - OpenAPI document export

Spec: [spec.md](spec.md). Branch `20260719112707-openapi-export`. Mirrors F5b (Postman export) wiring 1:1.

Coverage threshold: none enforced (vitest config has no `coverage.thresholds`).

## Design gate verdict

- `pz-ddd`: evaluated, NOT invoked - no new domain boundary; reuses the workspace model + the established
  importer/exporter port pattern.
- `pz-archetypes`: evaluated, NOT invoked - the problem shape is a pure tree->document serializer (inverse of
  a parser), not accounting/inventory/ordering/etc.
- `pz-codebase-design`: evaluated, NOT invoked (beyond reuse) - unlike F5b, no new seam to cut. The shared
  `CollectionWriter` already exists (`lib/export/collection-writer.ts`); the OpenAPI writer is a thin alias,
  same as `lib/postman/writer.ts`. The single new module (`tree-to-openapi.ts`) is a leaf serializer with an
  obvious deep interface (`treeToOpenapiDoc(root) -> doc`), nothing to reshape.

## Approach

Lossy inverse of the OpenAPI importer, scoped to the importer-expressible subset (spec §Round-trip). A pure
`treeToOpenapiDoc(root): OpenapiDocument` walks the tree once and builds the document object; the shared
`CollectionWriter` serializes the single-entry file map. Wiring mirrors F5b exactly (context `ExportsApi`,
folder menu item, shortcut, palette, writer ref plumbing). The round-trip through the real `openapiToTree` is
the load-bearing correctness oracle - it defines what "faithful" means for a lossy target.

**Servers precedence (round-trip-critical).** The importer, given multiple servers, produces a root config
carrying BOTH a `baseUrl` variable (= first server) AND `environments` (one per server). So the emitter must
derive `servers` from **environments when present** (one entry per env, `description` = env name), and fall
back to the single `baseUrl` variable only when there are no environments. Emitting a server for the plain
`baseUrl` variable *and* for each environment would duplicate the first server and break the round-trip.

**Path derivation.** From `node.url`: strip a leading `{{...}}` token, drop any `?query`, convert `:seg` ->
`{seg}`, ensure a leading `/`. A stripped `{{baseUrl}}` is not re-derived into a server here (servers come
from config, per above); an absolute `scheme://host/path` splits host->server, `/path`->path (spec §edge 1).

## File Structure

**New**
- `src/lib/openapi/tree-to-openapi.ts` - pure emitter. `OpenapiExportRoot`, `OpenapiDocument`,
  `treeToOpenapiDoc`.
- `src/lib/openapi/__tests__/tree-to-openapi.test.ts` - unit (TC-001..014) + round-trip (TC-015) via real
  `openapiToTree`.
- `src/lib/openapi/writer.ts` - thin re-export of the shared writer: `OpenapiExportWriter`,
  `createTauriOpenapiWriter`, `createNoopOpenapiWriter` (alias `collection-writer.ts`).
- `src/components/workspace/__tests__/openapi-export.test.tsx` - folder-menu + palette (mirror of
  `postman-export.test.tsx`), TC-018..020.
- `src/lib/shortcuts/__tests__/export-openapi-registry.test.ts` - default-hotkey assertion (TC part of 012).

**Modify**
- `src/components/workspace/workspace-context/exports.ts` - add `exportOpenapi`; route through a new
  `openapiWriterRef`.
- `src/components/workspace/workspace-context/types.ts` - add `openapiWriterRef` to `WorkspaceInternals` and
  `exportOpenapi` to `ExportsApi` / the public `WorkspaceValue`.
- `src/components/workspace/workspace-context/index.tsx` - accept `openapiWriter` prop, `openapiWriterRef`
  useRef + sync, add to internals + workspace value.
- `src/components/workspace/workspace-loader.tsx` - thread `openapiWriter` prop through (both render sites).
- `src/routes/index.tsx` - construct `createTauriOpenapiWriter` / `createNoopOpenapiWriter` in adapters (Tauri
  + noop) and pass the prop.
- `src/components/workspace/main.tsx` - destructure `exportOpenapi`, bind `export-openapi` palette handler.
- `src/components/workspace/tree-row.tsx` - add **Export as OpenAPI...** folder-only menu item (after
  "Export as Postman...").
- `src/lib/shortcuts/registry.ts` - add `export-openapi` action id + entry, default `Mod+Alt+O` (free).
- `docs/data-format.md`, `README.md` - note the OpenAPI export in the importer/exporter lists.

## Tasks

### Task 1: Pure emitter `treeToOpenapiDoc`

**Files:** Create `src/lib/openapi/tree-to-openapi.ts`, `src/lib/openapi/__tests__/tree-to-openapi.test.ts`.

**Interfaces:**
- Consumes: model types (`TreeNode`/`FolderNode`/`RequestNode`/`ConfigScope`/`Environment`/`KeyValue`/`Auth`/
  `RequestBody`); `openapiToTree` from `@/lib/openapi/openapi-to-tree` (round-trip oracle, test-only).
- Produces: `type OpenapiExportRoot = { name: string; config: ConfigScope; children: TreeNode[] }`;
  `type OpenapiDocument = Record<string, unknown>`; `function treeToOpenapiDoc(root: OpenapiExportRoot):
  OpenapiDocument`.

Covers AC-001..009. Emitter internals (pure helpers): `toOpenapiPath(url)` (strip `{{var}}`/query, `:seg`->
`{seg}`, leading `/`), `parametersOf(node)` (query+path+header rows -> parameter objects, `example` when
value non-empty, path rows `required:true`), `requestBodyOf(body)` (json/graphql->`application/json`, form->
urlencoded, multipart->formdata, none->omit), `operationOf(node, tag)`, `collectPaths(children)` (walk tree,
immediate-parent folder = tag, deep nesting flattened onto the direct-parent tag, merge same path+method),
`serversOf(config)` (environments-first precedence), `securityOf(config.auth)` (bearer/basic http scheme +
requirement, no secrets), `tagsList` (distinct tag names). Document assembled `{ openapi:"3.0.3",
info:{title,version:"1.0.0"}, servers?, tags?, paths, components?, security? }`.

- [ ] Write failing unit tests (TC-001..014) + round-trip (TC-015) against real `openapiToTree`
- [ ] Confirm RED for the right reason
- [ ] Implement the emitter minimally
- [ ] Confirm GREEN
- [ ] Commit (`feat: AC-001..009 pure treeToOpenapiDoc emitter`)

### Task 2: OpenAPI writer alias

**Files:** Create `src/lib/openapi/writer.ts`.

**Interfaces:**
- Consumes: `CollectionWriter`, `createTauriCollectionWriter`, `createNoopCollectionWriter` from
  `@/lib/export/collection-writer`.
- Produces: `type OpenapiExportWriter = CollectionWriter`; `createTauriOpenapiWriter`,
  `createNoopOpenapiWriter` (aliases). No new writer test - the shared writer's tests already cover
  cancel/write/noop (AC-010 verified there); TC-016/017 are exercised via the shared suite + the
  context-routing test in Task 3.

- [ ] Create the alias module (byte-mirror of `lib/postman/writer.ts`)
- [ ] Confirm `npx tsc` clean + shared writer suite green
- [ ] Commit (folded into Task 3 commit if trivial)

### Task 3: Context wiring - `exportOpenapi`

**Files:** Modify `exports.ts`, `types.ts`, `index.tsx` (workspace-context), `workspace-loader.tsx`,
`routes/index.tsx`; extend `workspace-context/__tests__/exports.test.ts`.

**Interfaces:**
- Consumes: `treeToOpenapiDoc` (Task 1), `OpenapiExportWriter` (Task 2), `findNode`.
- Produces: `exportOpenapi: (nodeId?: string) => void` on `ExportsApi` + `WorkspaceValue`; `openapiWriterRef`
  on `WorkspaceInternals`.

Covers AC-012 routing + §edge 6/7. Mirror `exportPostman`: build `openapiRootFor(nodeId)` (folder -> that
root, else whole workspace named after workspace); `save({ "<slug>.openapi.json": JSON.stringify(doc,null,2)
}, root.name)`; success toast `Exported OpenAPI document`, failure toast `Failed to export OpenAPI document`.

- [ ] Extend exports.test.ts with the OpenAPI routing quartet (folder / whole-ws / undefined / reject)
- [ ] Confirm RED
- [ ] Add `exportOpenapi` + `openapiWriterRef` plumbing through all wiring sites
- [ ] Confirm GREEN
- [ ] Commit (`feat: AC-012 exportOpenapi context wiring`)

### Task 4: UI + shortcut - folder menu, palette, hotkey

**Files:** Modify `tree-row.tsx`, `main.tsx`, `shortcuts/registry.ts`; Create `openapi-export.test.tsx`,
`export-openapi-registry.test.ts`.

**Interfaces:**
- Consumes: `exportOpenapi` from `useWorkspace()`; `export-openapi` action id.

Covers AC-011, AC-012 (menu/palette/hotkey). Menu item folder-only, placed right after "Export as Postman...".
Registry action `export-openapi`, default `Mod+Alt+O` (free - `Mod+Shift+O` is import-openapi, `Mod+Alt+P` is
export-postman). Palette handler `() => exportOpenapi(selectedNodeId ?? undefined)`.

- [ ] Write failing tests: menu visibility (folder yes / request no) + palette folder/whole-ws + registry hotkey
- [ ] Confirm RED
- [ ] Add menu item, registry entry, palette binding
- [ ] Confirm GREEN
- [ ] Commit (`feat: AC-011,012 OpenAPI export menu + shortcut`)

### Task 5: Docs

**Files:** Modify `docs/data-format.md`, `README.md`.

- [ ] Note OpenAPI export alongside Bruno + Postman export (importer/exporter lists)
- [ ] Commit (`docs: note OpenAPI export`)

## Edge cases (from spec §Edge cases)

Servers precedence (environments-first, no duplicate for the plain baseUrl var); absolute/bare/token-less
urls -> path derivation; duplicate path+method last-wins; `?query` stripped from path; empty/all-symbol name
-> `slugify` `untitled`; invalid `json` body text -> raw-string example; picker cancel -> false/no toast;
write failure -> error toast; `QUERY` method -> lowercase `query` op key (round-trips via importer `METHODS`).

## Risks

- Round-trip asymmetry (importer wraps in a single root folder, sorts children, mints ids, resets auth
  secrets, drops non-JSON bodies): the round-trip test projects to the importer's normalized, subset shape
  (name-sorted children, ids stripped, secrets empty, only JSON body asserted) - same discipline as F5b's
  round-trip test, not full equality.
- Servers-precedence bug would silently double the first server: pinned by TC-010 (single) + TC-011 (multi)
  and the round-trip test (TC-015 uses a single baseUrl).

## Acceptance verification

Fresh-context verifier (Phase 4): every AC -> its test; `npx tsc`, `npm run lint`, full `npx vitest` green;
round-trip test exercises the real `openapiToTree`.
