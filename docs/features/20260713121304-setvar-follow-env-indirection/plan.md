# Plan: `setVar` follows `{{process.env.X}}` indirection to its `.env` source

**Spec:** [spec.md](./spec.md)

## Approach

A `setVar` currently persists by literal overwrite of a `config.variables` row
(`persistVarWrites` -> `findVarWriteTarget` + `setNodeVar`). Add a classifier that, when the
nearest defining row holds a **pure** `{{process.env.KEY}}` pointer, routes the write to the
`.env` that provides `KEY` (reusing the exact ownership + dotenv-edit path `setTokenValue`
already uses), leaving the row untouched. Every other value keeps today's literal-overwrite.

The in-run `runtimeVars` live-read store (`script-context.ts` `setVar`) is unchanged - only the
**persistence** target moves. So `getVar` within the same run still returns the fresh value.

## Task breakdown (TDD, red-first)

1. **`var-write.ts` - pure classifier (RED -> GREEN).**
   - `processEnvRefKey(value): string | null` - returns `KEY` iff `value` is a single pure
     `{{process.env.KEY}}` token (mirrors `interpolate.ts` lookup: pure-token regex, inner
     trimmed, `process.env.` prefix, non-empty key), else `null`.
   - `resolveVarWriteTarget(tree, requestId, name): VarWriteTarget` (ADT
     `{ kind: "config"; nodeId } | { kind: "dotenv"; key }`). Walks the var scope chain
     leaf-first (same as `findVarWriteTarget`); if the nearest defining row is a pure ref ->
     `{ kind: "dotenv", key }`, else `{ kind: "config", nodeId: findVarWriteTarget(...) }`.
   - Keep `findVarWriteTarget` + `setNodeVar` as-is (reused for the config case; their tests
     stay green).

2. **`workspace-context.tsx` - route `persistVarWrites` (RED -> GREEN).**
   - Fold writes into a `{ tree, envText }` accumulator via `resolveVarWriteTarget`:
     - `config` -> `setNodeVar` on the tree (unchanged behaviour).
     - `dotenv` -> resolve owner via
       `resolveProcessEnvProvenance(acc.tree, id, parseDotenv(acc.envText))[key]?.scopeId ?? null`;
       root owner (`null`) -> `setDotenvValue(acc.envText, key, value)`; folder owner ->
       `updateFolderDotenv` with `setDotenvValue(folder.dotenv, key, value)`.
   - After the fold: `persistTree(next.tree, "script")` iff the tree ref changed;
     `saveEnv(next.envText)` iff `envText` changed (root `.env` persists via `onEnvChange`).
   - Swap the `findVarWriteTarget` import for `resolveVarWriteTarget`.

## File changes

- `src/lib/scripts/var-write.ts` - add `processEnvRefKey`, `VarWriteTarget`,
  `resolveVarWriteTarget`.
- `src/lib/scripts/__tests__/var-write.test.ts` - add `processEnvRefKey` +
  `resolveVarWriteTarget` describes (pure vs embedded vs literal vs undefined).
- `src/components/workspace/workspace-context.tsx` - rework `persistVarWrites`, adjust import.
- `src/components/workspace/__tests__/setvar-env-indirection-context.test.tsx` - new
  integration test (folder `.env` + root `.env`, `onTreeChange` + `onEnvChange` spies).

## Acceptance verification

- TC-001/002 -> integration test asserts the owning `.env` (folder / root) gets the new value
  AND the `config.variables` pointer row is untouched.
- TC-003/004 -> unit `resolveVarWriteTarget` returns `config` for literals + embedded refs;
  integration confirms literal overwrite, no `.env` write.
- TC-005 -> `setDotenvValue` append-on-miss covered by an integration case (key absent from
  `.env`).
- `npm test` green (new + existing `var-write`, `scripts-send-loop`, `folded-process-env`).
