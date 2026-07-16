# F3 | Timeout (+ config scalars) UI field

Backlog: `.pzielinski/todos.md` F3
Feature: `docs/features/20260716012239-timeout-config-field/`
Branch: `20260716012239-timeout-config-field`

## Summary

Add a structured editor for the inheritable `timeoutMs` `ConfigScope` scalar (today only settable via
the raw-JSON tab). Rename the raw-JSON editor tab from "Settings" to "Raw" (both request + folder
panes); add a new structured "Settings" tab hosting the timeout field. Empty input = inherit, with a
placeholder showing the resolved effective value + origin.

## Acceptance Criteria

- AC-001: Structured "Settings" tab (value `"settings"`) in the request pane hosting the timeout field.
- AC-002: Structured "Settings" tab in the folder pane hosting the timeout field.
- AC-003: Raw-JSON editor tab renamed "Raw" (value `"raw"`) in both panes; editor content unchanged.
- AC-004: Typing a positive integer sets `config.timeoutMs`, persists on save (draft+save model).
- AC-005: Clearing the field removes `timeoutMs` from the scope (inherit), persists on save.
- AC-006: Scope unset -> input empty, placeholder = effective value + origin (`30000 (default)` / `<v> (from <Scope>)`).
- AC-007: Non-positive / non-integer / non-numeric entry rejected (never written).
- AC-008: "Edit" context-menu + `openConfigEditor` still open the Raw tab.
- AC-009: Field is design.md-compliant (no rounded corners, tokens, shared grid density).

## Test Cases

- TC-001 (happy): request Settings -> `5000` -> save -> `config.timeoutMs === 5000`. Maps: AC-001, AC-004.
- TC-002 (happy): folder Settings -> `8000` -> save -> folder `config.timeoutMs === 8000`. Maps: AC-002, AC-004.
- TC-003 (clear): request `timeoutMs: 5000` -> clear -> save -> `undefined`. Maps: AC-005.
- TC-004 (ph default): no ancestor sets it -> empty, placeholder has `30000` + `default`. Maps: AC-006.
- TC-005 (ph inherit): folder `timeoutMs: 7000`, request unset -> empty, placeholder has `7000` + folder name. Maps: AC-006.
- TC-006 (reject): `0` / `-5` / `abc` / `1.5` -> no `timeoutMs` written. Maps: AC-007.
- TC-007 (rename): both panes expose a Raw tab rendering the raw-JSON editor; no Settings-labeled raw editor. Maps: AC-003.
- TC-008 (edit jump): `openConfigEditor(reqId)` activates the Raw tab. Maps: AC-008.

## UI States

| State   | Behavior                                                                                |
| ------- | --------------------------------------------------------------------------------------- |
| Loading | N/A                                                                                     |
| Empty   | Scope unset -> input empty, placeholder = effective value + origin.                     |
| Error   | Invalid entry -> not committed; reverts on blur.                                        |
| Success | Valid positive int -> shown as input value; persists on save.                          |

## Solution Plan

### File Structure

- `src/components/workspace/config-panels.tsx` (MODIFY) - add `GeneralPanel` (the timeout row). Reuse `AUTH_CELL`/`AUTH_INPUT` grid styling.
- `src/components/workspace/request-pane.tsx` (MODIFY) - add Settings tab (GeneralPanel), rename raw tab trigger to "Raw" value `"raw"`.
- `src/components/workspace/folder-pane.tsx` (MODIFY) - same: Settings tab in structured editor, rename raw tab to "Raw" value `"raw"`; `FolderTab` union `"settings"` stays for structured, add `"raw"`.
- `src/components/workspace/workspace-context/types.ts` (MODIFY) - `RequestTab`: swap raw editor value to `"raw"`, keep `"settings"` for structured.
- `src/components/workspace/workspace-context/editors.ts` (MODIFY) - `openConfigEditor` sets tab to `"raw"`.
- Tests (see tasks) - new `general-panel` test + update raw-tab selectors ("Settings"->"Raw") in config-pane tests.

### Task 1: RequestTab/FolderTab value split + editors jump

**Files:** Modify `workspace-context/types.ts`, `workspace-context/editors.ts`, `request-pane.tsx`, `folder-pane.tsx`. Test: `request-settings-tab.test.tsx` (Raw tab), a new assertion for the Edit jump.

**Interfaces:**
- Produces: `RequestTab` gains `"raw"`, keeps `"settings"`. `openConfigEditor` -> `setActiveRequestTab("raw")`.

- [ ] Failing test: Raw tab present + Edit jump lands on Raw.
- [ ] Green: rename raw trigger value/label, point `openConfigEditor` at `"raw"`.
- [ ] Commit `feat(F3): AC-003 AC-008 rename raw tab to Raw, keep Edit jump`

### Task 2: GeneralPanel timeout field

**Files:** Modify `config-panels.tsx` (add `GeneralPanel`). Test: new `general-panel.test.tsx`.

**Interfaces:**
- Consumes: `ConfigScope`, `EffectiveConfig["timeoutMs"]` (`{ value, from: { scopeName } }`), `DEFAULT_TIMEOUT_MS`.
- Produces: `GeneralPanel({ config, effectiveTimeout, onChange })` - `onChange(config: ConfigScope)`.

- [ ] Failing tests: set value, clear->undefined, placeholder default, placeholder inherited, reject invalid.
- [ ] Green: implement `GeneralPanel` (parse-or-reject, empty->strip key, placeholder from effective).
- [ ] Commit `feat(F3): AC-004..007 GeneralPanel timeout field`

### Task 3: Wire GeneralPanel into both panes

**Files:** Modify `request-pane.tsx`, `folder-pane.tsx`. Test: `editable-config-panels.test.tsx` (request save), `folder-*` (folder save).

**Interfaces:**
- Consumes: `GeneralPanel` from Task 2, `effectiveConfig.timeoutMs` (request), `resolveConfig(...).timeoutMs` (folder highlight chain).

- [ ] Failing test: request Settings save writes `timeoutMs`; folder Settings save writes it.
- [ ] Green: mount `GeneralPanel` under the new Settings TabsContent in both panes.
- [ ] Commit `feat(F3): AC-001 AC-002 wire timeout field into request + folder panes`

### Cross-cutting

- Approach: reuse the Auth grid styling + the existing draft+save seam - no new state machinery. `GeneralPanel` is a pure controlled component (value from `config.timeoutMs`, placeholder from resolved effective). No design pattern beyond the shared panel shape.
- Edge cases: trim before parse; reject `<= 0`, non-integer, NaN; empty string strips the key; own==inherited still writes.
- Tests: one per AC (see TCs) + reject-invalid boundary cases.

## Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A         |
| Registry images       | N/A         |
| Cloud quotas          | N/A         |
| Network reachability  | N/A         |
| CI status             | N/A         |
| External secrets      | N/A         |
| Database migrations   | N/A         |

Verification before implementation: none needed - pure local UI over an existing model field.

## Risks

- Rename blast radius: ~8 config-pane test files select the raw tab by name "Settings". Mitigation: grep-driven update, distinguish `request sections`/`folder sections` tablists from the app-level `settings sections` view (untouched).
- Tab-value collision: `"settings"` reused for the new structured tab. Mitigation: raw editor moves to `"raw"`; `openConfigEditor` retargeted; no persisted value keys off the tab id (verified).

Coverage threshold: none

## Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-16 | Rename raw-JSON tab "Settings"->"Raw"; new structured "Settings" tab holds timeout | User decision; frees the "Settings" name for structured scalars, keeps raw editor reachable |
| 2026-07-16 | Empty input = inherit, placeholder shows effective value + origin | User decision; mirrors the "Inherited from X" affordance used across panels |
| 2026-07-16 | "Edit" context-menu keeps opening the Raw tab (value `"raw"`) | User decision; preserves current behavior (jump to full JSON editor) |
| 2026-07-16 | Design gate: pz-ddd / pz-archetypes / pz-codebase-design evaluated; none invoked | timeoutMs model + resolution already exist; GeneralPanel mirrors existing panel signatures, no new domain boundary or seam. Plumbing/UI ticket |
