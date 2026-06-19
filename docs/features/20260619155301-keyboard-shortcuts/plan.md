# Plan: Configurable Keyboard Shortcuts

Implements [spec.md](spec.md). TDD, red-green-refactor. Tests: Vitest (`npm test`).

## Approach

Three layers, pure -> stateful -> wired:

1. **Registry + resolver (pure, no React).** `src/lib/shortcuts/registry.ts` holds
   `SHORTCUT_ACTIONS` (the single source of the action list) + `ShortcutActionId`,
   `ShortcutAction`, `ShortcutOverrides` types. `src/lib/shortcuts/resolve.ts` holds
   `resolveShortcuts(overrides)` and `findConflict(hotkey, forAction, effective)`. Both
   are pure functions, unit-tested without DOM. Hotkey-string validity + normalized
   equality use `@tanstack/hotkeys` (`parseHotkey` / `normalizeHotkey`), wrapped in a
   tiny ADT-style `safeNormalize(s): string | null` (null = invalid) so no try/catch
   leaks into callers.

2. **Settings extension (stateful).** Extend `Settings` with `shortcuts: ShortcutOverrides`
   (default `{}`), extend `mergeSettings` to validate the persisted map (drop non-string
   values, invalid hotkeys, unknown ids), and add `saveConsoleHidden`, `saveShortcut`,
   `resetShortcut` to `SettingsProvider`. Persistence flows through the existing
   `SettingsStore` port unchanged.

3. **Registration + wiring (React/DOM).** `useActionHotkeys(handlers)` in
   `src/lib/shortcuts/use-action-hotkeys.ts` reads `useSettings()`, resolves effective
   bindings, and calls the library `useHotkeys` for exactly the actions present in
   `handlers` (each as `{ hotkey, callback, options:{ ignoreInputs:true } }`). Global
   actions registered once high in the tree; workspace actions registered inside the
   workspace subtree where the handlers exist. Settings page gets the shortcuts editor
   using `useHotkeyRecorder`.

Why this shape: registry-as-data keeps "what actions exist" declarative and testable;
the resolver isolates all hotkey-string fiddling from React; `useActionHotkeys` is the
one seam every consumer uses, so handler wiring stays local to the component that owns
the behavior (no central dispatcher / no prop drilling). Mirrors the existing
`resolveConfig` (pure) + `SettingsProvider` (stateful) split already in the repo.

## Files

### New

| File | Purpose |
|------|---------|
| `src/lib/shortcuts/registry.ts` | `ShortcutActionId`, `ShortcutAction`, `ShortcutOverrides` types; `SHORTCUT_ACTIONS` const |
| `src/lib/shortcuts/resolve.ts` | `safeNormalize`, `resolveShortcuts`, `findConflict` (pure) |
| `src/lib/shortcuts/use-action-hotkeys.ts` | `useActionHotkeys(handlers)` hook over lib `useHotkeys` |
| `src/components/settings/shortcuts-section.tsx` | Settings-page UI: action rows + recorder + reset + conflict msg |
| `src/components/settings/shortcut-row.tsx` | One action row (label, formatted binding, Edit/Cancel, Reset) |
| `src/lib/shortcuts/__tests__/resolve.test.ts` | Unit: resolveShortcuts, findConflict, safeNormalize, corrupt input |
| `src/lib/shortcuts/__tests__/use-action-hotkeys.test.tsx` | Behavior: pressing a binding fires the handler; input guard; no-op |
| `src/components/settings/__tests__/shortcuts-section.test.tsx` | Behavior: list, rebind round-trip, reset, conflict block+warn |

### Modified

| File | Change |
|------|--------|
| `src/lib/settings/settings.ts` | Add `shortcuts` to `Settings` + `DEFAULT_SETTINGS`; validate it in `mergeSettings` (new `mergeShortcuts`) |
| `src/lib/settings/settings-context.tsx` | Add `saveConsoleHidden`, `saveShortcut`, `resetShortcut` to context value; factor a private `update(next)` |
| `src/routes/__root.tsx` | Hoist `SettingsProvider` here (wrap `Outlet`) so `/settings` is inside it; register **global** shortcuts (`open-settings`, `close-settings`) via `useActionHotkeys` using router `useNavigate` |
| `src/routes/index.tsx` | Remove the local `SettingsProvider` (now from root); keep `WorkspaceLoader` + the `settingsStore`/`workspaceFs` creation moved to root |
| `src/routes/settings.tsx` | Render `<ShortcutsSection/>` under the heading |
| `src/components/workspace/main.tsx` | Register **workspace** shortcuts (`toggle-console`, `next/prev-request`, `close-request`) via `useActionHotkeys`, using `useSettings().saveConsoleHidden` + `useWorkspace()` actions |
| `src/lib/settings/__tests__/settings.test.ts` | Add `mergeSettings` cases for `shortcuts` (valid, corrupt, unknown id, absent) |
| `README.md` | Note the shortcuts feature + that bindings persist to `settings.json`; keyboard-only access to `/settings` |
| `docs/learnings.md` | Any hotkey-lib gotchas hit during impl |
| `docs/adr.md` | Row: action-registry + per-installation override model decision |

`settingsStore`/`workspaceFs` `useState` creation moves from `routes/index.tsx` to
`routes/__root.tsx` (so the provider that wraps both routes owns the store instance).

## Edge cases handled (from spec §7)

- E-1 absent `shortcuts` -> `mergeShortcuts` returns `{}`.
- E-2/E-3 invalid value / unknown id -> dropped in `mergeShortcuts` AND defended again in
  `resolveShortcuts` (resolver never trusts its input).
- E-5 record-time conflict -> `findConflict` returns the owning action id; row shows
  block+warn, does not call `saveShortcut`.
- E-6 `Escape` reserved by recorder for cancel -> cannot be assigned; documented in the
  section's helper text.
- E-7 workspace no-op -> handlers guard on `activeRequestId`/`openRequestIds` before acting.
- E-8 input/recording guard -> `ignoreInputs:true` on registration; recorder owns the
  keyboard while capturing.
- E-9 Tauri-less dev -> unchanged store behavior; in-session shortcuts still work.

## Execution order (TDD)

Phase 3 spawns a fresh test-writer (RED) per skill, then GREEN/REFACTOR here.

1. **Registry + resolver** (AC-001, AC-007, AC-005-logic)
   - RED: `resolve.test.ts` - default resolve, override wins, corrupt/unknown dropped,
     `findConflict` finds/clears, `safeNormalize` rejects garbage.
   - GREEN: `registry.ts` + `resolve.ts`.
2. **Settings model** (AC-003, AC-004, AC-007)
   - RED: `settings.test.ts` additions for `shortcuts` merge.
   - GREEN: extend `settings.ts` `mergeSettings`/`DEFAULT_SETTINGS`.
3. **Provider actions** (AC-003, AC-004)
   - RED: extend `settings-context.test.tsx` - `saveShortcut`/`resetShortcut`/
     `saveConsoleHidden` update + persist + round-trip.
   - GREEN: extend `settings-context.tsx`.
4. **Registration hook** (AC-002, AC-008, AC-009)
   - RED: `use-action-hotkeys.test.tsx` - firing a binding runs the handler; typing in an
     input does not; unhandled action not registered.
   - GREEN: `use-action-hotkeys.ts`.
5. **Settings UI** (AC-006, AC-004, AC-005)
   - RED: `shortcuts-section.test.tsx` - lists all actions w/ formatted binding; record
     round-trip persists; reset restores default; conflict blocks + names owner.
   - GREEN: `shortcuts-section.tsx` + `shortcut-row.tsx`.
6. **App wiring** (AC-002 end-to-end)
   - Hoist `SettingsProvider` to `__root.tsx`; register global + workspace shortcuts;
     render section in `settings.tsx`. Update existing route/layout tests that assumed
     `SettingsProvider` lived in `index.tsx`.
7. **Docs**: README, learnings, ADR.

One commit per AC group: `feat: AC-NNN <desc>`.

## Tests to write (>= one per AC)

| AC | Test | Layer |
|----|------|-------|
| AC-001 | registry exposes all 6 actions w/ defaults; resolve returns them with empty overrides | resolve.test |
| AC-002 | pressing default binding fires handler (console toggle / nav) | use-action-hotkeys.test + shortcuts-section/route test |
| AC-003 | saveShortcut persists override; resolve reflects it; round-trip through store | settings-context.test + shortcuts-section.test |
| AC-004 | resetShortcut removes override; binding back to default | settings-context.test + shortcuts-section.test |
| AC-005 | findConflict returns owner; recording a used combo does not persist + shows owner name | resolve.test + shortcuts-section.test |
| AC-006 | section lists every action with formatted binding + controls | shortcuts-section.test |
| AC-007 | mergeShortcuts drops non-string/invalid/unknown; resolver re-defends | settings.test + resolve.test |
| AC-008 | typing in input does not fire; recorder capture suppresses | use-action-hotkeys.test + shortcuts-section.test |
| AC-009 | close/next/prev no-op with no open request, no throw | use-action-hotkeys.test (guarded handlers) |
| AC-010 | lint/typecheck/test/cargo all green | verifier (Phase 4) |

## Risks

- **Lib API churn (alpha):** `@tanstack/hotkeys` is alpha (per ADR 2026-06-18). Mitigation:
  confine all lib calls to `resolve.ts` + `use-action-hotkeys.ts` + the recorder usage; if
  the API shifts, the blast radius is two files.
- **jsdom `Mod` resolves to Control (learnings):** tests must fire `{Control>}…{/Control}`,
  not Meta. Mitigation: assert via the library's own platform resolution / fire Control in
  tests, reuse the existing convention.
- **Hoisting `SettingsProvider` breaks route tests:** existing tests mount the home route
  expecting the provider there. Mitigation: step 6 updates them; provider still loads async
  so `findBy*` rules from learnings still apply.
- **Escape-as-cancel collides with `close-settings` default:** acceptable + documented
  (E-6); not a user-editable binding.

## Verification

Phase 4 fresh verifier runs lint + typecheck + `npm test` + `cargo test`, reads each test
body against its AC, probes the corrupt-input + no-op + conflict edges. Coverage threshold:
none enforced (no threshold in `vitest.config`/`package.json`).

## Completion

Status: **DONE**. Gates: typecheck clean, lint 0 errors (5 pre-existing accepted
warnings), 131 frontend tests pass, cargo tests pass. Two fresh-context verifier passes:
first confirmed all 10 ACs + flagged two missing end-to-end tests (TC-007, TC-008);
second confirmed both gaps closed and the `useActionHotkeys` `useMemo` removal is safe.

### AC -> test traceability

| AC | Proving test(s) |
|----|-----------------|
| AC-001 | `resolve.test.ts` "should define every in-scope action exactly once" (+ non-empty default/name) |
| AC-002 | `use-action-hotkeys.test.tsx` "should run the handler if the action's effective hotkey is pressed"; `bootstrap.spec.tsx` "should open settings and return to the workspace via the global shortcuts" (global nav, TC-008) |
| AC-003 | `settings-context.test.tsx` "should persist the override via store.save…" + round-trip; `shortcuts-section.test.tsx` "should persist the override if a new free combo is recorded" |
| AC-004 | `settings-context.test.tsx` "should persist the removal…"; `shortcuts-section.test.tsx` "should remove the override and restore the default if reset is clicked" |
| AC-005 | `shortcuts-section.test.tsx` "should name the owning action and not persist…"; `resolve.test.ts` `findConflict` cases (normalized equality + ignores edited action) |
| AC-006 | `shortcuts-section.test.tsx` "should render a row for every in-scope action" + "show each action's current binding formatted for display" |
| AC-007 | `settings.test.ts` `mergeSettings shortcuts` (non-string/invalid/unknown dropped); `resolve.test.ts` resolver re-defends |
| AC-008 | `use-action-hotkeys.test.tsx` "should not run the handler if focus is in a text input" |
| AC-009 | `main.test.tsx` "should not throw if close/next-request fire when no request is open" (real guards, TC-007) |
| AC-010 | lint/typecheck/`npm test`/`cargo test` all exit 0 |

### Decisions / deviations during implementation

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-19 | `safeNormalize` rejects on `validateHotkey` warning containing "Unknown key", not just `!valid` | lib marks unknown keys as `valid:true`+warning; `!valid` only catches empty string. Needed to drop garbage overrides (E-2) |
| 2026-06-19 | tsconfig `target`/`lib` ES2020 -> ES2022 | RED tests use `Array.prototype.at`; runtime is node 24 + modern webview, safe. Routine config, not an ADR |
| 2026-06-19 | Conflict message scoped to `role="alert"` in the section test | original RED query `findByText(/Close request tab/i)` matched both the owner's own row and the alert (ambiguous); asserting on the alert region is the correct, unambiguous check |
