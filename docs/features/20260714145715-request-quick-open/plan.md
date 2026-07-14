# Plan - Request quick-open

Approach per spec: pure `quick-open.ts` (build + filter/rank), a new `ancestorIds` helper in
`tree-locate.ts`, a `revealNode` seam on the workspace context (expand ancestors + select +
open tab + scroll-into-view nonce), a dumb `RequestQuickOpen` `CommandDialog`, and a registry
action `open-quick-open` (`Mod+P`) wired in `main.tsx`. TDD, red-green-refactor.
**Coverage threshold: none** (no vitest coverage gate in `vitest.config.ts` / `package.json`).

## File structure map

Create:
- `src/lib/workspace/quick-open.ts` - `QuickOpenEntry` type, `buildQuickOpenEntries(tree)`,
  `filterQuickOpen(entries, query)` + the fuzzy scorer. Pure, no React.
- `src/lib/workspace/__tests__/quick-open.test.ts` - build/order + filter/rank/empty unit tests.
- `src/components/workspace/request-quick-open.tsx` - the dumb dialog component.
- `src/components/workspace/__tests__/request-quick-open.test.tsx` - render/filter/select tests.
- `src/components/workspace/__tests__/quick-open-integration.test.tsx` - `Mod+P` opens/closes in
  the app shell; `Mod+K` still opens the palette; selecting a request opens its tab.

Modify:
- `src/lib/workspace/tree-locate.ts` - add `ancestorIds(nodes, id): string[]`.
- `src/lib/workspace/__tests__/tree-locate.test.ts` (or nearest existing) - `ancestorIds` cases.
- `src/lib/shortcuts/registry.ts` - add `"open-quick-open"` to `ShortcutActionId` + a
  `SHORTCUT_ACTIONS` entry (`Mod+P`).
- `src/components/workspace/workspace-context/types.ts` - add `revealNode: (id: string) => void`
  and a `revealNonce`/`revealRowId` seam to `WorkspaceContextValue` + `WorkspaceInternals`.
- `src/components/workspace/workspace-context/selection.ts` - implement `revealNode` (it lives
  next to `selectNode`/`focusNode`, sharing `selectSingle`).
- `src/components/workspace/workspace-context/index.tsx` - state for the reveal seam; thread
  `revealNode` into the value; add to the memo dep list.
- `src/components/workspace/sidebar-tree.tsx` - consume the reveal seam: `scrollIntoView` the
  target row (a one-shot effect like `pendingPanelFocus`).
- `src/components/workspace/main.tsx` - `isQuickOpenOpen` state, `open-quick-open` handler,
  render `<RequestQuickOpen>` built from `buildQuickOpenEntries(tree)`.

No disk-format change, no settings change, no new package.

## Interfaces (locked across tasks)

```ts
// quick-open.ts
type QuickOpenEntry = {
  id: string;
  kind: "request" | "folder";
  name: string;
  breadcrumb: string;
  method?: HttpMethod;
  url?: string;
};
function buildQuickOpenEntries(tree: TreeNode[]): QuickOpenEntry[];
function filterQuickOpen(entries: QuickOpenEntry[], query: string): QuickOpenEntry[];

// tree-locate.ts
function ancestorIds(nodes: TreeNode[], id: string): string[]; // root→parent folder ids; [] if root/unknown

// workspace context value additions
revealNode: (id: string) => void;
revealRowId: string | null;   // the row the sidebar should scroll into view
consumeRevealRow: () => void;  // clear it after scrolling (consume-once)

// RequestQuickOpen props
type RequestQuickOpenProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entries: readonly QuickOpenEntry[];
  onSelect: (id: string) => void;
};
```

## Task breakdown

### Task 1: quick-open pure module

**Files:** Create `src/lib/workspace/quick-open.ts`, `src/lib/workspace/__tests__/quick-open.test.ts`.

**Interfaces:**
- Consumes: `TreeNode`, `HttpMethod` from `@/lib/workspace/model`.
- Produces: `QuickOpenEntry`, `buildQuickOpenEntries`, `filterQuickOpen` (signatures above).

- [ ] Write failing tests: TC-002 (build order + breadcrumb + request method/url, folder omits
      them), TC-003 (empty query returns all), TC-004 (fuzzy match drops non-matches, name hit
      outranks url-only hit, no-match → `[]`), plus empty-tree edge (`[]`).
- [ ] Run, confirm RED (module missing).
- [ ] Implement: recursive flatten carrying the breadcrumb; a subsequence fuzzy scorer with a
      field weight (name > breadcrumb > url); `filterQuickOpen` returns all in order for `""`,
      else matched entries sorted by descending score (stable within equal score preserves tree
      order).
- [ ] Run, confirm GREEN.
- [ ] Commit (`feat: AC-002..004 quick-open entry build + fuzzy filter`).

### Task 2: `ancestorIds` locator

**Files:** Modify `src/lib/workspace/tree-locate.ts`; add tests to its `__tests__` file.

**Interfaces:**
- Produces: `ancestorIds(nodes, id): string[]` - root→parent folder-id chain, `[]` for a root
  node or unknown id.

- [ ] Write failing test: TC-007 ancestor cases (nested `["F","G"]`; root `[]`; unknown `[]`).
- [ ] Run, confirm RED.
- [ ] Implement a DFS carrying the folder path; return the path when the id is found.
- [ ] Run, confirm GREEN.
- [ ] Commit (`feat: AC-008 ancestorIds tree locator`).

### Task 3: registry action `open-quick-open`

**Files:** Modify `src/lib/shortcuts/registry.ts`; add a test near
`command-palette-registry.test.ts`.

**Interfaces:**
- Produces: registry id `"open-quick-open"`, default `Mod+P`.

- [ ] Write failing test: TC-001 (registry entry + `resolveShortcuts` + `findConflict` owner).
- [ ] Run, confirm RED.
- [ ] Add the union member + the `SHORTCUT_ACTIONS` entry (name "Quick open request",
      description, `defaultHotkey: "Mod+P"`).
- [ ] Run, confirm GREEN (also re-run the existing shortcuts suites - no fixed-count assertion,
      so they stay green).
- [ ] Commit (`feat: AC-001 open-quick-open shortcut (Mod+P)`).

### Task 4: `RequestQuickOpen` dialog

**Files:** Create `src/components/workspace/request-quick-open.tsx`,
`src/components/workspace/__tests__/request-quick-open.test.tsx`.

**Interfaces:**
- Consumes: `QuickOpenEntry`, `filterQuickOpen` (Task 1), `METHOD_COLOR`, the `ui/command`
  primitives.
- Produces: `RequestQuickOpen` (props above).

- [ ] Write failing tests: TC-005 (rows render; live filter narrows; empty state "No matching
      requests"), TC-006 (Enter on highlighted row and click both call `onSelect(id)` +
      `onOpenChange(false)`).
- [ ] Run, confirm RED.
- [ ] Implement: `CommandDialog` with `shouldFilter={false}`, controlled `query` state,
      `filterQuickOpen(entries, query)` for the shown rows, one `CommandItem value={entry.id}`
      per row (method badge via `METHOD_COLOR` for requests, name, muted breadcrumb),
      `CommandEmpty` "No matching requests". `onSelect` runs then `onOpenChange(false)`.
- [ ] Run, confirm GREEN.
- [ ] Commit (`feat: AC-005..007 request quick-open dialog`).

### Task 5: `revealNode` context seam + sidebar scroll

**Files:** Modify `types.ts`, `selection.ts`, `index.tsx`, `sidebar-tree.tsx`; add a
context/reveal test (extend `selection`/context tests or the integration test).

**Interfaces:**
- Consumes: existing `selectSingle`, `setExpandedFolderIds`, `setOpenRequestIds`,
  `setActiveRequestId`, `ancestorIds` (Task 2), `findNode`.
- Produces: `revealNode`, `revealRowId`, `consumeRevealRow` on the context value.

- [ ] Write failing test: TC-007 reveal cases (request → ancestors expanded + selected + open +
      active; folder → selected + expanded, no tab).
- [ ] Run, confirm RED.
- [ ] Implement `revealNode` in `selection.ts` (folder-id ancestors ∪ (folder self) into
      `expandedFolderIds`; `selectSingle`; for a request open+activate the tab; set
      `revealRowId`). Add the `revealRowId` state + `consumeRevealRow` in `index.tsx`, thread
      into value + memo deps. In `sidebar-tree.tsx` add a one-shot effect that
      `rowRefs.current.get(revealRowId)?.scrollIntoView({ block: "nearest" })` then
      `consumeRevealRow()`.
- [ ] Run, confirm GREEN.
- [ ] Commit (`feat: AC-008 revealNode + sidebar scroll-into-view`).

### Task 6: wire `Mod+P` in the shell

**Files:** Modify `src/components/workspace/main.tsx`; create
`src/components/workspace/__tests__/quick-open-integration.test.tsx`.

**Interfaces:**
- Consumes: `buildQuickOpenEntries` (Task 1), `RequestQuickOpen` (Task 4), `revealNode` (Task 5),
  `tree` + `useActionHotkeys`.
- Produces: nothing downstream.

- [ ] Write failing tests: TC-008 (`Mod+P` opens the quick-open dialog; `Escape` closes it;
      `Mod+K` still opens the command palette), plus selecting a request row opens its tab.
- [ ] Run, confirm RED.
- [ ] Implement: `isQuickOpenOpen` state; `"open-quick-open": () => setIsQuickOpenOpen(true)` in
      the handlers map (so it also shows in the `Mod+K` palette - required by the existing
      command-palette-integration test); render `<RequestQuickOpen open entries=
      {buildQuickOpenEntries(tree)} onSelect={(id) => { revealNode(id); }} />` inside the
      `palette` fragment.
- [ ] Run, confirm GREEN.
- [ ] Commit (`feat: AC-009 wire Mod+P quick-open in the shell`).

## Cross-cutting notes

**Chosen approach & key decisions:**
- Separate dialog (not folded into `Mod+K`), per the product decision - mirrors VSCode `Cmd+P`.
- In-repo fuzzy scorer with `shouldFilter={false}`, NOT `cmdk`'s built-in filter, so the row
  `value` stays the unique node id (duplicate names don't collide) and matching is scoped to
  exactly name/breadcrumb/url with the weight we want. This is the one non-obvious choice - it
  goes in the Decision Log.
- `revealNode` is a new selection-concern method reusing `selectSingle`; scroll-into-view uses
  the same consume-once nonce pattern the sidebar already uses for `pendingPanelFocus`.
- `open-quick-open` gets a `main.tsx` handler so it appears in the `Mod+K` palette too (keeps
  the "every wired action is in the palette" invariant the integration test enforces).

**Design gate:** `pz-ddd` / `pz-archetypes` / `pz-codebase-design` evaluated - none applies.
This is a read-only view + navigation feature over the existing tree model (no new domain
boundary, no aggregate/consistency rule, no new module interface beyond two thin pure fns that
follow the established `tree-select`/`tree-locate` pattern). Recorded in the Decision Log.

**Edge cases handled:** empty tree (`[]` → empty state), root node (`breadcrumb === ""`),
duplicate names (id as `value` + breadcrumb disambiguation), draft/settings tabs excluded
(not tree nodes), unknown id (`ancestorIds`/`revealNode` no-op), sidebar hidden (scroll is a
harmless no-op).

**Tests (≥1 per AC):** AC-001→TC-001, AC-002→TC-002, AC-003→TC-003, AC-004→TC-004,
AC-005→TC-005, AC-006/007→TC-006, AC-008→TC-007, AC-009→TC-008.

## Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A |
| Registry images       | N/A |
| Cloud quotas          | N/A |
| Network reachability  | N/A |
| CI status             | N/A |
| External secrets      | N/A |
| Database migrations   | N/A |

Verification before implementation: N/A - pure frontend feature, `npm test` is the gate.

## Risks

- Fuzzy ranking feels wrong in practice: mitigation - simple subsequence + field-weight scorer,
  tunable; behavior pinned by TC-004.
- `open-quick-open` missing a `main.tsx` handler would break the command-palette-integration
  test: mitigation - Task 6 adds the handler explicitly, and that test re-runs in the verifier.

## Decision Log

Append-only.

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-14 | Design gate: evaluated pz-ddd / pz-archetypes / pz-codebase-design - none applies. | Read-only navigation view over the existing tree; no new domain boundary/aggregate/module interface beyond two thin pure fns matching the existing `tree-select` pattern. |
| 2026-07-14 | Separate `Mod+P` dialog, not folded into the `Mod+K` command palette. | Product decision; mirrors VSCode Cmd+P quick-open muscle memory. |
| 2026-07-14 | In-repo fuzzy scorer + `shouldFilter={false}` instead of cmdk's built-in filter. | Row `value` must be the unique node id (duplicate request names), and matching must span exactly name+breadcrumb+url with a name>breadcrumb>url weight - cmdk's single-string filter can't express that cleanly. |
| 2026-07-14 | `open-quick-open` gets a `main.tsx` handler (also runnable from `Mod+K`). | Preserves the "every wired action appears in the command palette" invariant the integration test enforces. |
