# Plan - Per-folder, per-environment accent color (border)

**Supersedes the first attempt** (single env-blind color per folder). That model is removed:
`FolderNode.accentColor`, `update-folder-accent.ts`, the `(tree, id)` `accentColorFor` signature,
and the four old tests are replaced. New model below.

## Approach

- **Data**: replace `FolderNode.accentColor?: string` with `FolderNode.environmentColors?:
  Record<string, string>` (env name -> hex). Folder-only; requests inherit.
- **Persist**: `serialize` emits `environmentColors` only when non-empty; `deserialize` sanitizes
  (keep only `#rrggbb`/`#rrggbbaa` values, lowercased; drop the field if not an object or empty).
- **Resolve**:
  - `accentColorFor(tree, nodeId, env): string | null` - null if env null; else `findScopePath`
    reverse-walk for nearest scope with `environmentColors[env]`. Uniform for folder + request ids.
  - `environmentNamesForScope(tree, nodeId): string[]` - union of `config.environments` keys along
    root -> node; null nodeId -> all tree envs (delegates to `listEnvironmentNames`).
- **Live color write** (NOT in the Cmd+S draft): a context action `setFolderEnvColor(folderId,
  env, color | null)` that persists immediately via `persistTree` + `updateFolderEnvColor`. Keeps
  picking out of the folder draft so it never clobbers unsaved var edits and the border is instant.
- **Border driver**: `activeScopeId` (active folder editor's folder, else active request, else null)
  + `activeEnvironment` -> `activeAccentColor = accentColorFor(tree, activeScopeId, activeEnvironment)`.
  Shell overrides `--border` with it (unchanged from current, just a different source).
- **Sidebar scoping + reset**: `environmentNames` (context) becomes `environmentNamesForScope(tree,
  activeScopeId)`. A provider effect watches `activeScopeId`: if `activeEnvironment` is set and not
  in the scoped names, reset it to null (persisting via the existing change callback).
- **Picker**: the existing `AccentField` UI is reused but rewired - it edits the **selected env's**
  saved color and writes live. It sits on the EnvPanel env-selector toolbar (next to the env Select
  + add + trash), so the env it edits is the one picked there.

## File changes

### Model + persistence

1. `src/lib/workspace/model.ts` - `FolderNode`: replace `accentColor?` with
   `environmentColors?: Record<string, string>;`.

2. `src/lib/workspace/disk-format.ts`
   - `ParsedFolder`: `environmentColors?: Record<string, unknown>`.
   - New `sanitizeEnvironmentColors(value): Record<string,string> | undefined` - object guard, keep
     hex values lowercased, undefined if none survive.
   - `serializeInto` folder branch: spread `...(node.environmentColors && Object.keys(...).length ?
     { environmentColors: node.environmentColors } : {})`.
   - `buildLevel` folder build: `...(sanitized ? { environmentColors: sanitized } : {})`.
   - Keep the `HEX_COLOR` const.

### Resolution

3. `src/lib/workspace/resolve.ts`
   - `Scope`: replace `accentColor?` with `environmentColors?: Record<string, string>` (folder-only
     carry in `findScopePath`).
   - Rewrite `accentColorFor(tree, id, env)` per above.

4. `src/lib/workspace/environment.ts`
   - New `environmentNamesForScope(tree, nodeId)` - chain union; null -> `listEnvironmentNames`.
     (Reuse `findScopePath` from resolve, or walk locally to avoid a cycle - implement via
     `findScopePath` import is fine, environment.ts has no cycle with resolve's other exports... if
     it does, inline a small chain walk here.)

### Live color action

5. `src/lib/workspace/update-folder-env-color.ts` (new, replaces update-folder-accent.ts)
   - `updateFolderEnvColor(tree, folderId, env, color | null)` - clone the folder's
     `environmentColors`, set or delete `env`, drop the field if the map empties.

6. delete `src/lib/workspace/update-folder-accent.ts`.

### Context wiring

7. `src/components/workspace/workspace-context.tsx`
   - Revert `saveFolder` to its original 3-arg form (accent leaves the draft).
   - Add `setFolderEnvColor(folderId, env, color | null)` -> `persistTree(updateFolderEnvColor(...))`.
   - Compute `activeScopeId` once; expose `activeAccentColor = accentColorFor(tree, activeScopeId,
     activeEnvironment)`.
   - `environmentNames` -> `environmentNamesForScope(tree, activeScopeId)`.
   - Effect: on `activeScopeId` change, if `activeEnvironment && !scopedNames.includes(env)` ->
     `setActiveEnvironmentState(null)` + fire `onActiveEnvironmentChangeRef.current?.(null)`.
   - Update the `WorkspaceContextValue` type + memo deps; drop the old `saveFolder` 4th arg.

### Render

8. `src/components/workspace/workspace-layout.tsx` - unchanged in shape (already reads
   `activeAccentColor`); just confirm it compiles with the new source.

### Picker UI

9. `src/components/workspace/accent-field.tsx` - keep the control; props already `{ value, onChange }`.
   Add an optional `label`/compact layout so it fits the EnvPanel toolbar (flush, `h-full`, 1px
   dividers - design.md "NO SPACING INSIDE A BAR").

10. `src/components/workspace/config-panels.tsx` (`EnvPanel`)
    - New props: `envColors: Record<string, string>` (saved), `onEnvColorChange: (env, color|null)
      => void`.
    - On the Envs sub-view toolbar (the row with the env Select + add + trash), render the
      `AccentField` for `activePicked`, value `envColors[activePicked] ?? null`, onChange ->
      `onEnvColorChange(activePicked, color)`. Disabled when no env selected.

11. `src/components/workspace/folder-pane.tsx`
    - Remove the accent from the draft (`accentDraft`, seedKey, isDirty, save, commitToTree revert
      to pre-accent).
    - Pass `envColors={folder.environmentColors ?? {}}` and `onEnvColorChange={(env, color) =>
      setFolderEnvColor(folder.id, env, color)}` into `EnvPanel` (via `FolderStructuredEditor`).
    - Remove the AccentField from the env TabsContent top (it moves into EnvPanel's toolbar).

### Sidebar

12. `src/components/workspace/env-selector.tsx` - unchanged (already maps `environmentNames`); it now
    receives the scoped list automatically.

## Edge cases handled

E-1 (env null -> null), E-2 (sanitize), E-3 (None removes; empty map omits field), E-4 (lowercase),
E-5 (root request null), E-6 (nearest ancestor), E-7 (round-trip), E-8 (env-keyed), E-9 (reset).

## Tests (Vitest) - rewrite the four files

- `disk-format-accent.test.ts` -> `environmentColors` round-trip; emit only when non-empty; sanitize
  garbage (non-object, non-hex value, lowercase) keeping a valid sibling. AC-003, AC-008, E-2/4/7.
- `resolve-accent.test.ts` -> `accentColorFor(tree, id, env)` (null env, inherit, nearest-wins,
  env-keyed, root-null) + `environmentNamesForScope` chain union. AC-007, AC-009, E-1/5/6/8.
- `accent-border.test.tsx` -> shell `--border` by active env + active tab; switch env recolors;
  env-keyed (prod-only folder, local active -> none); nested inherit; reset on tab change clears.
  AC-004/005/006/007/010.
- `accent-field.test.tsx` (or env-panel test) -> Env tab toolbar shows the control for the selected
  env; pick Red -> persists `environmentColors.prod` live (no Cmd+S, no dirty dot); switch dropdown
  to local -> control shows local's color; None removes. AC-001/002.
- New small `env-scope` coverage for AC-009/AC-010 (combobox options + reset) - in the border test
  or a dedicated `env-scope.test.tsx`.

## Execution order (TDD)

1. Rewrite the four test files RED (spawn fresh test-writer).
2. Model + disk-format + sanitize -> green.
3. resolve `accentColorFor(…, env)` + `environmentNamesForScope` -> green.
4. `updateFolderEnvColor` + context `setFolderEnvColor` / `activeScopeId` / scoped `environmentNames`
   / reset effect -> green.
5. EnvPanel toolbar AccentField + folder-pane rewire (drop draft accent) -> green.
6. Full suite, lint, typecheck; fresh verifier.

## Acceptance verification

- `npm test` full green; lint 0 errors; typecheck clean; no `any`.
- Manual (reproduce the two reported bugs):
  - set as24/prod red, active env prod, open an as24 request -> borders red **without Cmd+S**.
  - set local green, prod red; switch dropdown prod->local in the panel -> control shows green not red.
  - sidebar: switch to a folder without `prod` -> combobox loses prod, active env resets.

## Risks

- Reset effect loops: guard on `activeScopeId` identity + only reset when env genuinely absent;
  resetting to null can't re-trigger (null is always "in scope"). Mitigated.
- environment.ts <-> resolve.ts import cycle for `findScopePath`: if a cycle appears, inline a local
  chain walk in `environmentNamesForScope`. Checked during impl.
- Live persist on every swatch click writes the tree each time: acceptable (same cost as a rename);
  optimistic `persistTree` already debounces UX via the background write.
