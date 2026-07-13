# Spec: Split `workspace-context.tsx`

**Created:** 2026-07-13
**Status:** DRAFT - awaiting approval
**Kind:** Refactor (behavior-preserving). No user-visible change.

## Overview

`src/components/workspace/workspace-context.tsx` is 2286 lines: one `WorkspaceProvider`
holding ~40 `useState`/`useRef` atoms, a handful of derived `useMemo`s, and a single
~1300-line `value` `useMemo` that defines ~90 closures (tree CRUD, tabs, editors, send
loop, imports, tokens, env) and returns them as the context value. It is touched by nearly
every recent fix; every change risks the whole surface (3 of the last 4 session fixes landed
here). 22 production consumers + ~101 test files read it through `useWorkspace()`.

The goal is to **split the logic into focused sibling modules** while keeping the **single
`useWorkspace()` hook** and the **single `WorkspaceProvider`** unchanged as the public surface.
The chosen shape (from three considered) is *"split logic, keep one hook"*: the provider still
owns all shared state and still returns one `value` object; the ~90 closures move into
per-concern factory functions in sibling files, called from the provider. This is the only
shape that is behavior-preserving with **zero churn to the 22 consumers and ~101 test files**.

Rejected alternatives (see Decision Log in plan):
- **Separate stateful providers + per-slice hooks** (`useTree()`/`useTabs()`/…): the ~40 state
  atoms are shared across concerns (`requestOverrides`, `draftRequests`, `responseStates`,
  `tree`, and the `persistTree`/`saveEnv` write-core are each read+written by tree CRUD *and*
  tabs-close *and* editor-save *and* send), so real provider separation needs a god base-provider
  anyway and forces rewriting all 22 consumers + ~101 tests. High risk, large diff.
- **dbui-style peel-off** of only independent slices (console lines, dialog flags): lowest
  ambition, leaves the 1300-line `value` memo intact. Doesn't pay down the debt.

## Why (the coupling that dictates the shape)

- **Write-core** `persistTree` / `saveEnv` is called by tree CRUD, imports, editor saves, and
  the send loop. It stays one implementation, injected into every factory that writes.
- **Cross-concern calls**: tree `deleteNodes` → tabs `closeRequest`; editor `savePendingClose` →
  tabs `closeAll`/`closeOthers`/`closeRequest`; imports → tree `createRequestNode`; send →
  `persistTree`/`saveEnv`; tokens → `saveNodeConfig` + `setRequestPathParams`.
- **Shared session state** `requestOverrides` + `draftRequests` + `responseStates` are read and
  written by create, close, save, and send paths.

Because closures reference each other, factories receive an `internals` bag (shared state +
setters + refs + derived values) plus the specific cross-concern callbacks they call. They are
plain functions (not hooks) invoked **inside the existing `value` `useMemo`**, so recompute
timing and the memo dep array are **identical to today** - the split is pure code-motion.

## Acceptance Criteria

| ID | Criterion | Priority |
|----|-----------|----------|
| AC-001 | Import path `@/components/workspace/workspace-context` still resolves and still exports `useWorkspace`, `WorkspaceProvider`, and every type previously exported from the module (`EditTarget`, `RevealTarget`, `ParamsReveal`, `EditorScope`, `ActiveEditor`, `PendingClose`, `PendingDelete`, `SelectMode`, `RequestTab`, `ResponseTab`). No consumer or test import changes. | Must |
| AC-002 | `useWorkspace()` returns a value with exactly the same member set and semantics as before - no member added, removed, renamed, or retyped (`WorkspaceContextValue` unchanged). | Must |
| AC-003 | All existing tests pass **unchanged** - no test file edited or deleted (the ~1827-test suite is the characterization net). | Must |
| AC-004 | The ~90 closures live in focused sibling modules under `src/components/workspace/workspace-context/`, one responsibility per file; `index.tsx` (provider) holds state + derived memos + the `value` composition only, and is materially smaller than 2286 lines. | Must |
| AC-005 | `value` `useMemo` recompute timing is unchanged: its dependency array holds the same atoms as before (pure code-motion, no new/removed deps). | Must |
| AC-006 | `npm run lint`, `npm run typecheck`, `npm test`, `npm run build` all exit 0. No new `any`; coding standards (guards over nesting, no drive-by edits, existing comments preserved) upheld. | Must |

## Test Cases

This is a behavior-preserving refactor, so **RED-first does not apply** - the existing suite is
the characterization net and must stay green after every extraction step (documented exception
to the red-green rule in the plan). One new lightweight guard is added:

- TC-001 (AC-001, AC-002): mount `WorkspaceProvider`, read `useWorkspace()`, assert the returned
  object exposes the full expected member-name set (surface pin). Maps to: AC-001, AC-002.
- TC-002 (AC-003): full suite `npm test` green, no test files modified (`git diff --name-only`
  shows no `*.test.tsx` changes). Maps to: AC-003.
- TC-003 (AC-006): `lint` + `typecheck` + `build` exit 0. Maps to: AC-006.

Every pre-existing behavior test (send loop, tree CRUD, tabs, editor dirty/close, imports,
tokens, env scope, drafts, multi-select, …) continues to serve as the behavioral proof per
concern - they are not rewritten.

## Edge cases

- **Circular factory deps**: tree↔tabs (`deleteNodes`→`closeRequest`), editor→tabs. Resolved by a
  fixed construction order in the provider (persist → tabs → request-edits → tree-crud → send →
  env → imports → editor → tokens) and injecting already-built callbacks downstream. No factory
  reaches back for a not-yet-built one.
- **`createRequestNode`** is a tree+tabs hybrid (inserts a node AND opens/selects its tab); it
  lives in the tree-crud module and is injected into imports.
- **Refs vs values**: closures that read live refs (`showToastRef`, `httpClientRef`,
  `scriptRunnerRef`, `on*ChangeRef`, `sendGeneration`, `inFlightRequestId`, `nodeCounter`,
  `autoNameIds`, `*Nonce`) must keep reading the ref, not a snapshot, so async paths (send loop)
  see current values. Factories receive the ref objects, not `.current`.
- **Identity churn**: factories run inside the `value` `useMemo` exactly as the inline closures do
  today, so consumer effects keyed on callback identity see the same churn as before (no better,
  no worse) - avoids surprising an effect that depends on a stable/unstable identity.

## Dependencies

- No new libraries. Plain React `createContext` + `useContext`, mirroring the established repo
  idiom (`settings-context.tsx`, `theme-context.tsx`) and dbui's factory-of-closures style.
- Existing `@/lib/workspace/*`, `@/lib/http/*`, `@/lib/scripts/*`, `@/lib/*/…-to-tree` helpers are
  imported by the new module files instead of the monolith - moved, not changed.
