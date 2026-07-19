# Plan - Postman collection export

Spec: [spec.md](spec.md). Branch `20260718213132-postman-export`. Mirrors F5a (Bruno export) structure.

Coverage threshold: none enforced (vitest config has no `coverage.thresholds`).

## Design gate verdict

- `pz-ddd`: evaluated, NOT invoked - no new domain boundary; reuses the existing workspace model + the
  established importer/exporter port pattern.
- `pz-archetypes`: evaluated, NOT invoked - the problem shape is a pure tree->document serializer (inverse
  of a parser), not accounting/inventory/ordering/etc.
- `pz-codebase-design`: invoked (lightly) - one interface decision: extract F5a's `BrunoExportWriter` into a
  format-agnostic `CollectionWriter` (deeper, reused module) rather than clone a byte-identical twin. Two
  adapters (Bruno + Postman) now justify the seam.

## Approach

Structure-preserving inverse of the Postman importer. A pure `treeToPostmanFiles(root)` builds the emit
`PostmanFileMap`; the shared `CollectionWriter` (lifted from `bruno/writer.ts`) writes it. Wiring mirrors
F5a 1:1 (context `ExportsApi`, folder menu item, shortcut, palette). The round-trip through the real
`postmanToTree` is the load-bearing correctness oracle.

## File Structure

**New**
- `src/lib/postman/tree-to-postman.ts` - pure emitter. `PostmanExportRoot`, `treeToPostmanFiles`.
- `src/lib/postman/__tests__/tree-to-postman.test.ts` - unit + round-trip via `postmanToTree`.
- `src/lib/export/collection-writer.ts` - shared writer extracted from `bruno/writer.ts`: `CollectionWriter`, `createCollectionWriter`, `createTauriCollectionWriter`, `createNoopCollectionWriter`.
- `src/lib/export/__tests__/collection-writer.test.ts` - moved/renamed from `bruno/__tests__/writer.test.ts`.
- `src/lib/postman/writer.ts` - thin re-export: `PostmanExportWriter`, `createTauriPostmanWriter`, `createNoopPostmanWriter` (alias the shared writer).
- `src/components/workspace/__tests__/postman-export.test.tsx` - folder-menu + palette (mirror of `bruno-export.test.tsx`).
- `src/lib/shortcuts/__tests__/export-postman-registry.test.ts` - default-hotkey assertion.

**Modify**
- `src/lib/bruno/writer.ts` - re-export the shared writer under the Bruno names (keep `BrunoExportWriter`, `createTauriBrunoWriter`, `createNoopBrunoWriter` as aliases) so F5a callers/tests are untouched.
- `src/components/workspace/workspace-context/exports.ts` - add `exportPostman`; both exports route through `postmanWriterRef` / `brunoWriterRef`.
- `src/components/workspace/workspace-context/types.ts` - add `postmanWriterRef` to `WorkspaceInternals` and `exportPostman` to the public `WorkspaceValue`.
- `src/components/workspace/workspace-context/index.tsx` - accept `postmanWriter` prop, `postmanWriterRef` useRef + sync, add to internals + workspace value.
- `src/components/workspace/workspace-loader.tsx` - thread `postmanWriter` prop through.
- `src/routes/index.tsx` - construct `createTauriPostmanWriter` / `createNoopPostmanWriter` in adapters.
- `src/components/workspace/tree-row.tsx` - add **Export as Postman...** folder-only menu item.
- `src/components/workspace/main.tsx` - bind `export-postman` handler.
- `src/lib/shortcuts/registry.ts` - add `export-postman` action, default `Mod+Alt+P`.
- `docs/data-format.md`, `README.md` - note the Postman export (importers/exporters list).

## Tasks

### Task 1: Pure emitter `treeToPostmanFiles`

**Files:** Create `src/lib/postman/tree-to-postman.ts`, `src/lib/postman/__tests__/tree-to-postman.test.ts`.

**Interfaces:**
- Consumes: model types; `slugify`/`uniqueSlug` from `@/lib/workspace/slug`; `PostmanFileMap` from `@/lib/postman/postman-to-tree`.
- Produces: `type PostmanExportRoot = { name: string; config: ConfigScope; children: TreeNode[] }`; `function treeToPostmanFiles(root: PostmanExportRoot): PostmanFileMap`.

Covers AC-001..010. Emitter internals (pure helpers): `urlObject(node)` (raw + query + variable), `bodyObject(body)`, `authObject(auth)`, `eventsArray(scripts)`, `headerRows`/`disabled` mapping, `itemOf(node)` recursive, `collectionDoc(root)`, `environmentDoc(env)`. JSON via `JSON.stringify(doc, null, 2)`.

- [ ] Write failing unit tests (TC-001..011) + round-trip (TC-012) against real `postmanToTree`
- [ ] Confirm RED for the right reason
- [ ] Implement the emitter minimally
- [ ] Confirm GREEN
- [ ] Commit (`feat: AC-001..010 pure treeToPostmanFiles emitter`)

### Task 2: Shared collection writer (extract from Bruno)

**Files:** Create `src/lib/export/collection-writer.ts`, `src/lib/export/__tests__/collection-writer.test.ts`; Modify `src/lib/bruno/writer.ts` (re-export aliases); Create `src/lib/postman/writer.ts` (re-export aliases).

**Interfaces:**
- Produces: `type CollectionWriter = { save: (files: Record<string,string>, suggestedName: string) => Promise<boolean> }`; `createCollectionWriter(deps)`, `createTauriCollectionWriter()`, `createNoopCollectionWriter()`. Bruno + Postman writer modules re-export these under their own names.

Covers AC-011. F5a's `bruno/__tests__/writer.test.ts` stays green (Bruno names still resolve). New `collection-writer.test.ts` re-runs the cancel/write/noop trio against the generic names.

- [ ] Write failing tests for `createCollectionWriter` (cancel->false, writes-under-slug->true, noop->false)
- [ ] Confirm RED
- [ ] Extract logic; re-point Bruno writer to aliases; add Postman writer aliases
- [ ] Confirm GREEN (new suite + F5a's writer.test.ts + bruno-export.test.tsx)
- [ ] Commit (`refactor: extract shared CollectionWriter; feat: Postman writer`)

### Task 3: Context wiring - `exportPostman`

**Files:** Modify `exports.ts`, `types.ts`, `index.tsx` (workspace-context), `workspace-loader.tsx`, `routes/index.tsx`; extend `workspace-context/__tests__/exports.test.ts`.

**Interfaces:**
- Consumes: `treeToPostmanFiles` (Task 1), `PostmanExportWriter` (Task 2), `findNode`.
- Produces: `exportPostman: (nodeId?: string) => void` on `ExportsApi` + `WorkspaceValue`; `postmanWriterRef` on `WorkspaceInternals`.

Covers AC-013 routing + §8.7. Mirror `exportBruno`: folder->that root, else whole workspace named after workspace; success/failure toasts (`Exported Postman collection` / `Failed to export Postman collection`).

- [ ] Extend exports.test.ts with the Postman routing quartet (folder / whole-ws / undefined / reject)
- [ ] Confirm RED
- [ ] Add `exportPostman` + ref plumbing through all wiring sites
- [ ] Confirm GREEN
- [ ] Commit (`feat: AC-013 exportPostman context wiring`)

### Task 4: UI + shortcut - folder menu, palette, hotkey

**Files:** Modify `tree-row.tsx`, `main.tsx`, `shortcuts/registry.ts`; Create `postman-export.test.tsx`, `export-postman-registry.test.ts`.

**Interfaces:**
- Consumes: `exportPostman` from `useWorkspace()`; `export-postman` action id.

Covers AC-012, AC-013 (menu/palette/hotkey). Menu item folder-only, placed right after "Export as Bruno...". Registry action `export-postman`, default `Mod+Alt+P` (free - Shift+P is import-postman, Shift+E is export-bruno). Palette handler `() => exportPostman(selectedNodeId ?? undefined)`.

- [ ] Write failing tests: menu visibility (folder yes / request no) + palette folder/whole-ws + registry hotkey
- [ ] Confirm RED
- [ ] Add menu item, registry entry, palette binding
- [ ] Confirm GREEN
- [ ] Commit (`feat: AC-012,013 Postman export menu + shortcut`)

### Task 5: Docs

**Files:** Modify `docs/data-format.md`, `README.md`.

- [ ] Note Postman export alongside Bruno export (importer/exporter lists)
- [ ] Commit (`docs: note Postman export`)

## Edge cases (from spec §8)

Dropped fields (timeoutMs/colors/dotenv/httpVersion/request-env); path-param fidelity via `url.variable`;
query dedup vs `url.raw`; slug collisions (`uniqueSlug` on env files); picker cancel; write-failure toast.

## Risks

- Extracting the writer touches committed F5a code: mitigated by keeping Bruno names as aliases and running
  F5a's full suite (writer.test.ts + bruno-export.test.tsx) as the regression gate in Task 2.
- Round-trip asymmetry (importer wraps in a single root folder; folders sort/reorder): the round-trip test
  projects to the importer's normalized shape (name-sorted children, ids stripped), same discipline as F5a.

## Acceptance verification

Fresh-context verifier (Phase 4): every AC -> its test; `npx tsc`, `npm run lint`, full `npx vitest` green;
round-trip test exercises the real `postmanToTree`.
