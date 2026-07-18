# Spec: Themes (light / dark / system + custom colors)

**Version:** 0.1.0
**Created:** 2026-06-25
**Status:** Draft (awaiting approval)
**Branch:** `20260625155948-themes`

## 1. Overview

purerequest today is light-only. `index.css` ships both a `:root` (light) and a `.dark` token block, but
**nothing ever toggles the `.dark` class** - the dark block is dead code, and there is no theme UI.

This feature adds a real theme system:

- A **mode**: `light`, `dark`, or `system` (follows the OS `prefers-color-scheme`).
- **Per-mode color customization**: the user can override any app color token (light set and dark set
  are edited independently) **and** the CodeMirror editor syntax colors.
- **JSON persistence**, split across two files mirroring the existing `settings.json` / `keymap.json`
  split: the **mode** lives in `settings.json` (device-local UI state), the **custom colors** live in a
  new **`theme.json`** (so a color scheme is portable/syncable independently of device-local state).
- **Editors follow the theme and are customizable**: the request body / response viewer / config / env /
  script editors and the console viewer currently use a hardcoded JetBrains Darcula (dark) scheme. They
  now swap with the active mode (a new built-in light editor scheme is added) and their syntax colors are
  user-overridable like the app tokens.

### Scope

- **In:**
  - Mode selector (light / dark / system) in the Settings tab; applied live; persisted to `settings.json`.
  - `system` resolves via `window.matchMedia("(prefers-color-scheme: dark)")` and reacts to OS changes
    while the app is open.
  - Per-mode customization of **18 app tokens** + **9 editor-syntax tokens** via a **raw-JSON CodeMirror
    editor** in the Settings tab (the same edit surface purerequest uses for config / `.env` / request Settings:
    JSON syntax highlighting + lint underline on malformed JSON). Values are `oklch(...)` strings (matching
    `index.css`).
  - The editor is **seeded with the full effective color set** (every token, showing its current value -
    override or built-in default) so all tokens are discoverable; on save, the persisted `theme.json` keeps
    only entries that **differ from the built-in default** (sparse) so an untouched token always tracks the
    built-in default even if the default later changes. Editing a token back to its default value drops it
    from `theme.json` = the per-token "reset".
  - Editors (6 CodeMirror surfaces) follow the active mode and honor custom editor colors, reactively.
  - UI layout: the Theme section shows the **mode selector** + a **single raw-JSON editor** holding both
    modes' colors (`{ light: {tokens, editor}, dark: {tokens, editor} }`), so either mode is editable
    regardless of which is active.
  - Tauri `theme.json` adapter split; in-memory store + dev-browser unaffected (theme still works in
    `npm run dev`, persistence is a no-op there as with other settings).
- **Out:**
  - Per-workspace themes (theme is per-installation, like the rest of `settings.json`).
  - Importing/exporting theme files via a picker, sharing theme presets, named theme presets beyond
    light/dark (YAGNI - "customize both theme colors" = customize the light set and the dark set).
  - Customizing the editor **chrome structure** (transparent background, gutter layout) - only the
    syntax/caret/selection **colors** are customizable; chrome stays structural and inherits the pane.
  - Alpha-channel editing in the picker (hex pickers are opaque). The two dark tokens that ship with
    alpha (`border`, `input`) keep their default alpha **until** the user explicitly overrides them, at
    which point they become opaque. Documented edge case, not a feature.
  - A separate "high-contrast" or font/spacing theming - colors only.

### Decisions captured (from clarifying questions)

- **Customizable tokens = all app tokens** (the full shadcn set in `index.css`, currently 18 incl.
  `*-foreground` pairs), not a curated subset.
- **Color input = raw-JSON CodeMirror editor** (matches purerequest's config / `.env` / request-Settings edit
  convention - learnings: "Config editing lives in panes... raw JSON + Mod+S"). Values are `oklch(...)`
  strings to match `index.css`. **No hex picker, no color conversion, no new dependency** (the earlier
  hex-picker answer was superseded by the "display JSON" layout choice).
- **Editors follow theme AND are customizable** - editor syntax colors live in `theme.json` too.
- **File split:** `theme.json` = custom colors; `settings.json` = mode.

## 2. Acceptance Criteria

- **AC-001**: Setting mode to **Light** applies the light token set: `.dark` class is absent from
  `<html>` and `bg-background` resolves to the light value.
- **AC-002**: Setting mode to **Dark** applies the dark token set: `.dark` class is present on `<html>`.
- **AC-003**: Setting mode to **System** follows `prefers-color-scheme`: dark when the OS prefers dark,
  light otherwise; **and** flips live when the OS preference changes while the app is open (no restart).
- **AC-004**: The selected mode persists to `settings.json` under a `theme.mode` field and is restored on
  next launch (a dark choice reopens dark).
- **AC-005**: A user-set custom value for an **app token** in a given mode is applied live (e.g. overriding
  light `primary` immediately recolors primary surfaces while in light mode) and persisted to `theme.json`.
- **AC-006**: Custom colors persist to `theme.json` (NOT `settings.json`) and are restored on next launch;
  `settings.json` carries only `theme.mode`, never the color map.
- **AC-007**: Only overridden tokens are stored; an un-customized token always renders the built-in
  default for its mode (changing the built-in default in `index.css`/editor scheme moves an un-overridden
  token, a customized one does not).
- **AC-008**: "Reset" a single token removes its override (it reverts to the built-in default); "Reset all"
  for a mode clears every override in that mode.
- **AC-009**: The JSON editor seeds with the full effective color set (every app + editor token for both
  modes, each showing its override-or-default value); editing a token to a new `oklch(...)` value and
  saving persists it, and editing it back to the built-in default value drops it from `theme.json`
  (sparse-store = per-token reset). Malformed JSON shows a lint underline and blocks the save (consistent
  with the other raw-JSON editors).
- **AC-010**: The CodeMirror editors (body, config, env, script, json-viewer/response, console) render with
  the **active mode's** editor scheme: dark mode shows the Darcula-derived dark scheme, light mode shows
  the built-in light editor scheme.
- **AC-011**: A user-set custom **editor-syntax** color (e.g. dark `string`) is applied live to every CM
  surface and persisted to `theme.json` per mode.
- **AC-012**: Switching mode (or OS change under `system`) re-themes the editors live without a remount of
  the whole app (the open editor recolors in place).
- **AC-013**: In `npm run dev` (no Tauri host) the theme UI works and applies live; persistence is a no-op
  (mode/colors fall back to defaults on reload), consistent with existing settings behavior.

## 3. User Test Cases

- **TC-001** (happy, mode): Open Settings → Theme → pick **Dark** → workspace turns dark immediately.
  Reload → still dark. Maps to: AC-001, AC-002, AC-004.
- **TC-002** (system): Pick **System** with OS in light → app is light. Flip OS to dark (or emulate) →
  app turns dark with no reload. Maps to: AC-003.
- **TC-003** (custom app token): In **Light**, change `primary` to red via the picker → primary buttons
  turn red immediately. Reload → still red. Switch to **Dark** → dark `primary` is unchanged (per-mode).
  Maps to: AC-005, AC-006, AC-007.
- **TC-004** (reset): After TC-003, edit light `primary` back to its built-in oklch value (or remove the
  line) and save → the override disappears from `theme.json` and primary reverts. Maps to: AC-008.
- **TC-005** (editor follows theme): With a request body open, switch Light↔Dark → the body editor's
  syntax colors swap between the light and dark editor schemes without losing the open document.
  Maps to: AC-010, AC-012.
- **TC-006** (custom editor color): In **Dark**, change the editor `string` color to orange → JSON string
  literals in the body editor + response viewer + console turn orange. Reload → still orange.
  Maps to: AC-011.
- **TC-007** (file split): After customizing, inspect the config dir: `settings.json` has `theme.mode`
  only; `theme.json` has the color overrides. Maps to: AC-006.
- **TC-008** (persistence boundary): In `npm run dev`, pick Dark + customize a color → applies live;
  reload → reverts to defaults (no native store). Maps to: AC-013.

## 4. UI States

| State                      | Behavior                                                                                  |
| -------------------------- | ----------------------------------------------------------------------------------------- |
| Theme section initial      | Mode selector shows current mode; JSON editor seeded with the full effective color set (overrides layered over defaults), both modes present. |
| Mode = system, OS resolves | Applied DOM reflects the OS-resolved mode; selector still reads "System".                  |
| Editing the JSON           | Live lint underline on malformed JSON; Save (Mod+S / close popup) disabled while invalid - same as config/`.env` editors. |
| Saved with overrides       | Only tokens differing from the built-in default are written to `theme.json`; effective view re-seeds with the merged set. |
| Invalid stored color       | A malformed value/key in `theme.json` is ignored on load (falls back to default for that token). |
| Dev browser (no host)      | Section fully interactive; changes apply live; persistence is a silent no-op on save.      |

## 5. Data Model

### 5.1 Settings model additions (`src/lib/settings/settings.ts`)

```ts
export type ThemeMode = "light" | "dark" | "system";

// Sparse per-mode override maps. Keys are token names; values are oklch(...) strings.
// Absent key = use the built-in default for that token in that mode.
export type ThemeColorOverrides = {
  tokens: Partial<Record<AppTokenName, string>>;   // 18 app tokens
  editor: Partial<Record<EditorTokenName, string>>; // 9 editor-syntax tokens
};

export type ThemeColors = {
  light: ThemeColorOverrides;
  dark: ThemeColorOverrides;
};

export type ThemeSettings = {
  mode: ThemeMode;        // -> settings.json
  colors: ThemeColors;    // -> theme.json (stripped by the Tauri adapter)
};

// Added to Settings:
//   theme: ThemeSettings
// DEFAULT_SETTINGS.theme = { mode: "system", colors: { light: {tokens:{},editor:{}}, dark: {...} } }
```

`Settings.version` stays `1`; `mergeSettings` gains tolerant merging of `theme` (mirrors how
`workspacePath`/`activeEnvironment` were added without a version bump - learnings note: model is
file-agnostic, the split lives only in the adapter).

### 5.2 Token name unions (single source of truth)

`AppTokenName` (18): `background`, `foreground`, `card`, `card-foreground`, `popover`,
`popover-foreground`, `primary`, `primary-foreground`, `secondary`, `secondary-foreground`, `muted`,
`muted-foreground`, `accent`, `accent-foreground`, `destructive`, `border`, `input`, `ring`.

`EditorTokenName` (9): `caret`, `selection`, `gutter`, `keyword`, `string`, `number`, `property`,
`comment`, `invalid`.

Built-in defaults for both modes are read from one canonical table (`theme-defaults.ts`), keeping the
`index.css` light/dark values and the editor light/dark schemes as the source of truth in TS so the UI can
seed swatches and the "reset" semantics have a target.

### 5.3 On-disk shape

`settings.json` (existing file, new field):

```json
{ "...": "...", "theme": { "mode": "dark" } }
```

`theme.json` (new file, mirrors `keymap.json`):

```json
{
  "colors": {
    "light": { "tokens": { "primary": "oklch(0.55 0.22 27)" }, "editor": {} },
    "dark":  { "tokens": {}, "editor": { "string": "oklch(0.74 0.15 60)" } }
  }
}
```

### 5.4 Override extraction (`src/lib/theme/overrides.ts`, pure, no dep)

The JSON editor surface is the full effective color set; persistence stores only the diff vs the built-in
defaults.

- `diffOverrides(edited: ThemeColors, defaults): ThemeColors` - per mode/section/token, keep an entry only
  if its value `!==` the built-in default. (Whitespace-insensitive compare of the `oklch(...)` string.)
- `applyDefaults(overrides, defaults): ThemeColors` - layer sparse overrides over the defaults to produce
  the full effective set used to seed the editor and apply to the DOM.
- No color-space conversion is needed (values are stored and edited as `oklch(...)` strings verbatim).
  A malformed value (not a parseable `oklch(...)`/color string) is dropped on the tolerant merge.

## 6. Theme application mechanism

A `ThemeProvider` (or an effect in the settings/theme context) computes the **effective mode**:

- `mode === "system"` → `matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"`,
  re-evaluated on the media-query `change` event.
- Applies to the DOM:
  - Toggle `.dark` class on `document.documentElement` for the effective mode.
  - For each **overridden** app token in the effective mode, set the inline CSS var on
    `document.documentElement` (`--background`, ...). Inline style beats both `:root` and `.dark` rules,
    so only the active mode's overrides need applying; on mode flip, clear and reapply. Tailwind's
    `@theme inline` re-derives `--color-*` from these base vars automatically.
- Exposes the **effective editor colors** (built-in scheme for the mode, with overrides layered) to the
  CodeMirror surfaces via context.

### CodeMirror integration

`editor-theme.ts` exports become **factories** parameterized by editor colors:

- `makeChrome(colors, isDark)` → `EditorView.theme({...}, { dark: isDark })`
- `makeHighlight(colors)` → `HighlightStyle.define([...])`
- `makeViewerExtensions(colors, isDark)` / `makeEditorExtensions(...)`

A `useEditorExtensions()` hook returns memoized extensions keyed on the active editor colors. Each of the
6 CM consumers (`body-editor`, `config-editor`, `env-editor`, `script-editor`, `json-viewer`, `console`)
swaps its module-const `extensions` for the hook output so `@uiw/react-codemirror` reconfigures on change.
Chrome background stays `transparent` (inherits the now-themed pane), so no white-flash regression
(learnings #49) - the light scheme relies on the pane bg, never a solid editor bg.

## 7. Edge cases

- **Malformed `theme.json`** (hand-edited garbage, wrong types): tolerant merge drops invalid entries,
  falls back to defaults per token. Never throws on load.
- **Unknown token key** in `theme.json` (a renamed/removed token): ignored by the merge (keyed to the
  known union).
- **Invalid oklch string** for a token: ignored on the tolerant merge (default used); editor still seeds
  from the default for that token.
- **Alpha tokens** (dark `border`/`input` ship `/ 10%`): stored/edited verbatim as their `oklch(... / 10%)`
  string; the JSON editor shows the alpha and the user may keep or change it (no picker = no alpha loss).
- **System mode with no `matchMedia`** (jsdom/older webview): default to light; the listener wiring is
  guarded so absence doesn't throw.
- **Mode flip mid-edit of a request body**: editor recolors via the reactive extensions; the document
  content is preserved (no key remount tied to theme).
- **Dev browser**: in-memory settings store → live apply works, save is a no-op (reload reverts).
- **First launch / no `theme.json`**: defaults (`mode: "system"`, no overrides).

## 8. Dependencies

- No new npm/Rust dependency. Colors are edited/stored as `oklch(...)` strings - no color-space conversion.
  The JSON editor reuses the existing `RawJsonEditor`/CodeMirror + lint stack.
- Reuses the existing Tauri Store plugin (`@tauri-apps/plugin-store`); a second `LazyStore("theme.json")`
  in the settings adapter (the `store:default` capability is plugin-scoped, not per-file - learnings #45,
  so no capability change).
- Touches `index.css` only to (optionally) confirm the dark block stays the canonical dark default; no
  structural CSS change required since overrides are injected as inline vars.

## 9. Domain-modeling gate (mandatory)

- **pz-ddd**: evaluated → **does not apply.** No new domain model, aggregate, consistency boundary, or
  cross-module workflow; this is per-installation UI configuration plumbing (same layer as shortcuts/UI
  settings).
- **pz-archetypes**: evaluated → **does not apply.** The problem shape is not accounting / inventory /
  ordering / pricing / party / product / quantity / rules / plan-vs-execution / graphs. It is a
  preferences/config surface.
- **Verdict:** neither applies - pure settings/UI plumbing. (Recorded in the Decision Log.)

## 10. Risks

- **Editor reactivity / jsdom CM gotchas** (global StyleModule dedup, white-bg injection - learnings #49,
  #137): mitigation - keep chrome bg transparent; assert highlight via the factory output and a rendered
  surface; cover mode-swap by re-rendering with different colors and reading the injected rule, not by
  pixel.
- **Inline-var application timing** (flash of default before override applies): mitigation - apply in a
  layout effect on load; defaults already render correctly so worst case is a momentary default, not a
  broken state.
- **Scope size**: this is a large feature (mode + 27 customizable tokens × 2 modes + editor refactor of 6
  surfaces). Mitigation - **staged delivery on one branch** (see §14): mode → app-token customization →
  editor-follows-theme + editor customization, each stage independently verifiable.

## 11. Decision Log

Append-only.

| Date       | Decision                                                                                          | Rationale                                                                                          |
| ---------- | ------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| 2026-06-25 | Domain gate: pz-ddd evaluated/not invoked, pz-archetypes evaluated/not invoked.                   | Per-install UI config plumbing; no aggregates/consistency boundaries/recurring domain shape.       |
| 2026-06-25 | Mode → `settings.json`, custom colors → new `theme.json`; colors stripped by the Tauri adapter.   | User directive (file split); mirrors the existing `shortcuts`→`keymap.json` adapter-only split.    |
| 2026-06-25 | All 18 app tokens customizable (not a curated subset).                                            | User choice.                                                                                       |
| 2026-06-25 | Colors edited via a raw-JSON CodeMirror editor (no hex picker, no color conversion, no new dep).  | Supersedes the earlier hex-picker answer; user picked "display JSON" layout; matches config/`.env` edit convention. |
| 2026-06-25 | Editors follow theme AND are customizable; add a built-in light editor scheme; 9 editor tokens.   | User choice; unifies app + editor theming under one `theme.json`.                                  |
| 2026-06-25 | Store only overrides (sparse), defaults from a canonical TS table; editor seeds with full effective set. | Un-customized tokens track built-in defaults; smaller, forward-compatible `theme.json`; all tokens discoverable in the editor. |
| 2026-06-25 | Apply active-mode overrides as inline CSS vars on `<html>` (not a `<style>` block).               | Inline beats `:root`/`.dark` selectors; only one mode is live at a time; no specificity battles.   |
| 2026-06-25 | `DEFAULT_SETTINGS.theme.mode = "system"`.                                                          | Sensible default - respect the OS until the user chooses.                                          |
| 2026-06-25 | One feature/branch, staged plan (mode → app colors → editor theming).                             | User choice; large but cohesive; each stage independently verifiable.                              |

## 12. Coverage threshold

Detected from `vitest.config.ts`: **none** (no coverage gate configured; verifier asserts the full suite passes, not a %).

## 13. Infrastructure Prerequisites

| Category              | Requirement |
| --------------------- | ----------- |
| Environment variables | N/A         |
| Registry images       | N/A         |
| Cloud quotas          | N/A         |
| Network reachability  | N/A         |
| CI status             | N/A         |
| External secrets      | N/A         |
| Database migrations   | N/A (the `theme.json` store auto-creates; `settings.json` `theme` field is tolerant-merged) |

Verification before implementation: none required - all client-side.

## 15. AC traceability (filled after verification)

Status: **all ACs PASS** (fresh-context verifier, 2026-06-25). Suite green except the
pre-existing CM-save flake (learnings #139), which passes in isolation.

| AC | Proving test(s) |
| --- | --- |
| AC-001 | `theme-context.test.tsx` "should NOT put the dark class ... if mode is light"; `effective-mode.test.ts` light cases |
| AC-002 | `theme-context.test.tsx` "should put the dark class ... if mode is dark"; `theme-section.test.tsx` "should apply dark live to the html element" |
| AC-003 | `theme-context.test.tsx` "should flip the dark class live ..." + no-matchMedia fallback |
| AC-004 | `settings-theme.test.ts`; `settings-context-theme.test.tsx` round-trip; `tauri-store-theme.test.ts` "leave only theme.mode in settings.json" |
| AC-005 | `theme-context-colors.test.tsx` (`--primary` inline); `overrides.test.ts`; `theme-section-colors.test.tsx` "persist the sparse diff" |
| AC-006 | `tauri-store-theme.test.ts` (colors→theme.json, mode-only→settings.json, round-trip) |
| AC-007 | `overrides.test.ts` (diff keeps only differing); `theme-defaults.test.ts` (defaults mirror index.css) |
| AC-008 | `overrides.test.ts` (drop == default, whitespace-insensitive); `theme-section-colors.test.tsx` "drop an override edited back to the default"; `apply-vars.test.ts` (clear stale var) |
| AC-009 | `theme-section-colors.test.tsx` (full-set seed, block on malformed/wrong-shape, keep-enabled valid) |
| AC-010 | `editor-theme-factories.test.ts` (light vs dark string color); `use-editor-extensions.test.tsx` (distinct identities) |
| AC-011 | `body-editor-theme-follow.test.tsx` (custom dark string sentinel in CSS); `console.test.tsx` "color a tokenized number with the active editor number color" |
| AC-012 | `body-editor-theme-follow.test.tsx` "preserve the open document when the mode flips"; `use-editor-extensions.test.tsx` (memo stable/distinct) |
| AC-013 | `tauri-store-theme.test.ts` fallback + `in-memory-store` no-op mechanism |

Post-verification fix: the console **tokenized-line** path (`console.tsx`) was migrated off its
hardcoded Darcula hex onto the active editor colors (`editorColors` from the hook), so inline
console tokens follow the theme + honor custom editor colors like the object-viewer path already
did. Covered by the new `console.test.tsx` AC-011 case.

## 14. Staged delivery (one branch, sequenced)

Single feature folder + branch `20260625155948-themes`, one PR at the end. The plan sequences the work so
each stage is independently green-able:

- **Stage 1 - Mode (AC-001..004, 013-partial):** `ThemeMode` + `theme.mode` in the settings model/merge,
  `theme.mode` persisted to `settings.json`, the apply-effect (`.dark` toggle + `system`/`matchMedia`
  listener), and the mode selector UI in the Theme section. App tokens still come from `index.css`
  (light + the now-live `.dark` block). Verifiable on its own: light/dark/system switch + persist.
- **Stage 2 - App-token customization (AC-005..009, 013):** `theme.json` adapter split, `ThemeColors`
  model + tolerant merge, `theme-defaults.ts` canonical table, `overrides.ts` diff/apply, inline-CSS-var
  application for the active mode, and the raw-JSON editor surface in the Theme section.
- **Stage 3 - Editor theming (AC-010..012):** add the built-in light editor scheme, convert
  `editor-theme.ts` consts to color-driven factories, the `useEditorExtensions` hook + context, wire the 6
  CM consumers, and extend the JSON editor / defaults / overrides with the 9 editor tokens.
