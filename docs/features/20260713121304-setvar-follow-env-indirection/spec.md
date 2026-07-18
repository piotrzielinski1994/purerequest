# Spec: `setVar` follows `{{process.env.X}}` indirection to its `.env` source

**Version:** 0.1.0
**Created:** 2026-07-13
**Status:** Draft

## 1. Overview

Today a script `purerequest.setVar(name, value)` (and its `bru.*`/`pm.*` aliases) persists by
overwriting the **row value** of the nearest scope whose `config.variables` already defines
`name` (see `var-write.ts` `findVarWriteTarget` + `setNodeVar`). The write matches on **key
name only** and never inspects the existing value.

That breaks the common token-refresh pattern. A folder variable row often holds a **pointer**
to a `.env` secret, e.g.

```
BEARER_TOKEN = {{process.env.BEARER_TOKEN}}
```

with the real value living in the collection `.env` (`.pzielinski/settings/collection/.env`).
When a post-response script does `bru.setVar("BEARER_TOKEN", "<jwt>")`, the current code
**overwrites the pointer** with the literal JWT inside `folder.json`, discarding the
indirection. The user wants the opposite: the folder row stays untouched, and the app follows
the pointer to its real source (the owning `.env`) and writes the value there.

## 2. Behaviour / Acceptance criteria

- **AC-001** - When the nearest scope defining `name` holds a value that is a **pure, single**
  `{{process.env.KEY}}` reference (optional surrounding whitespace, nothing else), `setVar`
  MUST write `KEY=<value>` to the `.env` that **provides** `KEY` for this request (the owning
  scope from the process-env provenance fold), and MUST leave the `config.variables` row
  unchanged.
- **AC-002** - The target `.env` is resolved by process-env provenance (nearest folder `.env`
  defining `KEY`, else the workspace-root `.env`) - identical ownership rule to the existing
  token-reveal edit (`setTokenValue`, `dotenv` kind). Root owner (`scopeId === null`) writes the
  root `.env`; a folder owner writes that folder's `dotenv`.
- **AC-003** - If `KEY` is not yet present in any `.env`, it is appended to the resolved owner's
  `.env` (root when there is no folder owner). `setDotenvValue` already appends on miss.
- **AC-004** - A row value that is NOT a pure `{{process.env.X}}` reference keeps today's
  behaviour exactly: overwrite the `config.variables` row literally at the nearest defining
  scope, else create it on the request. This covers plain literals, `{{someOtherVar}}`
  pointers, and embedded/multi-token values like `Bearer {{process.env.X}}`.
- **AC-005** - Within-run reads stay correct: after `setVar`, a later `purerequest.getVar(name)` in the
  same script run returns the new value (the existing `runtimeVars` live-read path is unchanged;
  the indirection only changes the **persistence** target, not the in-run store).
- **AC-006** - Applies uniformly to `pre` and `post` stages, and to all aliases that map onto
  `purerequest.setVar` (`bru.setVar`, `pm.*.set`).

## 3. User test cases

- **TC-001** - Folder `identity` has var row `BEARER_TOKEN = {{process.env.BEARER_TOKEN}}` and a
  folder `.env` with `BEARER_TOKEN=old`. Post-script `bru.setVar("BEARER_TOKEN", res.getJson().access_token)`.
  -> folder `.env` now has the new JWT, `folder.json` var row still reads
  `{{process.env.BEARER_TOKEN}}`.
- **TC-002** - Same as TC-001 but the key lives only in the **root** `.env`, folder row still the
  pointer. -> root `.env` updated, folder row untouched.
- **TC-003** - Row value is a plain literal (`BEARER_TOKEN = old`). -> literal overwrite in
  `config.variables`, no `.env` write (unchanged legacy behaviour).
- **TC-004** - Row value is `Bearer {{process.env.BEARER_TOKEN}}` (embedded). -> treated as
  non-pure: literal overwrite of the row (legacy behaviour), `.env` untouched.
- **TC-005** - Pure pointer but `KEY` absent from every `.env`. -> appended to the resolved
  owner's `.env`.

## 4. Data model

No new persisted shape. Reuses:
- `config.variables: KeyValue[]` (unchanged path for the non-ref case).
- Folder `dotenv?: string` + root `envText`/`processEnv` (the `.env` write target).
- `ProcessEnvProvenance` (`resolveProcessEnvProvenance`) for owner resolution.
- `setDotenvValue` for the immutable dotenv text edit.

Introduces one pure classifier + a routed write target (var-target vs dotenv-target) so the
context layer can decide where a write lands.

## 5. Edge cases

- Pure-ref detection is exact: `^\s*{{\s*process.env.KEY\s*}}\s*$`. Anything with leading/trailing
  literal text, a second token, or a non-`process.env.` token is NOT pure -> legacy path.
- The **defining scope** of the row (where the pointer lives, from the var scope chain) and the
  **owning scope** of the `.env` key (from the process-env chain) can differ; the `.env` write
  targets the process-env owner (AC-002), matching how the value actually resolves at send time.
- Cyclic/self-referential pointers (`X = {{process.env.X}}` with `.env` also empty) still write
  the literal into `.env` under `X`; no recursion, single hop only.
- Nested indirection (`{{process.env.X}}` where the `.env` value is itself `{{...}}`) is out of
  scope - we only follow the single `process.env.` hop.

## 6. Dependencies

- `resolveProcessEnvProvenance`, `setDotenvValue`, `updateFolderDotenv`, root `saveEnv` - all
  already exist and are already used by `setTokenValue`.
- No Rust change, no new package.

## Scope

- **In:** route a `setVar` on a pure `{{process.env.KEY}}` row to the owning `.env`; leave the
  row untouched; keep legacy literal-overwrite for every other value.
- **Out:** following `{{otherVar}}` (non-`process.env`) indirection; multi-hop/nested resolution;
  writing to `config.environments` env-blocks; any new UI.
