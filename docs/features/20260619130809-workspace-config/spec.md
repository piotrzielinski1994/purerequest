# Spec: Workspace Config - Persistence, Inheritance & Resolution

**Version:** 0.1.0
**Created:** 2026-06-19
**Status:** Draft

## 1. Overview

Give a workspace real on-disk persistence with hierarchical config that a request
**resolves** by inheriting from its folder chain. This is the second of two persistence
features (the first - per-installation UI settings - is already merged). The two never
mix: install settings live in the app-config dir; **workspace config lives in a folder
the user picks** and can be saved/imported anywhere.

Three config scopes (from the request):
1. **per-request** - a request's own config (its overrides + request-specific data).
2. **per-folder / per-subfolder** - a folder carries config that everything beneath it
   inherits; a subfolder (or request) **overrides on conflict** and inherits the rest.
3. **per-installation** - already shipped (`20260619115209-user-settings`); out of scope.

What this feature delivers:
- A config model: every folder and request carries a `ConfigScope` (variables, headers,
  params, auth, scripts, timeout) where each field is optional - **undefined = inherit**.
- **Resolution**: for a request, fold the config of `root -> ... -> parent -> request`
  into one `EffectiveConfig`, child overriding parent per merge rules, **with provenance**
  (each resolved value knows which scope it came from).
- An on-disk **directory-tree mirror** format (folder = directory, request = file,
  per-folder config file) and a pure `deserialize` (disk -> tree) + pure `serialize`
  (tree -> disk file map; kept for round-trip tests and a future save, **not wired to any
  write path**).
- A **read-only** `WorkspaceFs` **port** (read a workspace folder) with a Tauri adapter
  (`fs` plugin) and an in-memory fake for tests.
- **Load on launch**: the workspace folder is pointed to by a hand-edited `workspacePath`
  field in the per-installation `settings.json` (the file from feature 1). On launch the
  app reads that folder and the sidebar tree reflects it; if unset/invalid, an empty state.
- A read-only **Effective config** view (new tab in the request pane) for the active
  request showing resolved values + provenance.

What this feature does **not** deliver:
- **No in-app editing** of config. Config is authored by hand-editing the workspace files
  (Bruno-style). The app reads, resolves, and displays it.
- **No save / write-to-disk and no folder picker.** The workspace is managed by hand
  (edit the JSON files; set `workspacePath` by hand). A command palette + keybindings
  feature will later add Open/Save actions - same deferral as the console toggle in
  feature 1. `serialize` exists as a pure function but nothing calls a disk write.
- No environments layer (prod/staging switching). Only folder/request-scoped variables.
  `EnvSelector` stays mock. (Deferred.)
- No variable **substitution** into URLs/bodies at send time (there is no HTTP yet).
  Resolution computes the effective variable *map*; using it to expand `{{baseUrl}}` is
  future work.
- No secret encryption. Secrets (auth tokens, passwords, variable values) are stored
  **plaintext** inline; see §6 and §9.
- No drag-to-reorder, rename, or move in the tree.

### User Story

As a developer, I want to open a workspace folder whose folders and requests carry
inheritable config, so that a deeply nested request automatically picks up its parents'
variables/headers/auth and I can see the effective config (and where each value came
from), and I can save that workspace anywhere or import one from anywhere.

## 2. Data Model

### In-memory (extends the existing tree in `mock-data.ts`)

```ts
type HttpMethod = "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
type KeyValue = { key: string; value: string };

// "inherit" is the new default: defer to the nearest ancestor that sets auth.
type Auth =
  | { type: "inherit" }
  | { type: "none" }
  | { type: "bearer"; token: string }
  | { type: "basic"; username: string; password: string };

// The inheritable config a folder or request contributes. Every field optional:
// absent/empty contributes nothing; a present value participates in the merge.
type ConfigScope = {
  variables?: Record<string, string>;
  headers?: KeyValue[];
  params?: KeyValue[];
  auth?: Auth;                          // undefined or {inherit} = inherit
  scripts?: { pre?: string; post?: string };
  timeoutMs?: number;                   // undefined = inherit
};

type FolderNode = {
  kind: "folder";
  id: string;                           // path-derived, stable
  name: string;
  config: ConfigScope;
  children: TreeNode[];
};

type RequestNode = {
  kind: "request";
  id: string;
  name: string;
  method: HttpMethod;                   // request-specific (never inherited)
  url: string;                          // request-specific
  body: string;                         // request-specific
  config: ConfigScope;                  // the request's own overrides
  response?: RequestResponse;           // runtime/mock only; NOT persisted
};

type TreeNode = FolderNode | RequestNode;
```

> Migration note: the current `RequestNode` keeps `params`/`headers`/`auth`/`scripts`
> as flat fields. They move under `config`. `mock-data.ts` and the layout panels/tests
> that read them are updated accordingly (the layout spec already declared mock data
> throwaway).

### Resolved output (provenance kept, à la pricing `ComponentBreakdown`)

```ts
type Provenance = { scopeId: string; scopeName: string }; // folder id / request id

type ResolvedValue<T> = { value: T; from: Provenance };

type EffectiveConfig = {
  variables: Record<string, ResolvedValue<string>>;
  headers: Record<string, ResolvedValue<string>>;   // keyed by header name
  params: Record<string, ResolvedValue<string>>;
  auth: ResolvedValue<Auth>;                          // resolved, never "inherit"
  scripts: { pre: ResolvedValue<string>; post: ResolvedValue<string> };
  timeoutMs: ResolvedValue<number>;
};
```

### Merge rules (fold `root -> ... -> request`; later scope = child)

| Config | Rule | Conflict |
|--------|------|----------|
| `variables` | per-key merge | child key replaces same parent key; others kept |
| `headers` | per-name merge (name compared case-insensitively) | child replaces same name; others kept |
| `params` | per-key merge (case-sensitive) | child replaces same key; others kept |
| `auth` | nearest-defined wins | nearest non-`inherit`/non-undefined scope; default `{none}` if none set |
| `scripts.pre` / `.post` | nearest-defined wins, independently | a defined value (incl. `""`) overrides; `undefined` inherits |
| `timeoutMs` | nearest-defined wins | default unset -> a documented system default |

### On-disk format (directory-tree mirror)

```
<workspace-root>/
  purerequest.workspace.json          { "schemaVersion": 1, "name": "My API" }
  <folder-slug>/
    folder.json                 { "name": "...", "config": { ... } }
    <request-slug>.req.json      { "name": "...", "method": "...", "url": "...",
                                   "body": "...", "config": { ... } }
    <subfolder-slug>/ ...
  <request-slug>.req.json        (root-level request)
```

- `purerequest.workspace.json` marks a directory as a workspace (its presence = importable).
- A folder's config lives in a reserved `folder.json`; everything else in the directory
  is a child (`*.req.json` = request, sub-directory = folder).
- **Identity**: `id` is derived from the path on load (stable across reloads). On save,
  the path is derived from `slug(name)`; a load->save->load round-trip is stable.
- **Ordering**: children sort folders-first then by `name` (MVP). Explicit ordering
  (`seq`) is a documented future addition.
- **Secrets**: stored plaintext inline (see §9).

## 3. Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | `resolveConfig(tree, requestId)` returns an `EffectiveConfig` folding the request's folder chain root->request | Must |
| AC-002 | A child scope overrides a parent on key conflict (variable, header, param) and inherits non-conflicting keys | Must |
| AC-003 | `auth` resolves to the nearest ancestor/own scope whose auth is not `inherit`; `{none}` if no scope sets it | Must |
| AC-004 | `scripts.pre` and `scripts.post` resolve independently to the nearest scope that defines each; `timeoutMs` to the nearest defined value | Must |
| AC-005 | Every resolved value carries provenance (the id+name of the scope it came from) | Must |
| AC-006 | Resolution works for a request nested >= 3 folders deep with overrides at multiple levels | Must |
| AC-007 | Serializing a tree to the disk format then deserializing it yields an equivalent tree (round-trip), ids stable | Must |
| AC-008 | Deserializing a workspace folder builds the tree: directories -> folders (config from `folder.json`), `*.req.json` -> requests | Must |
| AC-009 | A directory without `purerequest.workspace.json` is rejected as "not a workspace"; a malformed `folder.json`/request file fails that node gracefully without crashing the load | Must |
| AC-010 | All disk access goes through the `WorkspaceFs` port; the suite runs against an in-memory fake (no Tauri) | Must |
| AC-011 | On launch, if `settings.json` has a valid `workspacePath`, the app reads that folder and the sidebar tree reflects it (replacing mock data) | Must |
| AC-012 | `serialize(tree)` produces a disk file map that `deserialize` reads back to an equivalent tree (round-trip); no disk write is wired (deferred) | Must |
| AC-013 | When `workspacePath` is unset, invalid, or not a workspace, the sidebar shows an empty state; no mock tree is auto-loaded | Must |
| AC-014 | The active request shows a read-only Effective config view (request-pane tab) listing resolved variables/headers/auth with provenance | Must |
| AC-015 | `npm run lint`, `npm run typecheck`, `npm test`, and `cargo test` exit 0 | Must |

## 4. User Test Cases

- **TC-001 (happy path, resolution):** tree with root folder var `baseUrl=prod`, subfolder
  override `baseUrl=stg`, request under subfolder -> effective `baseUrl=stg`, provenance =
  subfolder; a root-only var is inherited with provenance = root. (AC-001,002,005,006)
- **TC-002 (auth inherit):** folder sets bearer; request auth `{inherit}` -> effective auth
  = folder's bearer, provenance = folder. Request sets `{none}` -> effective `{none}`. (AC-003)
- **TC-003 (scripts/timeout):** root sets `pre`, request sets `post` -> effective pre from
  root, post from request; timeout from nearest setter. (AC-004)
- **TC-004 (round-trip):** serialize a 3-deep tree, deserialize -> structurally equal; reload
  ids identical. (AC-007)
- **TC-005 (load from fake FS):** seed the in-memory FS with a workspace layout -> deserialize
  -> tree matches; header/var config read from `folder.json`. (AC-008,010)
- **TC-006 (not a workspace / corrupt):** FS dir without `purerequest.workspace.json` -> error
  result, no throw; one malformed `*.req.json` -> that request skipped/flagged, rest load. (AC-009)
- **TC-007 (load on launch):** settings `workspacePath` set to a folder seeded in the fake
  FS -> on mount the tree renders the loaded workspace; `workspacePath` unset -> empty
  state, no mock tree. (AC-011,013)
- **TC-008 (round-trip):** `serialize(tree)` then `deserialize` -> structurally equal tree;
  no write path invoked. (AC-012)
- **TC-009 (effective view):** select a nested request -> effective-config tab lists
  resolved values + provenance. (AC-014)

## 5. UI States

ASCII wireframes are in the message presenting this spec (UI gate). Summary:

| State | Behavior |
| ----- | -------- |
| No `workspacePath` | Sidebar shows empty state ("No workspace - set workspacePath in settings.json"); panes neutral empty state. No mock tree. |
| Loading | `workspacePath` set; reading from disk on launch; brief - tree placeholder. |
| Loaded | Tree reflects the workspace; selecting a request shows its resolved Effective config (new request-pane tab). |
| Load error | "Not a workspace" / read failure -> empty state with the error message; no crash. |
| Partial load | Some node malformed -> it is skipped and surfaced (console line / marker); the rest loads. |

## 6. Architecture

Hexagonal, mirroring the settings feature:
- **Pure domain** (no IO): `ConfigScope`, `resolveConfig(tree, requestId) -> EffectiveConfig`
  (the fold + merge rules + provenance), and pure `serialize(tree) -> FileMap` /
  `deserialize(FileMap) -> Result<Tree>` over a virtual file map (`Record<path, string>`).
  `serialize` exists for round-trip tests + a future save; no write path calls it yet.
- **Port** (read-only for now): `WorkspaceFs` = `{ readWorkspace(rootPath) -> Result<FileMap> }`
  (reads the managed files under a root into the virtual file map). In-memory fake for
  tests; Tauri adapter using `@tauri-apps/plugin-fs` for the app. No write/picker method
  (deferred with Save).
- **Provider**: a workspace store/provider that, on launch, reads `workspacePath` from
  settings, calls the port, deserializes, and exposes the loaded tree + the active
  request's resolved config to the existing sidebar/panes. Empty state when no/invalid path.
- **ADT over exceptions**: load/parse return `Result`-style values, never throw across the port.

Build order = layers: (1) model + resolution (pure), (2) serialize/deserialize (pure),
(3) read-only fs port + fake + Tauri adapter, (4) UI wiring (load-on-launch from
`workspacePath` / empty state / effective-config tab). Each layer is independently
testable; layers 1-3 run fully under jsdom/node.

## 7. Edge Cases

| # | Case | Handling |
|---|------|----------|
| E-1 | Request at root (no parent folder) | Resolution = request scope over defaults; provenance = request/defaults |
| E-2 | Conflicting var at 3 levels | Nearest (deepest) wins; provenance = that level |
| E-3 | Folder sets auth, request `{inherit}` | Effective = folder auth (AC-003) |
| E-4 | No scope sets auth/timeout | Defaults: auth `{none}`, timeout documented default; provenance = "default" |
| E-5 | Header name case differs (`Accept` vs `accept`) | Merge by case-insensitive name; deepest wins; original casing of winner kept |
| E-6 | Dir missing `purerequest.workspace.json` | Not-a-workspace error result |
| E-7 | Malformed `folder.json` / `*.req.json` | Node skipped + surfaced; load continues (AC-009) |
| E-8 | Two children slug-collide on save | Disambiguate slug (suffix) so no overwrite; deterministic |
| E-9 | Empty workspace (only manifest) | Loads an empty tree; valid |
| E-10 | `workspacePath` points to a non-existent dir | Not-a-workspace / read-error result -> empty state, no crash |

## 8. Dependencies

New:
- npm: `@tauri-apps/plugin-fs`.
- Cargo: `tauri-plugin-fs`, registered in `lib.rs`.
- Capabilities: `fs` read permission in `src-tauri/capabilities/default.json` (scope must
  allow reading the user-configured `workspacePath` - see Infra Prerequisites).
- `Settings` model (feature 1) gains an optional `workspacePath: string`.

Reused: existing tree/sidebar/`WorkspaceProvider`; the settings hexagonal pattern +
`SettingsProvider` (source of `workspacePath`).

No `dialog` plugin (no folder picker - deferred with Save).

## 9. Infrastructure Prerequisites

| Category | Requirement |
|----------|-------------|
| Tauri fs plugin scope | `fs` plugin must permit **reading** the absolute path configured in `workspacePath`. Confirm the v2 scope config (likely a broad read scope or `$HOME`-relative) since the path is user-arbitrary. |
| Secrets | Workspace files store auth tokens/passwords/variable values **plaintext**. Document so users gitignore secrets or treat workspaces as sensitive. No secret store provisioned. |
| Settings field | `workspacePath` is hand-edited into `settings.json`; document its location + format. |

Verification before implementation: confirm `tauri-plugin-fs` compiles and the capability
lets the app read a user-configured folder (the settings feature already proved the
plugin+capability+cargo-build loop).

## 10. Out of Scope

- Save / write-to-disk; folder picker / Open action (deferred to a command-palette
  feature); in-app config editing; environments layer; `{{var}}` substitution at send
  time; secret encryption / separate secrets file; tree reorder/rename/move; explicit
  child ordering (`seq`).

## 11. Revision History

| Version | Date | Change |
|---------|------|--------|
| 0.1.0 | 2026-06-19 | Initial draft |
