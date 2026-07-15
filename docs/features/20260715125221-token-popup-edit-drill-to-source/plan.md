# Plan: Token popup edit - drill to the real value source

Branch: `20260715125221-token-popup-edit-drill-to-source`
Coverage threshold: none enforced (checked `vitest.config.ts`, `package.json` - no threshold).

## File Structure

| File | Change | Responsibility |
| ---- | ------ | -------------- |
| `src/components/workspace/url-token.ts` | Modify | Add `pureRefInner` + `resolveWriteTarget` (pure chain walk); extract `variableTarget` helper; add `writeTarget` to `TokenPreview` and populate it in `resolveTokenPreview`/`resolvePathTokenPreview`. |
| `src/components/workspace/var-token.tsx` | Modify | `TokenValueEditor.commit` writes to `preview.writeTarget` (pencil keeps `preview.target`). |
| `src/components/workspace/__tests__/url-token.test.ts` | Modify (test) | Unit tests for `pureRefInner`, `resolveWriteTarget`, and `writeTarget` on previews (AC-001..007). |
| `src/components/workspace/__tests__/url-bar-token-hover.test.tsx` | Modify (test) | Integration TC-008: editing a `{{process.env}}`-pointer var writes the global `.env`, not the folder row (AC-008). |

No change to `tokens.ts`, `send.ts`, `var-write.ts`, `resolve.ts`, `model.ts` - the drill only
picks a target; existing `setTokenValue` routing (dotenv -> owning/root `.env`, environment/
variable -> row upsert) is reused unchanged.

## Approach & key decisions

- **Walk over `EffectiveConfig`, not the tree.** `effective.variables[name]` already carries
  the nearest-wins raw value + provenance + origin, so a purely-`(effective, environment)` walk
  reproduces the resolution chain with a cycle-guard. Pattern: recursive terminal-search with a
  `visited` set (same shape as `interpolate.ts`'s `resolveToken`).
- **`pureRefInner` generalizes `processEnvRefKey`** (`lib/scripts/var-write.ts`): that one only
  matches `{{process.env.KEY}}`; this matches any single pure `{{token}}` and returns the inner
  name, so a `process.env.` terminal is just an inner name with the known prefix.
- **`variableTarget` helper** collapses the env-suffix-stripping target construction currently
  inline in `resolveTokenPreview` (lines 54-69) so both `target` and each drilled hop build the
  target identically (pz-codebase-design: remove the duplication a second caller would create).
- **Dead-end / cycle falls back to the hovered var's own target** (overwrite = today's
  behavior) rather than the mid-chain node - threaded as a `fallback` arg.
- Pencil "go to source" unchanged (grilled decision: only the inline write drills).

### `resolveWriteTarget` shape (reference)

```ts
export function resolveWriteTarget(
  name: string,
  effective: EffectiveConfig,
  environment?: string,
): TokenTarget {
  const resolved = effective.variables[name];
  const fallback: TokenTarget = resolved
    ? variableTarget(name, resolved, environment)
    : { kind: "variable", scopeId: "default", name }; // unreachable from a non-null preview
  const walk = (current: string, visited: Set<string>): TokenTarget => {
    if (current.startsWith(PROCESS_ENV_PREFIX)) {
      return { kind: "dotenv", key: current.slice(PROCESS_ENV_PREFIX.length) };
    }
    if (visited.has(current)) return fallback;
    const row = effective.variables[current];
    if (!row) return fallback;
    const inner = pureRefInner(row.value);
    if (inner === null) return variableTarget(current, row, environment);
    return walk(inner, new Set(visited).add(current));
  };
  return walk(name, new Set());
}
```

## Edge cases (from spec)

Literal nearest row (no drill) · pure `{{process.env.KEY}}` -> dotenv · multi-hop var->var->
terminal · pointer via env block -> environment target · undefined var / cycle -> fallback to
hovered row · non-pure reference (`{{a}}/v1`, `{{a}}{{b}}`) treated as literal terminal ·
directly-hovered `process.env` + path token -> `writeTarget === target`.

## Tasks

### Task 1: `pureRefInner` + `resolveWriteTarget` + `writeTarget` on previews

**Files:**
- Modify `src/components/workspace/url-token.ts` - add `pureRefInner`, `variableTarget`,
  `resolveWriteTarget`; add `writeTarget` to `TokenPreview`; populate in
  `resolveTokenPreview` (var/env: `resolveWriteTarget(...)`; process.env early-return:
  `writeTarget = target`) and `resolvePathTokenPreview` (`writeTarget = target`).
- Test `src/components/workspace/__tests__/url-token.test.ts`.

**Interfaces:**
- Produces: `pureRefInner(value: string): string | null`;
  `resolveWriteTarget(name: string, effective: EffectiveConfig, environment?: string):
  TokenTarget`; `TokenPreview.writeTarget: TokenTarget`.
- Consumes: existing `EffectiveConfig`, `TokenTarget`, `PROCESS_ENV_PREFIX`, `interpolate`.

- [ ] Write failing tests (TC-001..007)
- [ ] Run, confirm RED for the right reason (missing export / missing field)
- [ ] Add functions + field, minimal
- [ ] Run, confirm GREEN
- [ ] Commit (`feat: AC-001..007 drill token write target to the real value source`)

### Task 2: popup commit writes to `writeTarget`

**Files:**
- Modify `src/components/workspace/var-token.tsx` - `TokenValueEditor.commit` calls
  `setTokenValue(preview.writeTarget, draft)`; pencil `onClick` keeps `preview.target`.
- Test `src/components/workspace/__tests__/url-bar-token-hover.test.tsx` (TC-008).

**Interfaces:**
- Consumes: `preview.writeTarget` (Task 1), existing `setTokenValue`, provider `onEnvChange`.
- Produces: nothing downstream.

- [ ] Write failing integration test (TC-008: edit pointer var -> `.env` written, folder row intact)
- [ ] Run, confirm RED (currently overwrites the folder row / no `onEnvChange` call)
- [ ] Switch `commit` to `writeTarget`
- [ ] Run, confirm GREEN
- [ ] Commit (`feat: AC-008 inline token edit writes the drilled source, not the pointer row`)

## Tests to write (>= one per AC)

- TC-001 -> AC-001 (`pureRefInner`)
- TC-002 -> AC-002 (literal == current target)
- TC-003 -> AC-003 (process.env pointer -> dotenv)
- TC-004 -> AC-004 (multi-hop -> dotenv / literal)
- TC-005 -> AC-005 (env-block pointer -> environment target)
- TC-006 -> AC-006 (undefined / cycle -> fallback, no throw/hang)
- TC-007 -> AC-007 (`writeTarget` present; == target for process.env + path)
- TC-008 -> AC-008 (integration: `.env` written, folder pointer row intact)

## Acceptance verification

- `npm test` green (new + full suite): 224 files, 1964 tests pass.
- `npm run typecheck` clean (no `any`, `TokenPreview.writeTarget` typed).
- `npm run lint` clean (0 errors; 9 pre-existing warnings, none in changed files).
- Fresh verifier subagent: 8/8 AC PASS, all gates PASS; AC-008 discriminator empirically
  confirmed by reverting `commit` to `preview.target` (TC-008 went RED, then restored).

### Status: COMPLETE (uncommitted, awaiting user approval to commit)

### AC -> test traceability

| AC | Test | File |
| -- | ---- | ---- |
| AC-001 | `pureRefInner` should return trimmed inner / null cases (2 tests) | `__tests__/url-token.test.ts` |
| AC-002 | `resolveWriteTarget` literal == preview.target | `__tests__/url-token.test.ts` |
| AC-003 | dotenv target for a pure process.env pointer | `__tests__/url-token.test.ts` |
| AC-004 | multi-hop -> process.env terminal / -> literal row (2 tests) | `__tests__/url-token.test.ts` |
| AC-005 | environment target via env block | `__tests__/url-token.test.ts` |
| AC-006 | fallback to hovered row on undefined var / cycle (2 tests) | `__tests__/url-token.test.ts` |
| AC-007 | writeTarget == target for process.env + path token (2 tests) | `__tests__/url-token.test.ts` |
| AC-008 | edit pointer var -> `.env` written, `onTreeChange` never fired, re-hover shows new | `__tests__/url-bar-token-hover.test.tsx` |

Post-verifier hardening (closed the 3 noted coverage gaps):
- AC-008 now asserts `onTreeChange` NOT called (pointer row intact on disk).
- Non-pure multi-token value exercised through `resolveWriteTarget` (own-row terminal).
- Pencil "go to source" on a process.env-pointer var reveals the folder Vars pointer row
  (`target`), NOT the drilled `.env` (`writeTarget`) - `__tests__/token-reveal.test.tsx`.

## Risks

- **Drill diverges from script `setVar` semantics** (setVar is one-hop process.env only; this is
  multi-hop + env-blocks, per grilled decision): mitigation - documented in spec/ADR; the two
  paths intentionally differ, both reuse the same `setTokenValue`/dotenv routing so writes land
  consistently.
- **Env-suffix strip depends on active `environment`**: mitigation - `variableTarget` reuses the
  exact current logic; AC-005 pins the env-target case.

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-15 | Design gate: evaluated pz-ddd / pz-archetypes / pz-codebase-design. Invoked pz-codebase-design only. | No new domain model or aggregate (ddd/archetypes N/A). pz-codebase-design applies: deepen the preview module with a drill seam + collapse the duplicated target construction into `variableTarget`. |
| 2026-07-15 | Only the inline-edit write drills; pencil "go to source" unchanged. | User decision when grilled - pencil still surfaces the pointer row's scope. |
| 2026-07-15 | Drill is multi-hop and follows env-block pointers (broader than script `setVar`'s one-hop process.env-only). | User decision when grilled - the popup should reach the true literal wherever it lives. |
| 2026-07-15 | Walk `EffectiveConfig` (not the tree); dead-end/cycle falls back to the hovered var's own row. | `EffectiveConfig.variables` already encodes the nearest-wins chain + provenance; fallback == today's overwrite so no regression on unresolved chains. |
| 2026-07-15 | Add `writeTarget` to `TokenPreview` instead of mutating `target`. | Pencil needs the nearest-row `target`; commit needs the drilled one. Separate fields keep both intents explicit. |
