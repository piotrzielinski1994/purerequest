# Plan - Focused-panel resize shortcuts

## Design gate

- pz-ddd: N/A (UI layout config, no domain model).
- pz-archetypes: N/A (no accounting/inventory/ordering/etc. shape).
- **pz-codebase-design: applies** - a new pure `panel-resize` module (deep, testable
  interface hiding the focus-walk + clamp math) and a widened workspace-context interface
  (group-handle registry). Backbone of the file structure below.

## Approach

Panels are uncontrolled `react-resizable-panels` with DOM ids (`sidebar`, `content`,
`console`). The library exposes `GroupImperativeHandle.getLayout()/setLayout({[id]: pct})`
via a `groupRef` prop. Resolve the focused panel from `document.activeElement` by walking
`[data-panel]` ancestors; map its id to group + clamp bounds. `panel-expand`/`panel-shrink`
apply a +/-5% delta to the focused panel, give the inverse to its sibling, clamp, then
`setLayout` - which fires the group's existing `onLayoutChanged -> saveLayout`, so
persistence is automatic. No new focused-panel state (mirrors `isEditableFocused()`).

Group handles are bridged through workspace-context (`registerPanelGroup`/`getPanelGroup`)
because the handlers live in `main.tsx` while the sidebar's group is rendered in
`workspace-layout.tsx` - same pattern the existing `requestPanelFocus`/`consumePanelFocus`
bridge uses.

## File structure

| File | Responsibility | Change |
| ---- | -------------- | ------ |
| `src/lib/workspace/panel-resize.ts` | Pure: `resolveFocusedPanel`, `stepLayout`, `PANEL_RESIZE_STEP`, bounds constants | Create |
| `src/lib/workspace/__tests__/panel-resize.test.ts` | Unit tests for the helpers | Create |
| `src/lib/shortcuts/registry.ts` | `panel-shrink`/`panel-expand` id + entries | Modify |
| `src/components/workspace/workspace-context/types.ts` | `registerPanelGroup`/`getPanelGroup` types | Modify |
| `src/components/workspace/workspace-context/index.tsx` | group-handle registry state | Modify |
| `src/components/workspace/workspace-layout.tsx` | register workspace group handle | Modify |
| `src/components/workspace/main.tsx` | register main group handle; add resize handlers | Modify |
| `src/lib/shortcuts/__tests__/panel-resize-registry.test.ts` | registry defaults | Create |
| `src/components/workspace/__tests__/panel-resize-actions.test.tsx` | integration: focus->resize | Create |

## Tasks

### Task 1: Pure resize helpers

`resolveFocusedPanel(el) -> { group, panelId, siblingId, min, max } | null` and
`stepLayout(layout, target, deltaPct) -> PanelLayout` (clamped, sibling-inverse,
immutable). Constants `PANEL_RESIZE_STEP = 5`, sidebar 12/40, console 10/90.
RED unit tests -> GREEN -> commit.

### Task 2: Group-handle bridge in workspace-context

Add `registerPanelGroup(key, handle | null)` + `getPanelGroup(key)` to context; register
on mount in both group components, null on unmount. Integration-tested via Task 3.

### Task 3: Actions + handlers

Add registry entries; add `panel-shrink`/`panel-expand` handlers in `main.tsx` that read
`document.activeElement -> resolveFocusedPanel -> getPanelGroup -> getLayout -> stepLayout
-> setLayout`. RED integration + registry tests -> GREEN -> commit.

## Execution order

Task 1 (pure, no deps) -> Task 2 (context bridge) -> Task 3 (wires 1+2 into actions).

## Acceptance verification

- AC-001 -> panel-resize-registry.test.ts (TC-001)
- AC-002/003 -> panel-resize-actions.test.tsx (TC-002/003/004)
- AC-004 -> panel-resize.test.ts clamp + actions test (TC-005/006)
- AC-005 -> panel-resize-actions.test.tsx (TC-007/008)
- AC-006 -> panel-resize-actions.test.tsx palette (TC-009)
- AC-007 -> panel-resize-actions.test.tsx hidden (TC-010)
- Gates: `npm test`, `npm run lint`, `tsc` (no `any`).
