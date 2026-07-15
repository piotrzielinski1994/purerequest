# Token popup edit: drill to the real value source

Branch: `20260715125221-token-popup-edit-drill-to-source`

## Overview

When you hover a `{{var}}` chip in a request/folder view, the popup shows the variable's
**fully-resolved** value in an editable input. Committing an edit currently writes the new
value straight to the **nearest scope that defines the variable** (`preview.target`). That is
wrong when the nearest row is not the real value but a **pointer to another location**.

Concrete case: an `as24` folder defines a config variable

```
CUSTOMER_ID = {{process.env.CUSTOMER_ID}}
```

which pulls the actual value from the **global `.env`** (`CUSTOMER_ID=orig`). Hovering
`{{CUSTOMER_ID}}` in a request shows `orig`. Editing it to `new` today overwrites the folder
row, turning it into the literal `CUSTOMER_ID = new` and destroying the reference to `.env`.

Desired: the inline edit **drills through the reference chain to where the actual literal
value lives** and writes there. In the example, the folder row stays `{{process.env.CUSTOMER_ID}}`
and the **global `.env`** `CUSTOMER_ID` becomes `new`. The drill follows multiple hops and
also follows pointers held in environment blocks, stopping at the first row whose value is a
real literal (not a single-token reference) - or at the `.env` key when the terminal is a
`{{process.env.KEY}}` pointer.

Scope (per grilled decisions): only the **inline-edit write** drills. The pencil "go to
source" button is unchanged - it still jumps to the nearest scope that defines the variable
(the pointer row's Vars/Envs view).

## Approach

The popup already resolves the whole chain into an `EffectiveConfig` and, per token, a
`TokenPreview` carrying `value` (resolved), `rawValue` (the row's stored string), and `target`
(the nearest defining row - used by both the write and the pencil today). Because
`EffectiveConfig.variables[name]` already encodes the nearest-wins fold **and** each entry's
raw value + provenance + origin (`variable` vs `environment`), the reference chain can be
walked purely over `(effective, processEnv, environment)` - no tree walk needed.

Two pure-function pieces + a two-line component rewire:

1. `src/components/workspace/url-token.ts`
   - `pureRefInner(value)` - the inner token name iff `value` is a single, pure `{{token}}`
     reference (only whitespace around it); else `null`. Mirrors `processEnvRefKey` in
     `lib/scripts/var-write.ts` but for **any** token, not just `process.env.`.
   - `resolveWriteTarget(name, effective, processEnv, environment)` - walks the reference
     chain from `name` and returns the **terminal** `TokenTarget`: a `dotenv` target when a hop
     is `{{process.env.KEY}}`, an `environment`/`variable` target at the first literal row, and
     falls back to `name`'s own row for a dead-end (pointer to an undefined var) or a reference
     cycle. A non-pure value (`{{a}}{{b}}`, `{{a}}/v1`) is a literal terminal - no drill.
   - `TokenPreview` gains `writeTarget: TokenTarget`. `resolveTokenPreview` populates it via
     `resolveWriteTarget` for `variable`/`environment` tokens; for a directly-hovered
     `process.env.` token and for a path token, `writeTarget === target` (no indirection to
     follow).
2. `src/components/workspace/var-token.tsx`
   - `TokenValueEditor.commit` writes to `preview.writeTarget` (was `preview.target`).
   - The pencil "go to source" button keeps `preview.target` - unchanged behavior.

No change to `setTokenValue` / `tokens.ts` / `send.ts` / `var-write.ts`: `setTokenValue`
already handles a `dotenv` target by routing to the owning folder/root `.env`
(`resolveProcessEnvProvenance`), and an `environment`/`variable` target by upserting that row.
The drill only chooses **which** target, reusing all existing write plumbing.

## Acceptance criteria

- **AC-001**: `pureRefInner(value)` returns the trimmed inner token name iff `value` is exactly
  one `{{token}}` with only surrounding whitespace (`"{{ x }}"` -> `"x"`,
  `"{{process.env.K}}"` -> `"process.env.K"`); returns `null` for a literal, an empty string, a
  value with text around the token (`"{{a}}/v1"`), or two tokens (`"{{a}}{{b}}"`).
- **AC-002**: For a variable whose nearest row holds a **real literal**, `resolveWriteTarget`
  returns that row's target - identical to the current `target` (`variable` or `environment`
  kind, correct `scopeId`/`env`/`name`). No behavior change for the literal case.
- **AC-003**: For a variable whose nearest row is a pure `{{process.env.KEY}}` pointer,
  `resolveWriteTarget` returns `{ kind: "dotenv", key: "KEY" }` (regardless of whether the
  variable also resolves through a folder or root `.env`).
- **AC-004**: For a variable whose nearest row is a pure `{{other}}` pointer to another
  variable, `resolveWriteTarget` returns `other`'s terminal target, following **multiple hops**
  (`a -> {{b}} -> {{process.env.K}}` yields `{ kind: "dotenv", key: "K" }`; `a -> {{b}} -> literal`
  yields `b`'s row target).
- **AC-005**: The drill follows a pointer that resolves through an **environment block**: a
  variable `a = {{host}}` where `host` is defined (as a literal) only in the active environment
  block yields an `{ kind: "environment", scopeId, env, name: "host" }` target.
- **AC-006**: For a pointer to an **undefined** variable (`a = {{missing}}`, `missing`
  unresolved) or a **reference cycle** (`a = {{b}}`, `b = {{a}}`), `resolveWriteTarget` falls
  back to `a`'s own row target (never loops, never throws).
- **AC-007**: `resolveTokenPreview` exposes `writeTarget` on every non-null preview;
  `writeTarget === target` for a directly-hovered `process.env.` token and for a path-param
  token.
- **AC-008**: In a request view, editing `{{CUSTOMER_ID}}` in the popup (folder row
  `CUSTOMER_ID = {{process.env.CUSTOMER_ID}}`, global `.env` `CUSTOMER_ID=orig`) writes the new
  value to the **global `.env`** and leaves the folder row unchanged; re-hovering shows the new
  value.

## Test cases

- **TC-001** (AC-001): `pureRefInner("{{ x }}") === "x"`, `pureRefInner("{{process.env.K}}") ===
  "process.env.K"`, and `pureRefInner` returns `null` for `"lit"`, `""`, `"{{a}}/v1"`,
  `"{{a}}{{b}}"`, `"x {{a}}"`.
- **TC-002** (AC-002): literal folder var `suffix = "/v1"` -> `resolveWriteTarget("suffix", ...)`
  deep-equals `{ kind: "variable", scopeId: "root", name: "suffix" }` (== current `target`).
- **TC-003** (AC-003): folder var `CUSTOMER_ID = "{{process.env.CUSTOMER_ID}}"` with
  `processEnv={CUSTOMER_ID:"orig"}` -> `{ kind: "dotenv", key: "CUSTOMER_ID" }`.
- **TC-004** (AC-004): `a = "{{b}}"`, `b = "{{process.env.K}}"`, `processEnv={K:"v"}` ->
  `{ kind: "dotenv", key: "K" }`; and `a = "{{b}}"`, `b = "lit"` -> `{ kind: "variable",
  scopeId, name: "b" }`.
- **TC-005** (AC-005): `a = "{{host}}"` (plain, root), `host` a literal only in env `prod` ->
  with `environment: "prod"`, `{ kind: "environment", scopeId: "root", env: "prod", name:
  "host" }`.
- **TC-006** (AC-006): `a = "{{missing}}"` -> target for `a`; `a = "{{b}}"`, `b = "{{a}}"` ->
  target for `a`. Neither throws / hangs.
- **TC-007** (AC-007): `resolveTokenPreview("process.env.TOKEN", ...)` -> `writeTarget` deep-
  equals its `target` (`{ kind: "dotenv", key: "TOKEN" }`); a path preview -> `writeTarget ===
  target`.
- **TC-008** (AC-008, integration): render `UrlBar` for a request under a folder with
  `variables: [{ CUSTOMER_ID: "{{process.env.CUSTOMER_ID}}" }]` and provider `processEnv={
  CUSTOMER_ID: "orig" }` + an `onEnvChange` spy. Hover `{{CUSTOMER_ID}}` (input shows `orig`),
  clear + type `new` + Enter. Assert: `onEnvChange` called with text containing
  `CUSTOMER_ID=new`; re-hover shows `new`; opening the folder Vars still shows the row value
  `{{process.env.CUSTOMER_ID}}` (pointer intact).

## UI States

| State   | Behavior                                                                             |
| ------- | ------------------------------------------------------------------------------------ |
| Loading | N/A - resolution is synchronous over the in-memory tree.                             |
| Empty   | Unresolved token -> "unresolved" hint, no input (unchanged); no write target needed. |
| Error   | N/A - no async/IO in the popup write path.                                           |
| Success | Input seeded with the resolved value; commit writes to the drilled terminal source.  |

(No visual change: the popup layout, colors, copy, and pencil are identical. Only the write
**destination** changes.)

## Data model

No on-disk change. One in-memory type gains a field:

```ts
type TokenPreview = {
  value: string;
  rawValue: string;
  source: string;
  kind: TokenKind;
  target: TokenTarget;      // nearest defining row (pencil "go to source")
  writeTarget: TokenTarget; // NEW: terminal source the inline edit writes to
};
```

`TokenTarget` is unchanged (`variable | environment | dotenv | path`).

## Edge cases

- **Literal nearest row** -> `writeTarget === target`; current behavior preserved (AC-002).
- **Pure `{{process.env.KEY}}` pointer** -> drills to the `.env` key; `setTokenValue`'s dotenv
  branch routes to the **owning** folder `.env` or the root `.env` via provenance (AC-003).
- **Multi-hop var -> var -> .env / literal** -> follows every hop to the terminal (AC-004).
- **Pointer resolved via an environment block** -> terminal is an `environment` target
  (AC-005).
- **Pointer to an undefined var / reference cycle** -> falls back to the hovered var's own row
  (overwrite, the current behavior); a `visited` set breaks cycles (AC-006).
- **Non-pure reference** (`{{a}}/v1`, `{{a}}{{b}}`, `{{a}} {{b}}`) -> treated as a literal
  terminal (writing the interpolated result into that row is the only sensible target); no
  drill.
- **Directly-hovered `{{process.env.X}}` token** -> already a dotenv target; `writeTarget ===
  target` (AC-007), routed to owning/root `.env` (unchanged).
- **Path-param token (`:name`)** -> request-owned value; no drill, `writeTarget === target`
  (AC-007).
- **Pencil "go to source"** -> uses `target`, not `writeTarget`; still lands on the folder that
  holds the pointer row (unchanged, per grilled scope decision).

## Dependencies

- Existing: `EffectiveConfig`/provenance from `lib/workspace/resolve.ts`, `interpolate`, the
  `TokenTarget` union, `setTokenValue`'s dotenv/environment/variable routing, the
  `HoverCard`-based popup. No new packages.
