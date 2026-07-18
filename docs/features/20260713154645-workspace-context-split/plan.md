# Plan: Split `workspace-context.tsx`

Behavior-preserving code-motion. The provider keeps owning all state and returning one
`value`; the ~90 closures move into per-concern factory functions in sibling files, invoked
inside the existing `value` `useMemo`. Public surface (`useWorkspace`, `WorkspaceProvider`,
all types) unchanged → zero consumer/test churn.

## Decision Log (pre-implementation)

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-13 | Split shape = "split logic, keep one hook" (not separate stateful providers). | ~40 state atoms (`requestOverrides`, `draftRequests`, `responseStates`, `tree`, `persistTree`/`saveEnv` write-core) are shared across tree/tabs/editor/send. Separate providers need a god base-provider anyway + rewrite 22 consumers + ~101 tests. This shape is zero-churn. |
| 2026-07-13 | Convert `workspace-context.tsx` → `workspace-context/index.tsx` (folder module). | Import path `@/components/workspace/workspace-context` resolves to the dir index unchanged, so no consumer/test import edits. |
| 2026-07-13 | Factories are plain functions (no hooks) taking a shared `internals` bag, called INSIDE the `value` `useMemo`. | Keeps recompute timing + memo dep array identical to today. Pure code-motion, no behavior/identity change. |
| 2026-07-13 | Domain gate: neither `pz-ddd` nor `pz-archetypes` applies. | Pure frontend state-management refactor - no domain model, aggregate, consistency boundary, or archetype (accounting/inventory/ordering/…) shape. |
| 2026-07-13 | RED-first waived; existing ~1827-test suite is the characterization net. | Refactor with no new behavior. Suite must stay green after each extraction step (documented exception to the repo's red-green rule for this feature). One new surface-pin test is added (TC-001). |

## File Structure

New folder `src/components/workspace/workspace-context/` (replaces the single file):

| File | Responsibility |
| ---- | -------------- |
| `index.tsx` | `WorkspaceProvider` (all `useState`/`useRef`/`useEffect` + derived memos + `activeScopeId`/`scopedEnvNames`/`effectiveEnvironment`/`requestsById`/`dirtyRequestIds`/`editorDirty`/`popupCanSave`/`restoredOpenIds`/`isSettings*`), builds the `internals` bag, calls the factories in construction order, assembles + returns `value`; `useWorkspace()`; re-exports all types. |
| `types.ts` | `WorkspaceContextValue`, all exported types (`EditTarget`, `RevealTarget`, `ParamsReveal`, `EditorScope`, `ActiveEditor`, `PendingClose`, `PendingDelete`, `SelectMode`, `RequestTab`, `ResponseTab`), `RequestOverride`, and the internal `WorkspaceInternals` bag type + per-factory return types. `isOverrideFieldDirty`, `indexRequests`, `toggleInSet` helpers move here (pure, shared). |
| `persist.ts` | `createPersist(internals)` → `{ persistTree, saveEnv }`. The write-core. |
| `selection.ts` | `createSelection(internals)` → `{ selectSingle, focusNode, selectNode, selectInTree, clearSelection, toggleFolder }`. |
| `config-saves.ts` | `createConfigSaves(internals, persistTree)` → `{ saveNodeConfig, saveFolder, saveFolderConfigDoc, setFolderEnvColor }`. |
| `tabs.ts` | `createTabs(internals)` → `{ closeRequest, closeAllRequests, closeOthers, reorderRequests, setActiveRequest, requestCloseRequest, requestCloseOthers, requestCloseAll, openSettings, closeSettings }`. |
| `request-edits.ts` | `createRequestEdits(internals, persistTree)` → `{ mergeOverride, setRequestBody, setRequestBodyMode, setRequestForm, setRequestGraphqlQuery, setRequestGraphqlVariables, setRequestUrl, setRequestMethod, setRequestPathParams, setRequestQueryParams, setRequestConfig, saveActiveRequest, saveRequestNode, saveActive }` (URL/param sync helpers `prunePathAfterUrl`/`syncQueryAfterUrl`/`paramsPatchForUrl` are file-local). |
| `tree-crud.ts` | `createTreeCrud(internals, { persistTree, selectSingle, closeRequest })` → `{ derivePlacement, createRequestNode, newRequest, newFolder, duplicateRequest, beginRename, commitRename, cancelRename, requestDeleteNode, confirmPendingDelete, cancelPendingDelete, moveNode, moveNodes }` (`deleteTargetsFor`, `deleteNodes` file-local). |
| `send.ts` | `createSend(internals, { persistTree, saveEnv })` → `{ sendRequest, cancelRequest, resolveActiveWire, openCodeGen, closeCodeGen }` (`persistVarWrites` file-local). |
| `imports.ts` | `createImports(internals, { persistTree, saveEnv, createRequestNode, selectSingle })` → `{ importCurl, importBruno, importPostman, importOpenapi, openCurlImport, closeCurlImport }`. |
| `editors.ts` | `createEditors(internals, { persistTree, closeRequest, closeAllRequests, closeOthers })` → `{ openConfigEditor, requestCloseEditor, saveActiveEditor, confirmPendingClose, savePendingClose, cancelPendingClose }` (`registerActiveEditor` stays a top-level `useCallback` in `index.tsx`). |
| `tokens.ts` | `createTokens(internals, { persistTree, saveEnv, saveNodeConfig, setRequestPathParams })` → `{ setTokenValue, revealTokenSource }`. |

Old `workspace-context.tsx` is deleted (git detects the folder move).

## The `internals` bag (contract)

`index.tsx` builds one object per render holding every shared atom + setter + ref + derived
value; each factory destructures what it needs. Because factories run inside the `value`
`useMemo` (which already lists every atom as a dep), the bag adds no new deps and changes no
timing. Contents (grouped):

- **State**: `tree`, `activeEnvironment`, `envText`, `processEnv`, `editTarget`,
  `isEditorActive`, `pendingClose`, `pendingDelete`, `isCurlImportOpen`, `isCodeGenOpen`,
  `revealTarget`, `paramsReveal`, `renamingNodeId`, `consoleLines`, `requestOverrides`,
  `draftRequests`, `responseStates`, `expandedFolderIds`, `selectedNodeId`, `selectedIds`,
  `selectAnchorId`, `openRequestIds`, `activeRequestId`, `activeRequestTab`,
  `activeResponseTab`, `activeEditor`, `focusUrlNonce`.
- **Setters**: the matching `setX` for each of the above (raw setters, no built-closure deps).
- **Refs**: `preSettingsActiveId`, `revealNonce`, `paramsRevealNonce`, `nodeCounter`,
  `autoNameIds`, `showToastRef`, `httpClientRef`, `scriptRunnerRef`, `sendGeneration`,
  `inFlightRequestId`, `onTabsChangeRef`, `onDraftTabsChangeRef`, `onTreeChangeRef`,
  `onActiveEnvironmentChangeRef`, `onEnvChangeRef`. **Passed as the ref objects** (not
  `.current`) so async paths read live values.
- **Derived**: `requestsById`, `dirtyRequestIds`, `editorDirty`, `popupCanSave`,
  `isWorkspaceWritable`, `activeScopeId`, `scopedEnvNames`, `effectiveEnvironment`,
  `isSettingsOpen`, `isSettingsActive`.

## Construction order (inside `value` useMemo)

Strictly one-directional (each step only uses already-built closures):

1. `persist` → `persistTree`, `saveEnv`
2. `selection` → `selectSingle`, `focusNode`, `selectNode`, `selectInTree`, `clearSelection`, `toggleFolder`
3. `config-saves` → needs `persistTree`
4. `tabs` → `closeRequest`, `closeOthers`, `closeAllRequests`, `requestClose*`, `reorder`, `setActiveRequest`, `open/closeSettings`
5. `request-edits` → needs `persistTree`
6. `tree-crud` → needs `persistTree`, `selectSingle`, `closeRequest`
7. `send` → needs `persistTree`, `saveEnv`
8. `imports` → needs `createRequestNode` (from 6), `persistTree`, `saveEnv`, `selectSingle`
9. `editors` → needs `persistTree`, `closeRequest`/`closeOthers`/`closeAllRequests` (from 4)
10. `tokens` → needs `persistTree`, `saveEnv`, `saveNodeConfig` (from 3), `setRequestPathParams` (from 5)

Then `value = { ...all slices, ...inline derived getters (activeRequest, effectiveConfig, responseState, processEnv-folded, activeAccentColor, environmentNames, openConfigEditor via editors, setActiveEnvironment wrapper, setRequestTab/ResponseTab) }`. The `value` `useMemo` dep array is **copied verbatim** from the current file (AC-005).

## Tasks

Each task ends with the **full suite green + typecheck 0** (the characterization net). Commit
per task: `refactor(workspace-context): <desc>`. No test files edited except the one new
surface-pin test added in Task 1.

### Task 1: Scaffold folder + types + surface-pin test

**Files:** Create `workspace-context/index.tsx` (moved verbatim from `workspace-context.tsx`,
imports adjusted for new depth), `workspace-context/types.ts` (extract the type decls +
`isOverrideFieldDirty`/`indexRequests`/`toggleInSet`); Delete `workspace-context.tsx`; Create
Test `workspace-context/__tests__/surface.test.tsx`.

**Interfaces:**
- Produces: the module still exports `WorkspaceProvider`, `useWorkspace`, and all types from
  `@/components/workspace/workspace-context`.

- [ ] Add surface-pin test (TC-001): mount `WorkspaceProvider`, assert `useWorkspace()` exposes the full member-name set.
- [ ] Move file → `index.tsx`, extract types → `types.ts`, fix relative imports.
- [ ] Run full suite + typecheck → all green, new test passes, no other test edited.
- [ ] Commit.

### Task 2: Extract `persist.ts` (write-core)

**Interfaces:** Produces `createPersist(internals) → { persistTree, saveEnv }`.
- [ ] Move `persistTree` + `saveEnv` into `persist.ts`; provider calls `createPersist`.
- [ ] Full suite + typecheck green. Commit.

### Task 3: Extract `selection.ts`

**Interfaces:** Produces `createSelection(internals) → { selectSingle, focusNode, selectNode, selectInTree, clearSelection, toggleFolder }`.
- [ ] Move selection closures; inject `selectSingle` where the provider composes tree-crud/imports later.
- [ ] Full suite + typecheck green. Commit.

### Task 4: Extract `config-saves.ts`

**Interfaces:** Consumes `persistTree`. Produces `{ saveNodeConfig, saveFolder, saveFolderConfigDoc, setFolderEnvColor }`.
- [ ] Move; wire. Full suite + typecheck green. Commit.

### Task 5: Extract `tabs.ts`

**Interfaces:** Consumes `dirtyRequestIds`, `openRequestIds` (internals). Produces `{ closeRequest, closeAllRequests, closeOthers, reorderRequests, setActiveRequest, requestCloseRequest, requestCloseOthers, requestCloseAll, openSettings, closeSettings }`.
- [ ] Move; wire. Full suite + typecheck green. Commit.

### Task 6: Extract `request-edits.ts`

**Interfaces:** Consumes `persistTree`, `requestsById`, `dirtyRequestIds`, `activeEditor`. Produces the `setRequest*` + `saveActiveRequest`/`saveRequestNode`/`saveActive` set + `mergeOverride`, `setRequestPathParams` (needed by tokens).
- [ ] Move (incl. file-local URL/param sync helpers); wire. Full suite + typecheck green. Commit.

### Task 7: Extract `tree-crud.ts`

**Interfaces:** Consumes `persistTree`, `selectSingle`, `closeRequest`. Produces `{ createRequestNode, newRequest, newFolder, duplicateRequest, beginRename, commitRename, cancelRename, requestDeleteNode, confirmPendingDelete, cancelPendingDelete, moveNode, moveNodes, derivePlacement }`.
- [ ] Move (incl. file-local `deleteTargetsFor`/`deleteNodes`); wire. Full suite + typecheck green. Commit.

### Task 8: Extract `send.ts`

**Interfaces:** Consumes `persistTree`, `saveEnv`. Produces `{ sendRequest, cancelRequest, resolveActiveWire, openCodeGen, closeCodeGen }`.
- [ ] Move (incl. file-local `persistVarWrites`); wire. Full suite + typecheck green. Commit.

### Task 9: Extract `imports.ts`

**Interfaces:** Consumes `createRequestNode`, `persistTree`, `saveEnv`, `selectSingle`. Produces `{ importCurl, importBruno, importPostman, importOpenapi, openCurlImport, closeCurlImport }`.
- [ ] Move; wire. Full suite + typecheck green. Commit.

### Task 10: Extract `editors.ts`

**Interfaces:** Consumes `persistTree`, `closeRequest`, `closeOthers`, `closeAllRequests`. Produces `{ openConfigEditor, requestCloseEditor, saveActiveEditor, confirmPendingClose, savePendingClose, cancelPendingClose }`. (`registerActiveEditor` stays a top-level `useCallback`.)
- [ ] Move; wire. Full suite + typecheck green. Commit.

### Task 11: Extract `tokens.ts`

**Interfaces:** Consumes `persistTree`, `saveEnv`, `saveNodeConfig`, `setRequestPathParams`, `activeScopeId`, `processEnv`, `tree`. Produces `{ setTokenValue, revealTokenSource }`.
- [ ] Move; wire. Full suite + typecheck green. Commit.

### Task 12: Final tidy + gates

- [ ] `index.tsx` holds only state/refs/effects/derived + `value` composition; confirm `value` dep array is verbatim.
- [ ] Run `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` → all exit 0.
- [ ] Spawn fresh verifier (Phase 4). Commit final.

## Cross-cutting notes

- **Pattern**: factory-of-closures (mirrors purequery's `workspace-context.tsx` internal idiom),
  no new library. Each factory is a plain function; hooks stay in `index.tsx`.
- **Edge cases** (from spec): circular factory deps resolved by construction order; refs
  passed as objects (live reads); `createRequestNode` is the tree+tabs hybrid injected into
  imports; identity churn matches today (factories inside the same `value` memo).
- **Tests**: no behavior tests rewritten. New surface-pin test (TC-001) + the whole existing
  suite (TC-002) + lint/typecheck/build (TC-003) are the gates.

## Risks

- **Missed closure dependency during move** → typecheck catches most; full suite catches
  behavioral. Mitigation: move one module per task, run the full suite each time - a break is
  localized to the last extraction.
- **Ref-vs-snapshot slip** (reading `.current` at factory-build time instead of call time in an
  async path) → would break the send loop's stale-guard. Mitigation: pass ref objects, deref
  inside closures only; `scripts-send-loop`/`send-cancel` tests cover it.
- **`value` dep-array drift** → would change recompute timing. Mitigation: copy the array
  verbatim (AC-005), diff it against the original in Task 12.

## Infrastructure Prerequisites

| Category | Requirement |
| --- | --- |
| Environment variables | N/A |
| Registry images | N/A |
| Cloud quotas | N/A |
| Network reachability | N/A |
| CI status | N/A |
| External secrets | N/A |
| Database migrations | N/A |

Verification before implementation: green baseline confirmed (`npm test` → 1827 passed / 211 files).

## AC → Test mapping (Phase 4, verifier-confirmed)

| AC | Proof | Verdict |
| -- | ----- | ------- |
| AC-001 | surface.test.tsx + `git diff main --stat`: only eslint.config.js + deleted monolith outside folder; 0 consumer/test import edits; index re-exports all 11 types | PASS |
| AC-002 | `WorkspaceContextValue` byte-identical to main (102 members, diff empty); surface.test.tsx pins the member set (bidirectional, non-tautological) | PASS |
| AC-003 | no `*.test.tsx` edited/deleted; only new surface.test.tsx | PASS |
| AC-004 | 10 factory modules + types.ts; index.tsx 764 lines (was 2286) | PASS |
| AC-005 | `value` dep array diff vs main = empty (50 entries) | PASS |
| AC-006 | lint exit 0 (0 errors, 0 new warnings after dead-capture fix), typecheck 0, npm test exit 0 (1828/1828), build 0 | PASS |

Verifier note: initial run hit a flaky `npm test` exit 1 from a Radix hover-card teardown
`setTimeout` in `url-bar-token-hover.test.tsx` (NOT in the diff); re-run deterministically
exits 0 with 1828/1828. The new exhaustive-deps warning it flagged (dead `activeEnvironment`
capture) was removed in the final commit.

## Decision Log (implementation)

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-13 | `workspace-context.tsx` -> `workspace-context/index.tsx` via `git mv`; types + pure helpers -> types.ts; full `WorkspaceInternals` bag type defined once up front | Preserves import path (zero churn); one type edit instead of 11 incremental ones |
| 2026-07-13 | Scoped `react-hooks/refs: off` for the folder (eslint.config.js) | v7 false positive: factories take a bag holding refs but only deref inside returned closures; mirrors existing routes/demo-table carve-outs |
| 2026-07-13 | editors.ts folds the duplicated pending-close switch into one `applyClose` helper | confirmPendingClose + savePendingClose ran the identical close switch; behavior identical, less duplication |
| 2026-07-13 | Dropped dead `activeEnvironment`/`setActiveEnvironmentState` from the internals bag | No factory reads them; the raw capture added a new exhaustive-deps warning absent on main |
