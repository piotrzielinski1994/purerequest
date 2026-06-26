# Spec: Per-folder inheritable `.env` + folder `Env` tab

**Version:** 0.1.0
**Created:** 2026-06-26
**Status:** Draft

## 1. Overview

Two changes, building on the existing variables/environments feature
(`20260620111743-environments`):

1. **`.env` becomes per-folder and inheritable.** Today `.env` is a single file at
   the workspace root, parsed once into a flat `processEnv` map. After this change every
   folder may hold its own `.env`; a request resolves `{{process.env.KEY}}` along its
   folder chain (**nearest folder wins**, farther folders next, **workspace-root `.env`
   is the base fallback**) - mirroring how plain `variables` already resolve.

2. **A new `Env` tab in the folder config pane** with a two-view sub-bar:
   - **Envs** - a key->value table editing the folder's `config.environments[env]`, with
     an in-tab env picker to choose/add which environment's vars you edit.
   - **.env** - a key->value table editing the folder's own `.env` file.

   Consequence of (1)+(2): the workspace-root `.env` keeps existing as the resolution base
   but its editor moves out of the sidebar into the global **Settings** view; the sidebar
   `.env` button and the dedicated `.env` content editor are removed.

### Design decisions (resolved with user before speccing)

- **Envs sub-view = in-tab env picker** - edit/add any environment's vars from inside the
  tab, not only the header-selected active one.
- **`.env` precedence = nearest folder wins**, root `.env` is the base fallback
  (consistent with `variables`).
- **`Env` tab on folders only** - requests have no directory, so no `.env`; requests keep
  their current tabs unchanged.
- **Root `.env` stays as base, editor relocates to global Settings** - not dropped.

### Non-goals / deliberate boundaries

- No comment preservation for a **folder** `.env` edited through the key->value table
  (rows serialize to `KEY=value`). The **root** `.env` keeps a raw-text editor (in
  Settings) so its comments survive. `process.env.X` stays one level (dotted keys out of
  scope), matching today.
- No encryption / secret store; `.env` (gitignored) remains the secrets path.

## 2. Acceptance Criteria

### Per-folder `.env` - model, disk, resolution

- AC-001: `FolderNode` gains `dotenv?: string` (raw `.env` text). It serializes to
  `<folderdir>/.env` when non-empty and deserializes back into the folder node;
  round-trips through serialize/deserialize. An absent/empty `dotenv` writes no file.
- AC-002: Workspace read collects a `.env` at **any** folder depth into the FileMap; each
  folder `.env` populates its folder node's `dotenv`, and the root `.env` feeds the
  workspace base process env (as today).
- AC-003: `{{process.env.KEY}}` resolves along the request's folder chain: the nearest
  folder `.env` defining KEY wins, farther folders next, workspace-root `.env` is the base
  fallback. A request not inside any folder resolves only the root `.env`. A KEY defined in
  a folder `.env` does not leak to sibling folders.
- AC-004: On send, copy-as-cURL, and inside scripts (`requi.getProcessEnv`), the request's
  **folded** process env (AC-003) is what interpolates `{{process.env.KEY}}` across URL,
  header values, query-param values, auth values and body - recursively, unknown tokens
  left verbatim (existing interpolation behaviour preserved, only the env source changes).

### Folder `Env` tab UI

- AC-005: The folder config pane shows a new top-level **Env** tab whose body has a
  secondary sub-bar with two views: **Envs** and **.env**.
- AC-006: **Envs** view renders an env picker listing every environment name found in the
  tree (union) plus this folder's own env keys, with an affordance to add a new env name;
  selecting/adding one shows a key->value table bound to this folder's
  `config.environments[picked]`. Edits buffer into the folder draft.
- AC-007: **.env** view renders a key->value table bound to this folder's `dotenv`; rows
  parse from the dotenv text and edits rebuild it. Edits buffer into the folder draft.
- AC-008: Saving the folder pane (save shortcut / close-confirm) persists BOTH the config
  (including `environments`) AND the folder `dotenv` in a single tree write; the folder's
  dirty state reflects unsaved changes in either sub-view (or any other folder tab).

### Root `.env` relocation + token editing

- AC-009: The workspace-root `.env` is editable from a new **Env** section in the global
  Settings view; saving there writes the root `.env` and updates resolution. The old
  sidebar `.env` button and the dedicated `.env` content editor (`editTarget {kind:"env"}`)
  are removed.
- AC-010: Inline URL-bar token editing of a `{{process.env.KEY}}` value writes to the
  `.env` that **provided** the value (nearest folder defining it, else root), so the edit
  is never silently shadowed by a nearer folder's `.env`.

### Safety

- AC-011: A tree write (config edit, move, rename, delete) never deletes a `.env` it did
  not intend to: the root `.env` survives tree writes (still written via its own path),
  and folder `.env` files persist through serialize and are not removed by reconcile's
  managed-file filter.

## 3. User test cases

- TC-001 (folder env overrides root): root `.env` `TOKEN=root`; folder `api/.env`
  `TOKEN=api`; request `api/get` header `Authorization: Bearer {{process.env.TOKEN}}` ->
  `Bearer api`. A request at workspace root -> `Bearer root`. Maps to: AC-002/003/004.
- TC-002 (nearest folder wins, no sibling leak): `api/.env` `TOKEN=api`,
  `api/v2/.env` (no TOKEN); request in `api/v2` -> `api` (inherited). A sibling `web/get`
  with no `.env` and no root TOKEN -> token left verbatim. Maps to: AC-003.
- TC-003 (round-trip): a folder with `dotenv = "A=1\nB=2"` serializes to `<dir>/.env`,
  deserializes back into `dotenv`; re-serialize is byte-identical. Empty dotenv -> no file.
  Maps to: AC-001.
- TC-004 (Env tab Envs view): open a folder's Env tab -> Envs; pick `prod`; edit
  `baseUrl=https://api`; save -> folder `config.environments.prod.baseUrl` persists. Add a
  new env `qa` -> table edits `config.environments.qa`. Maps to: AC-005/006/008.
- TC-005 (Env tab .env view): folder Env tab -> .env; add row `KEY=secret`; save -> folder
  `<dir>/.env` written with `KEY=secret`; a request under it resolves
  `{{process.env.KEY}}` -> `secret`. Maps to: AC-007/008/003.
- TC-006 (root .env in Settings): open Settings -> Env section; edit root `.env`; save ->
  root `.env` written, resolution updated. Sidebar has no `.env` button. Maps to: AC-009.
- TC-007 (token edit targets owner): root `TOKEN=root`, `api/.env` `TOKEN=api`; in an `api`
  request URL, inline-edit the `{{process.env.TOKEN}}` chip to `api2` -> `api/.env` updated
  (not root), and resolution shows `api2`. Maps to: AC-010.
- TC-008 (no accidental deletion): with a folder `.env` and a root `.env` present, rename a
  DIFFERENT folder -> both `.env` files still on disk after the tree write. Maps to: AC-011.

## 4. UI States

| State            | Behavior                                                                 |
| ---------------- | ------------------------------------------------------------------------ |
| Env tab default  | Sub-bar defaults to "Envs"; if no environments anywhere, picker is empty with an "add env" affordance only. |
| Envs - no env    | No env selected/none exist -> empty-state prompt to pick or add an env; table hidden. |
| Envs - selected  | Key->value table bound to `config.environments[picked]`.                 |
| .env - empty     | Empty key->value table (one blank add-row), folder has no `.env` yet.    |
| .env - populated | Rows parsed from folder `dotenv`.                                        |
| Settings Env     | Raw-text editor for root `.env` (comments preserved), saved via save shortcut. |

### Wireframe - folder pane with Env tab

```
+--------------------------------------------------------------+
| Vars  Auth  Headers  Params  Script  [Env]  Settings         |
+--------------------------------------------------------------+
| [ Envs ] [ .env ]                                            |
| Env: [ prod        v ]  [ + new env ]                        |
| +----------------------+-----------------------------------+ |
| | baseUrl              | https://api.example.com           | |
| | token                | {{process.env.TOKEN}}             | |
| | + add row            |                                   | |
| +----------------------+-----------------------------------+ |
+--------------------------------------------------------------+
```

`.env` sub-view (same shell, sub-bar `.env` active):

```
+--------------------------------------------------------------+
| [ Envs ] [ .env ]                                            |
| +----------------------+-----------------------------------+ |
| | KEY                  | secret                            | |
| | + add row            |                                   | |
| +----------------------+-----------------------------------+ |
+--------------------------------------------------------------+
```

## 5. Data model

```ts
// src/lib/workspace/model.ts
type FolderNode = {
  kind: "folder";
  id: string;
  name: string;
  config: ConfigScope;
  dotenv?: string;        // NEW: raw .env text for this folder
  children: TreeNode[];
};

// src/lib/workspace/resolve.ts
type Scope = { id: string; name: string; config: ConfigScope; dotenv?: string };
// resolveProcessEnv folds the request's scope chain over the root base.
function resolveProcessEnv(
  tree: TreeNode[],
  requestId: string,
  rootEnv: ProcessEnv,
): ProcessEnv;                                   // nearest folder wins, root is base
function resolveProcessEnvProvenance(
  tree: TreeNode[],
  requestId: string,
  rootEnv: ProcessEnv,
): Record<string, { value: string; scopeId: string | null }>;  // scopeId null = root
```

On-disk:

```
<workspace>/
  requi.workspace.json
  .env                 ROOT base (KEY=value, gitignored) - editor in Settings
  api/
    folder.json        { name, config: { environments: {...} }, order }
    .env               FOLDER override (NEW) - editor in folder Env > .env tab
    get.req.json
```

`resolveProcessEnv` reuses `findScopePath` (already in `resolve.ts`); each folder scope
contributes `parseDotenv(scope.dotenv)`; folding order is root (base) -> farthest folder
-> nearest folder (nearest wins). The flat result replaces the workspace-level `processEnv`
passed into `buildHttpRequest` / scripts / token preview for that request.

## 6. Edge cases

- Folder with no `.env` -> contributes nothing; resolution falls back to ancestors/root.
- Same KEY in folder + root -> folder wins for requests under it; siblings unaffected.
- Request at workspace root (no folder) -> only root `.env` resolves.
- Folder `.env` edited via key->value table -> serialized as `KEY=value` lines; comments
  in a hand-written folder `.env` are not preserved once edited through the table.
- Empty folder `dotenv` -> no file emitted; an existing folder `.env` that becomes empty is
  left on disk (not auto-removed; reconcile's managed-file filter never targets `.env`).
- Folder rename/move -> the `.env` moves with the folder's serialized output to the new
  dir; the stale path is not force-removed (orphan tolerated, matches "never delete .env").
- Unknown `{{process.env.MISSING}}` -> left verbatim (unchanged).
- Token inline-edit of a process.env value whose key exists nowhere -> writes to root
  (no owner to target).

## 7. Dependencies

- No new npm/Rust dependency (dotenv parse/merge already hand-rolled in `environment.ts`).
- README/CLAUDE/docs: document per-folder `.env`, the folder `Env` tab, root `.env` in
  Settings, and `{{process.env.KEY}}` nearest-folder precedence. ADR: per-folder `.env`
  precedence + root-as-base + editor relocation.
```

