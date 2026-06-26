# Plan: Per-folder inheritable `.env` + folder `Env` tab

Implements [spec.md](./spec.md). TDD red-green-refactor; frontend Vitest + Rust unchanged
(no Rust touched - `.env` flows through the existing JS `WorkspaceFs`).

## Domain-modeling gate

Evaluated `pz-ddd` and `pz-archetypes`: **neither applies**. This is config/plumbing
(file model + resolution fold + UI panels), no domain aggregate, consistency boundary, or
recurring archetype shape. Recorded in spec; no skill invoked.

## Approach + key decisions

- **`dotenv` on `FolderNode`** (not a separate side-map): keeps the `.env` text co-located
  with the node, round-trips with the tree, moves with the folder on rename/move for free.
- **Resolution mirrors `variables`**: reuse `findScopePath`; fold `parseDotenv(scope.dotenv)`
  root(base) -> farthest -> nearest, nearest wins. New pure fns in `resolve.ts`.
- **Per-request folded process env**: `workspace-context` computes the active request's
  folded env (memoized) and feeds it to send / copy-curl / scripts / highlight. The flat
  workspace `processEnv` state stays only as the **root base**.
- **Folder `.env` table = `KEY=value` only** (decision: comments dropped on table edit).
  Root `.env` keeps raw-text editor (comments preserved) - relocated to Settings.
- **New env appears in header selector after folder save** (tree-union behaviour, no draft
  threading).
- **Token-edit targets the owning `.env`**: `resolveProcessEnvProvenance` returns which
  scope (folder id or root) supplied each KEY; `setTokenValue` writes there.

## File changes

### Model + disk + fs
- `src/lib/workspace/model.ts` - `FolderNode.dotenv?: string`.
- `src/lib/workspace/disk-format.ts` - serialize folder `dotenv` -> `<dir>/.env` when
  non-empty; deserialize `<dir>/.env` -> folder node `dotenv`; `ParsedFolder` ignores it
  (folder `.env` is a sibling file, read in `buildLevel`). Root `.env` stays out of the
  tree (loader handles it as today).
- `src/lib/workspace/reconcile.ts` - `MANAGED_FILE` unchanged (must NOT match `.env`);
  folder `.env` written through `planReconcile.write` since serialize now emits it, but
  never in `remove` (not managed). Confirm/add test.
- `src/lib/workspace/tauri-fs.ts` - widen `READONLY_FILE` `^\.env$` -> `(?:^|/)\.env$` so
  folder `.env` files at any depth are collected on read. Keep `writeEnv` for the root.
- `src/lib/workspace/in-memory-fs.ts` - no change (whole FileMap round-trips); folder
  `.env` arrives via `writeWorkspace`.

### Resolution
- `src/lib/workspace/resolve.ts` - `Scope` gains `dotenv?`; `findScopePath` carries it.
  Add `resolveProcessEnv(tree, requestId, rootEnv)` and
  `resolveProcessEnvProvenance(...)`.

### Context rewire
- `src/components/workspace/workspace-context.tsx`:
  - Keep root `processEnv` state (base). Add a memoized `activeProcessEnv` = folded env for
    `activeRequestId` (falls back to root when no folder/request).
  - `sendRequest`, `copyAsCurl`, script API `processEnv`, and the `highlight`/`effective`
    consumers use the request's folded env (compute per-send via `resolveProcessEnv`).
  - `setTokenValue` dotenv branch: look up owner via `resolveProcessEnvProvenance`; if a
    folder owns the key, write `setDotenvValue` into that folder's `dotenv` (tree write via
    a new `updateFolderDotenv`); else write root `.env` (existing `saveEnv`).
  - Remove `openEnvEditor` + `editTarget {kind:"env"}` wiring; root `.env` save moves to a
    Settings entry point (`saveEnv` stays, exposed for the Settings section).
- `src/lib/workspace/update-config.ts` (or new `update-folder-dotenv.ts`) - pure
  `updateFolderDotenv(tree, id, dotenv)`.

### UI - folder Env tab
- `src/components/workspace/config-panels.tsx` - new `EnvPanel`:
  - sub-bar `Tabs` ("Envs" / ".env").
  - **Envs**: env picker (`Select` of `listEnvironmentNames(tree)` ∪ keys of
    `config.environments`) + "add env" affordance; `EditableKeyValueTable` bound to
    `config.environments[picked]`. Reuses `VarsPanel`-style onChange into draft.
  - **.env**: `EditableKeyValueTable` whose rows come from `parseDotenv(draft.dotenv)`,
    onChange rebuilds `dotenv` as `KEY=value` lines into the draft.
- `src/components/workspace/folder-pane.tsx`:
  - Add "Env" `TabsTrigger` before "Settings".
  - `FolderStructuredEditor` draft type widens to `{ config: ConfigScope; dotenv?: string }`
    so a single draft holds both; `isDirty`/`save`/`commitToTree` persist config + dotenv in
    ONE tree write (`updateNodeConfig` then `updateFolderDotenv`, or a combined helper).
- `src/components/workspace/folder-pane.tsx` seed - re-seed draft on `id` + saved-config +
  saved-dotenv key.

### UI - root `.env` relocation
- `src/components/settings/env-section.tsx` (new) - raw-text CodeMirror for root `.env`
  (lift the body of the current `EnvEditorForm`), saved via the active-editor seam +
  `saveEnv`. Wired into the Settings list in `content.tsx`.
- `src/components/workspace/content.tsx` - render `<EnvSection/>` in the Settings body;
  drop the `editTarget?.kind === "env"` branch.
- `src/components/workspace/sidebar.tsx` - remove the `.env` button + `openEnvEditor`.
- `src/components/workspace/env-editor.tsx` - delete (logic moves to `env-section.tsx`), or
  repurpose; remove `editTarget {kind:"env"}`, `openEnvEditor`, `EditTarget` env variant
  from `workspace-context.tsx`.

## Edge cases handled (from spec §6)
Folder w/o `.env`; same KEY folder+root; root-level request; comments dropped on folder
table edit; empty dotenv emits no file; rename/move carries `.env`, no force-remove;
unknown token verbatim; token-edit of nonexistent key -> root.

## Tests (one+ per AC)
- `resolve` (new `__tests__/process-env-resolution.test.ts`): AC-003 nearest-wins,
  sibling-no-leak, root-base, root-level request; AC-010 provenance owner.
- `disk-format` test: AC-001 folder `dotenv` serialize/deserialize round-trip, empty -> no
  file (TC-003).
- `tauri-fs`/`reconcile` test: AC-002 collect `.env` at depth; AC-011 `.env` not removed on
  unrelated write (TC-008).
- `workspace-context` integration: AC-004 send uses folded env (TC-001/002); AC-010 token
  edit writes owner (TC-007).
- `folder-pane`/`config-panels` component test: AC-005/006/007/008 Env tab, Envs picker +
  add, .env table, single-write save + dirty (TC-004/005).
- Settings test: AC-009 root `.env` editable in Settings, sidebar button gone (TC-006).

## Execution order
1. Model + disk-format + fs read (AC-001/002/011) - red->green.
2. Resolution fns (AC-003/004 + provenance AC-010) - red->green.
3. Context rewire to folded env + token owner (AC-004/010).
4. Folder Env tab UI (AC-005/006/007/008).
5. Root `.env` -> Settings, remove sidebar/editor (AC-009).
6. Refactor; docs (README/CLAUDE/ADR); full suite + lint + typecheck.

## Acceptance verification
`npm test` (Vitest) green incl. new suites; `npm run lint`; `npm run typecheck`. Manual:
`npm start`, create folder `.env` via Env tab, send a request resolving
`{{process.env.KEY}}`, verify nearest-folder precedence and root edit in Settings. Shut app
down after.

## Risks
- Per-request folded env recomputed on send/highlight: cheap (small chains); memoize the
  active-request fold to avoid re-walking on every render.
- Draft widening in `FolderStructuredEditor` could regress the existing single-write save:
  covered by an explicit single-tree-write test (AC-008).
- Removing `editTarget {kind:"env"}` touches close-confirm/save-active seams: grep all refs
  and update tests before deleting.
