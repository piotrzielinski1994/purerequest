# Spec: Variables & environments (Bruno-style)

**Version:** 0.2.0
**Created:** 2026-06-20
**Status:** Draft

## 1. Overview

Make `{{variable}}` resolution behave like Bruno. **Per-folder and per-request variables
already exist** (`config.variables`, folded root->leaf by `resolveConfig`, substituted in
`buildHttpRequest`). This feature adds the missing layers and fixes interpolation:

- **Environments** - named variable sets (`local`, `staging`, `prod`, …) defined **inside the
  existing folder/request config** as a new `config.environments` block (NOT dedicated env
  files). They inherit down the folder chain exactly like `variables`. One environment is
  active at a time, picked from the existing header **env selector**; the choice persists
  per-installation. The selector lists every environment name found anywhere in the tree.
- **`.env` file** - the ONE dedicated file: a dotenv at the workspace root, referenced as
  `{{process.env.KEY}}` (a distinct namespace, gitignored, the secrets path this round).
- **Precedence** - when the same `{{name}}` resolves from several places, the nearest scope
  wins (Request > nearer Folder > farther Folder); **within a single scope, a plain
  `variable` wins over that scope's active-environment block** (env fills only the keys the
  scope didn't set as a plain var). `{{process.env.KEY}}` is its own namespace.
- **Recursive interpolation** - a variable value may reference another variable (e.g. an env
  var `token: {{process.env.JWT}}`), resolved repeatedly until stable, with a cycle guard.
- **Interpolation coverage** - URL, header values, query-param values, auth values (bearer
  token, basic user/pass) and the request **body** are interpolated on send (today only URL +
  header/param values are, and only single-pass).

### Bruno parity boundaries (deliberate divergences)

- **Environments live in folder config, not separate files** (user directive). The only
  dedicated file is `.env`. This reuses the existing JSON config contract (ADR 2026-06-19) -
  `config.environments` round-trips through the existing opaque-`config` serialize/deserialize
  for free.
- **Active-env vs folder precedence** - folder/request override environment (Bruno's published
  precedence string). Additionally, within one scope a plain var overrides that scope's env
  block (user directive).
- **In-app editing (added in the addendum)** - the app edits a node's whole `config` as raw
  JSON (pencil on each sidebar row) and the `.env` as raw text (sidebar `.env` button), with
  explicit Save. Originally this feature only *selected* the active environment + resolved;
  the editing addendum (AC-012..016) reversed the "hand-edit on disk only" stance.
- **Secrets deferred** - no encrypted secret store; `.env` (gitignored) is the secrets path.
  Out of scope: `vars:secret`, OS keychain, runtime `bru.setVar`, prompt vars `{{?x}}`,
  dynamic `{{$timestamp}}` functions, nested object access `{{a.b}}` (beyond `process.env.X`).

## 2. Acceptance Criteria

### Environments in config + selection

- AC-001: A folder/request `config.environments` block (`{ envName: { var: value } }`) is
  parsed and round-trips through serialize/deserialize. Malformed/non-string entries are
  tolerated by the existing config handling (the node still loads).
- AC-002: The header env selector lists the union of every environment name found across the
  whole tree, plus a **No Environment** option; selecting one sets it active. With no
  `environments` blocks anywhere it shows just "No Environment".
- AC-003: The active environment persists per-installation (settings.json `activeEnvironment`);
  on reload the same environment is active. If the persisted name is no longer present
  anywhere in the tree, it falls back to No Environment.

### `.env`

- AC-004: A `.env` file at the workspace root is parsed (standard `KEY=value` lines, `#`
  comments and blank lines ignored, first `=` splits) into a `process.env` namespace.
- AC-005: `{{process.env.KEY}}` in any interpolated field resolves to that `.env` value;
  a bare `{{KEY}}` does **not** read `.env` (distinct namespace).

### Resolution + precedence

- AC-006: A request resolves `{{name}}` with precedence: nearest scope wins (Request > nearer
  Folder > farther Folder); within a scope a plain `variable` wins over that scope's
  active-environment block.
- AC-007: With no active environment, only plain request/folder variables resolve (the
  environment layer contributes nothing). Switching the active environment changes which value
  a bare `{{name}}` resolves to (for names supplied by an env block and not shadowed by a
  plain var).
- AC-008: The request pane's read-only **Effective** tab shows each resolved variable with its
  provenance; an environment-sourced value's provenance identifies the environment (e.g.
  `folderName (envName)`), a plain var's provenance is the scope name (as today).

### Interpolation on send

- AC-009: On send, `{{name}}` and `{{process.env.KEY}}` tokens are interpolated in the URL,
  header values, query-param values, auth values (bearer token; basic username/password) and
  the request body.
- AC-010: Interpolation is recursive - a variable whose value contains `{{other}}` (or
  `{{process.env.X}}`) is fully resolved - and terminates on cycles (a self/mutually
  referential variable is left unresolved rather than looping forever).
- AC-011: An unknown token (`{{missing}}` / `{{process.env.MISSING}}`) is left verbatim in the
  output (no throw, no empty-string surprise) - matching today's single-pass behavior.

## 3. User test cases

- TC-001 (env switch): root folder config `environments: { local: { baseUrl:
  "http://localhost:3000" }, prod: { baseUrl: "https://api.example.com" } }`; a request URL
  `{{baseUrl}}/get`. Select local -> send hits localhost; select prod -> hits api.example.com.
  Maps to: AC-001/002/007/009.
- TC-002 (persist): pick `prod`, reload -> `prod` still active. Pick a name no longer in the
  tree on next load -> No Environment. Maps to: AC-003.
- TC-003 (.env): `.env` with `TOKEN=abc123`; header `Authorization: Bearer
  {{process.env.TOKEN}}` -> sends `Bearer abc123`; bare `{{TOKEN}}` stays literal.
  Maps to: AC-004/005/009.
- TC-004 (precedence): env `local` block `{ host: "env-host" }` and a plain folder var
  `host: "folder-host"` in the SAME folder; request `{{host}}` -> `folder-host`. Remove the
  plain var -> `env-host`. A nearer folder's plain `host` beats a farther folder's env block.
  Maps to: AC-006.
- TC-005 (recursive): env `{ apiBase: "{{root}}/v1", root: "https://x.test" }`; `{{apiBase}}`
  -> `https://x.test/v1`. A cycle `a: "{{b}}", b: "{{a}}"` -> `{{a}}` left unresolved, no hang.
  Maps to: AC-010.
- TC-006 (effective tab): with `prod` active, the Effective tab lists `baseUrl` with
  provenance naming the `prod` environment. Maps to: AC-008.

## 4. UI States

(Env selector is the only new UI; the Effective tab already exists and just gains env rows.)

| State   | Behavior                                                                 |
| ------- | ------------------------------------------------------------------------ |
| Empty   | No environment names anywhere: selector shows only "No Environment".     |
| Loaded  | Selector lists every env name found in the tree + "No Environment".      |
| Active  | A colored dot + the active env name in the trigger; its vars resolve.    |
| Missing | Persisted active env absent from the tree -> falls back to No Environment.|

### Wireframe - env selector (sidebar header, replaces the mock)

```
+----------------------------------------+
| purerequest                    [ • prod  v ] |
+----------------------------------------+
```

Open:

```
                          +---------------+
                          | No Environment|
                          | • local       |
                          | • staging     |
                          | • prod      ✓ |
                          +---------------+
```

## 5. Data model

```ts
// src/lib/workspace/model.ts - ConfigScope gains:
type ConfigScope = {
  variables?: Record<string, string>;
  environments?: Record<string, Record<string, string>>;  // NEW: envName -> (var -> value)
  headers?: KeyValue[];
  // …unchanged…
};

// src/lib/workspace/environment.ts (new pure module)
function listEnvironmentNames(tree: TreeNode[]): string[];   // union across the tree, sorted
type ProcessEnv = Record<string, string>;
function parseDotenv(raw: string): ProcessEnv;               // KEY=value, # comments, blanks
```

On-disk (read-only inputs the app never writes back except existing config round-trip):

```
<workspace>/
  purerequest.workspace.json
  api/folder.json   { name, order, config: {
                        variables: { baseUrl: "https://default" },
                        environments: {
                          local: { baseUrl: "http://localhost:3000" },
                          prod:  { baseUrl: "https://api.example.com" }
                        } } }
  api/get.req.json  { name, method, url: "{{baseUrl}}/get", config: {} }
  .env              TOKEN=abc123      (KEY=value, # comments, gitignored)
```

Settings gains `activeEnvironment?: string` (active env name; absent/unknown = No Environment).

`resolveConfig(tree, requestId, options?: { environment?: string })` - when `environment` is
given, each scope in the folder chain contributes its `environments[environment]` entries
(provenance = environment) THEN its plain `variables` (provenance = scope, overriding the env
block within that scope); nearer scopes override farther. `buildHttpRequest(node, effective,
processEnv)` interpolates recursively over the resolved variable map + the `process.env`
namespace.

## 6. Edge cases

- No `environments` block anywhere / no `.env` -> empty name list / empty process.env;
  resolution works as today.
- Non-string env var values / malformed config -> tolerated by existing `config` parsing
  (node loads; bad entries simply don't resolve).
- `.env` lines without `=`, blank, or `#`-comment -> ignored; values keep `=` after the first.
- Persisted `activeEnvironment` not in the tree's name union -> No Environment (no crash).
- Recursive interpolation cycle (`a->b->a`, or `a->a`) -> token left unresolved, no loop.
- Unknown `{{name}}` / `{{process.env.MISSING}}` -> left verbatim.
- `{{process.env.KEY}}` only the single `process.env.` prefix is special-cased (one level;
  dotted keys out of scope).
- A move/tree-write must NOT delete `.env` (not app-managed output) - reconcile stays gated to
  tree files only (already true; `.env` isn't matched by `MANAGED_FILE`).
- "No Environment" selected -> environment layer contributes nothing.

## 7. Dependencies

- No new npm or Rust dependency (dotenv parsing + interpolation hand-rolled; environments are
  part of the existing JSON config; `.env` read through the existing `WorkspaceFs`).
- README: document `config.environments`, the env selector, `.env` + `{{process.env.X}}`,
  precedence, and gitignoring `.env`. ADR: precedence choice + environments-in-config + secrets
  deferral.
