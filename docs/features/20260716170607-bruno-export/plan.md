# Bruno collection export - plan

Spec: [spec.md](./spec.md). Backlog: F5a.

## Approach & key decisions

- **Emitter is a pure function**, the mirror of the importer: `treeToBrunoFiles(root) -> BrunoFileMap`,
  with `.bru` block serialization the inverse of `parseBru`. Verified primarily by a **round-trip** test
  (`brunoToTree(treeToBrunoFiles(root), name)` equals the source tree shape) - the importer is the oracle,
  so the emitter can't drift from the parser's grammar. This is the deepest available test: it exercises
  every block through the real parser instead of asserting brittle string output.
- **Writer is a provider port** (`BrunoExportWriter`), injected into `WorkspaceProvider` exactly like
  `httpClient`/`scriptRunner`: a Tauri impl (dir picker + fs writes) and a no-op impl (dev browser). This
  lets the context own a single `exportBruno(nodeId?)` method that both the folder menu and the
  shortcut/palette call - no duplicated pick+emit+write logic across two call sites (the shape the codebase
  already uses for imports).
- **`slugify`/`uniqueSlug` reused, not re-rolled.** They are currently private to `disk-format.ts`.
  Extract them to a tiny `lib/workspace/slug.ts` and import from both `disk-format.ts` and the emitter -
  one source of truth for collision-safe file naming (satisfies AC-008 without drift). This is a pure move,
  covered by the existing disk-format tests plus a small direct test.
- **Design gate verdict** (recorded in Decision Log): `pz-ddd` N/A (no new domain model - reuses the
  existing `TreeNode` aggregate), `pz-archetypes` N/A (no accounting/inventory/etc. shape), **`pz-codebase-design`
  APPLIES** - two new module interfaces (the pure emitter, the writer port). Deep-module checks applied:
  emitter hides all `.bru` grammar behind one `treeToBrunoFiles`; writer hides picker+fs behind `save`;
  writer seam is justified by two adapters (Tauri + noop), mirroring the reader ports already in the repo.

## File Structure

```
src/lib/workspace/slug.ts                         # NEW: slugify + uniqueSlug (extracted from disk-format)
src/lib/workspace/disk-format.ts                  # MODIFY: import slug from slug.ts (drop private copies)
src/lib/bruno/tree-to-bruno.ts                    # NEW: treeToBrunoFiles + BrunoExportRoot (the emitter)
src/lib/bruno/writer.ts                            # NEW: BrunoExportWriter port + Tauri + noop impls
src/lib/bruno/__tests__/tree-to-bruno.test.ts     # NEW: emitter unit + round-trip tests
src/lib/bruno/__tests__/writer.test.ts            # NEW: writer save/cancel tests (fake picker + in-memory fs)
src/lib/workspace/__tests__/slug.test.ts          # NEW: slug extraction characterization test

src/lib/shortcuts/registry.ts                     # MODIFY: add "export-bruno" action (Mod+Shift+E)

src/components/workspace/workspace-context/exports.ts        # NEW: createExports -> { exportBruno }
src/components/workspace/workspace-context/types.ts          # MODIFY: brunoWriter port + workspaceName internals; exportBruno on surface
src/components/workspace/workspace-context/index.tsx         # MODIFY: accept brunoWriter+workspaceName props; wire createExports; expose exportBruno
src/components/workspace/workspace-context/__tests__/surface.test.tsx  # MODIFY: add "exportBruno" to EXPECTED_MEMBERS

src/components/workspace/tree-row.tsx             # MODIFY: folder-only "Export as Bruno..." menu item
src/components/workspace/main.tsx                 # MODIFY: "export-bruno" handler entry
src/components/workspace/workspace-layout.tsx     # (no change - writer flows via provider, not layout props)
src/components/workspace/workspace-loader.tsx     # MODIFY: pass brunoWriter + workspaceName to provider
src/routes/index.tsx                              # MODIFY: construct Tauri/noop writer, pass to loader
src/components/workspace/__tests__/bruno-export.test.tsx     # NEW: menu + shortcut integration test
```

## Task breakdown

### Task 1: Extract `slug.ts`

**Files:** Create `src/lib/workspace/slug.ts`, `src/lib/workspace/__tests__/slug.test.ts`; Modify
`src/lib/workspace/disk-format.ts` (remove the two private fns, import them).

**Interfaces:**
- Produces: `slugify(name: string): string`, `uniqueSlug(base: string, used: Set<string>): string` (verbatim
  move; `slugify("") === "untitled"`, `uniqueSlug` appends `-2`, `-3`, ... on collision).

- [ ] Write failing test: `slugify` lowercases + hyphenates + falls back to `untitled`; `uniqueSlug` suffixes collisions
- [ ] Run it, confirm it FAILS (module doesn't exist yet)
- [ ] Move both fns to `slug.ts`, re-import in `disk-format.ts`
- [ ] Run `slug.test.ts` + full disk-format suite, confirm all PASS
- [ ] Commit (`refactor: extract slugify/uniqueSlug to slug.ts`)

### Task 2: `treeToBrunoFiles` emitter

**Files:** Create `src/lib/bruno/tree-to-bruno.ts`, `src/lib/bruno/__tests__/tree-to-bruno.test.ts`.

**Interfaces:**
- Consumes: `slugify`/`uniqueSlug` (Task 1); `BrunoFileMap` from `bruno-to-tree.ts`; model types; the
  importer `brunoToTree`/`parseBru` as the round-trip oracle.
- Produces:
  - `type BrunoExportRoot = { name: string; config: ConfigScope; dotenv?: string; children: TreeNode[] }`
  - `treeToBrunoFiles(root: BrunoExportRoot): BrunoFileMap`

  Block grammar emitted (inverse of `parseBru`): `meta { name; type: http; seq }`; `<method> { url; body?:
  <sel>; auth?: <sel> }`; `headers { ... }`, `params:query { ... }` (dict, `~` prefix for disabled);
  `body:json|text` as text block, `body:form-urlencoded|multipart-form` as dict, `body:graphql` + optional
  `body:graphql:vars` as text; `auth:bearer { token }` / `auth:basic { username; password }`;
  `vars:pre-request { ... }`; `script:pre-request { ... }` / `script:post-response { ... }`. Root ->
  `bruno.json`. Non-root folder -> `<slug>/folder.bru` (`meta { name }` + config blocks). Environments ->
  `environments/<slug>.bru` (`vars { ... }`). `dotenv` -> `.env`. Dropped: `timeoutMs`,
  `environmentColors`, request-level environments, `params.path` (§8 edge cases).

- [ ] Write failing tests: TC-001..TC-008 (per-block emit) + TC-009 (round-trip via `brunoToTree`)
- [ ] Run, confirm FAIL (module absent)
- [ ] Implement emitter; minimal, declarative (map/flatMap over children + blocks, no raw loops)
- [ ] Run, confirm PASS
- [ ] Commit (`feat: AC-001..009 treeToBrunoFiles Bruno emitter`)

### Task 3: `BrunoExportWriter` port

**Files:** Create `src/lib/bruno/writer.ts`, `src/lib/bruno/__tests__/writer.test.ts`.

**Interfaces:**
- Consumes: `slugify` (Task 1); `BrunoFileMap`; `@tauri-apps/plugin-dialog` `open`, `@tauri-apps/plugin-fs`
  `mkdir`/`writeTextFile`.
- Produces:
  - `type BrunoExportWriter = { save: (files: BrunoFileMap, suggestedName: string) => Promise<boolean> }`
  - `createTauriBrunoWriter(): BrunoExportWriter` (picks parent dir; writes each file under
    `<parent>/<slug(suggestedName)>/`, `mkdir` intermediate dirs; `false` on cancel)
  - `createNoopBrunoWriter(): BrunoExportWriter` (`save` -> `false`)

  To keep `save` unit-testable without Tauri, factor the dir-pick and the file-write behind two injected
  fns inside `createTauriBrunoWriter` OR expose a pure `writeFilesUnder(fs, dir, name, files)` core the
  Tauri impl calls - decide at GREEN; the test drives it with a fake picker + in-memory fs.

- [ ] Write failing tests: TC-010 (cancel -> false, no writes), TC-011 (writes every file under `<dir>/<slug>/` -> true)
- [ ] Run, confirm FAIL
- [ ] Implement Tauri + noop writer + the testable core
- [ ] Run, confirm PASS
- [ ] Commit (`feat: AC-010 BrunoExportWriter port`)

### Task 4: `export-bruno` shortcut action

**Files:** Modify `src/lib/shortcuts/registry.ts`.

**Interfaces:**
- Produces: a new `ShortcutActionId` `"export-bruno"` + `SHORTCUT_ACTIONS` entry (name "Export as Bruno",
  description, `defaultHotkey: "Mod+Shift+E"`). Auto-flows into `resolve.ts` ACTION_IDS and the palette.

- [ ] Write failing test (extend shortcuts registry/resolve test): `export-bruno` is a known action id with default `Mod+Shift+E`
- [ ] Run, confirm FAIL
- [ ] Add the union member + array entry
- [ ] Run, confirm PASS (fix any exhaustiveness test that enumerates ids)
- [ ] Commit (`feat: AC-012 export-bruno shortcut action`)

### Task 5: `exportBruno` context method + provider wiring

**Files:** Create `src/components/workspace/workspace-context/exports.ts`; Modify `types.ts`, `index.tsx`,
`__tests__/surface.test.tsx`.

**Interfaces:**
- Consumes: `treeToBrunoFiles`, `BrunoExportRoot` (Task 2); `BrunoExportWriter` (Task 3); internals `tree`,
  `showToastRef`, and a new `brunoWriter` port + `workspaceName` string threaded through the provider;
  `findNode` from `tree-locate.ts`.
- Produces: `createExports(internals) -> { exportBruno: (nodeId?: string) => void }`. Resolution: a folder
  `nodeId` -> that folder is the root (`{name, config, dotenv, children}`); otherwise (request id / null) ->
  synthetic root `{ name: workspaceName, config: {}, children: tree }`. Calls `brunoWriter.save(files,
  root.name)`; on resolve `true` -> toast `Exported Bruno collection`; on `false` -> silent; on throw ->
  error toast. Exposed on the context surface as `exportBruno`.

- [ ] Write failing test: `createExports` with a fake writer - folder id routes that subtree; non-folder/undefined routes the whole tree wrapped in workspaceName; toast on success
- [ ] Run, confirm FAIL
- [ ] Add `brunoWriter?`/`workspaceName` to provider props + internals; implement `createExports`; expose `exportBruno`; add to `EXPECTED_MEMBERS`
- [ ] Run `exports` test + `surface.test.tsx`, confirm PASS
- [ ] Commit (`feat: AC-012 exportBruno context method + writer port`)

### Task 6: Folder menu item + shortcut handler + app wiring

**Files:** Modify `tree-row.tsx`, `main.tsx`, `workspace-loader.tsx`, `routes/index.tsx`; Create
`src/components/workspace/__tests__/bruno-export.test.tsx`.

**Interfaces:**
- Consumes: `exportBruno` (Task 5); `createTauriBrunoWriter`/`createNoopBrunoWriter` (Task 3);
  `isDevBrowser` (choose writer in `routes/index.tsx`, like the readers).
- Produces: folder-row `ContextMenuItem` "Export as Bruno..." -> `exportBruno(node.id)` (rendered only when
  `isFolder`, inside the `insideTarget` block or a folder-guarded item); `main.tsx` handler map entry
  `"export-bruno": () => exportBruno(selectedNodeId ?? undefined)`; loader passes `brunoWriter` +
  `workspaceName` to `WorkspaceProvider`; `routes/index.tsx` builds the writer.

- [ ] Write failing tests: TC-012 (folder menu has item, request menu doesn't), TC-013 (folder selected -> writer save called with that subtree), TC-014 (request/none selected -> whole workspace wrapped)
- [ ] Run, confirm FAIL
- [ ] Wire the menu item, the handler, loader + route writer construction
- [ ] Run integration test + full suite, confirm PASS
- [ ] Commit (`feat: AC-011,012 folder Export-as-Bruno menu + shortcut wiring`)

## Edge cases (from spec §8, enforced in tests)

- Disabled row -> `~key` (TC-002). Nested braces in body/script survive via importer's brace counter (TC-009).
- `none` body / `inherit` auth -> no block (TC-004). Collisions -> `-2` suffix (TC-008).
- Picker cancel -> `false`, no writes (TC-010). Dropped fields (`timeoutMs`/colors/req-envs/`params.path`)
  are asserted absent-or-ignored by the round-trip equality (it compares only the preserved shape).

## Tests to write (min one per AC)

| AC | Test |
| -- | ---- |
| AC-001/002 | tree-to-bruno: bruno.json + request `.bru` blocks (TC-001) |
| AC-003 | disabled row `~` prefix (TC-002) |
| AC-004 | body selectors + blocks incl graphql vars (TC-003, TC-004) |
| AC-005 | auth selector + auth blocks; inherit/none omit (TC-004, TC-005) |
| AC-006 | nested folder.bru + config blocks (TC-006) |
| AC-007 | environments/*.bru + .env (TC-007) |
| AC-008 | sibling slug collision -2 (TC-008) |
| AC-009 | round-trip brunoToTree(treeToBrunoFiles(root)) (TC-009) |
| AC-010 | writer save writes / cancel (TC-010, TC-011) |
| AC-011 | folder menu item present, request absent (TC-012) |
| AC-012 | shortcut/palette folder + whole-workspace routing (TC-013, TC-014) |

## Execution order

Task 1 -> 2 -> 3 (pure lib, independently testable) -> 4 (registry) -> 5 (context) -> 6 (UI + app wiring).
Tasks 2 and 3 both depend only on Task 1, so could be built in either order.

## Acceptance verification

- Every AC has a test row above. Coverage: all 12 ACs mapped, all 14 TCs assigned.
- Round-trip (AC-009) is the load-bearing test: it proves the emitter is a true inverse of the shipped parser.
- Phase 4 verifier runs full `npm test` + tsc + the round-trip, adversarially probing dropped-field edge cases.

## Coverage threshold

`none` (vitest config enforces no coverage gate - confirmed in Phase 2).

## Infrastructure Prerequisites

All `N/A` - purely local feature (in-repo TS, Tauri fs/dialog plugins already installed + used by importers).
No env vars, images, quotas, network, CI artifacts, secrets, or migrations.
```