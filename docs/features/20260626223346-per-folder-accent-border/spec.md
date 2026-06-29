# Per-folder, per-environment accent color (border)

## Overview

Each **environment** gets its own border color, scoped **per folder**. A folder stores a map
`environmentColors: { [envName]: hex }`. The workspace shell's existing borders recolor to the
color of the **active environment** (the sidebar combobox) resolved against the **active tab's**
folder chain (nearest ancestor folder that has a color for that env wins). Switching the active
environment, or switching to a tab in a differently-colored folder, changes the border. It adds no
new border and changes no width - it only overrides the `--border` token on the shell root.

This supersedes the first (wrong) attempt, which stored a single env-blind color per folder. The
correct model: "każdy env ma swój oddzielny kolor; w zależności od aktywnej karty + aktywnego env w
sidebarze - taki kolor." Plus: the sidebar env combobox's **options** are scoped to the active
tab's chain (a folder with no/other envs changes what the combobox offers).

The color **applies live** (persists immediately on pick) - it is NOT part of the folder pane's
Cmd+S draft, so picking never clobbers unsaved variable edits and the border updates instantly.

Presets: **None** (clears that env's color), **Green**, **Blue**, **Red**, plus a native color
picker + hex field for custom.

## Acceptance Criteria

- AC-001: The folder pane **Env** tab's Envs sub-view shows, on the env-selector toolbar, an
  **accent control** (None / Green / Blue / Red swatches + native picker + hex input) that edits
  the color of the **currently-selected environment** in that dropdown.
- AC-002: Picking a preset/custom color sets `environmentColors[selectedEnv]` for that folder
  **immediately** (persisted, no Cmd+S); **None** removes that env's entry.
- AC-003: The colors persist per folder in `folder.json` as `environmentColors` and survive reload.
- AC-004: When the active environment is set and the active tab is in a folder whose chain has a
  color for that env, the shell `--border` is overridden to that color (raw hex; its alpha pair is
  the tint). No new border, no width change.
- AC-005: When the active environment is null, or the active tab's chain has no color for the
  active env, the shell keeps the default border token (no override).
- AC-006: Switching the active environment recolors the border to the new env's color (or clears
  it if the new env has none in the chain). Switching the active tab does the same.
- AC-007: A request/folder **inherits its nearest ancestor folder's** color for the active env;
  with both ancestors colored for that env, the nearest wins. The active env is keyed independently:
  a folder colored only for `prod` shows no border when `local` is active.
- AC-008: A missing/malformed `environmentColors` in `folder.json` is sanitized - non-hex entries
  dropped, the rest kept, no crash.
- AC-009: The sidebar environment combobox lists **only** the env names defined along the active
  tab's chain (root -> active node). With no active tab, it lists all tree envs.
- AC-010: When the active tab changes to a node whose chain does not define the currently-active
  environment, the active environment **resets to No Environment** (and the border clears).

## Test Cases

- TC-001 (happy, AC-001/002): folder Env tab -> pick env `prod` -> click **Red** -> the folder's
  `environmentColors.prod` becomes `#dc262680` immediately (persisted). Maps to: AC-001, AC-002.
- TC-002 (per-env independence, AC-001/002): set `prod`=red, switch dropdown to `local`, the accent
  control shows `local`'s color (empty), set it green -> `prod` stays red. Maps to: AC-001, AC-002.
- TC-003 (clear, AC-002): a red `prod` -> click **None** -> `environmentColors.prod` removed. AC-002.
- TC-004 (persist, AC-003): `deserialize(serialize(...))` round-trips `environmentColors`; folder.json
  carries it only when non-empty. Maps to: AC-003, E-7.
- TC-005 (recolor by env, AC-004/006): active env `prod`, active request in a folder colored red for
  `prod` -> shell `--border` = red; switch active env to `local` (folder green for local) -> green;
  switch to `staging` (no color) -> cleared. Maps to: AC-004, AC-005, AC-006.
- TC-006 (inherit, AC-007): active env `prod`, request in an uncolored child of a parent colored red
  for `prod` -> red; color the child blue for `prod` -> blue wins. Maps to: AC-007.
- TC-007 (env keying, AC-007): folder colored only for `prod`; active env `local` -> no border. AC-007.
- TC-008 (garbage, AC-008/E-2): `environmentColors` with a non-hex value / non-object -> sanitized,
  folder intact. Maps to: AC-008.
- TC-009 (sidebar scope, AC-009): active request under folder A (envs prod/local) -> combobox =
  [No Environment, local, prod]; switch to folder B (env staging only) -> [No Environment, staging].
- TC-010 (reset, AC-010): active env `prod`, switch active tab to folder B (no `prod`) -> active env
  resets to No Environment, border clears. Maps to: AC-010.

## UI States

| State                       | Behavior                                                                |
| --------------------------- | ----------------------------------------------------------------------- |
| No active env               | Default border token; no override regardless of folder colors.          |
| Active env, chain colored   | Shell `--border` = that env's color from the nearest ancestor folder.   |
| Active env, chain uncolored | Default border (no override).                                           |
| Pick a color                | Persists immediately; border updates live; no dirty dot.                |
| Switch env dropdown in panel| Accent control shows the newly-selected env's color.                    |
| Tab -> folder w/o that env  | Sidebar combobox options change; active env resets to No Environment.   |

### ASCII wireframe - folder Env tab, Envs sub-view (accent on the env toolbar)

```
+----------------------------------------------------------------+
| Vars | Auth | Headers | Params | Script | Env | Settings        |
+----------------------------------------------------------------+
| Envs | .env                                                    |
+----------------------------------------------------------------+
| [ prod        v ] [+] [Trash] | Accent /  gn bl rd [] #dc262680 |
+----------------------------------------------------------------+
| key                          | value                           |
| BASE_URL                     | https://prod.example.com        |
| ...                          | ...                             |
+----------------------------------------------------------------+
```

(Accent control edits the env picked in the left dropdown. `/`=None, gn/bl/rd=presets, `[]`=native
picker, trailing box=`#rrggbb(aa)` hex. Flush, 1px dividers, no rounded corners - per design.md.)

## Data model

- `FolderNode.environmentColors?: Record<string, string>` (runtime, sibling of `config`/`dotenv`).
  Each value a lowercase `#rrggbb`/`#rrggbbaa` hex. Folder-only; requests inherit, never carry.
- `folder.json` gains optional `environmentColors`. `serialize` emits it only when non-empty;
  `deserialize` sanitizes: keep only entries whose value is a `#rrggbb`/`#rrggbbaa` hex (lowercased),
  drop the field entirely if not an object or no valid entries survive.
- `Scope` (resolve.ts) gains `environmentColors?` populated only for folders (like `dotenv`).
- Resolution `accentColorFor(tree, nodeId, env)`: null if `env` null; else `findScopePath` then
  reverse-find the nearest scope with `environmentColors[env]` set.
- Sidebar scope `environmentNamesForScope(tree, nodeId)`: union of `config.environments` keys along
  the chain root -> node (null nodeId -> all tree envs).

## Edge cases

- E-1: active env null -> no override.
- E-2: malformed `environmentColors` (non-object, non-hex value) -> sanitized on deserialize.
- E-3: **None** -> remove that env's entry; if the map empties, omit the field from folder.json.
- E-4: custom hex via picker -> stored lowercase.
- E-5: request at workspace root (no ancestor folder) -> no color.
- E-6: nested folders both colored for the env -> nearest wins.
- E-7: round-trip keeps `environmentColors`.
- E-8: folder colored for `prod` only, active env `local` -> no border (env keyed).
- E-9: active env not in the active tab's chain -> env resets to null, border clears (AC-010).

## Dependencies

None. No new packages. Persistence reuses the folder disk-format pipeline. The color write is a
new live tree action (`setFolderEnvColor`) - deliberately outside the folder pane Cmd+S draft so it
applies instantly without clobbering unsaved variable edits.

## Status: DONE

Implemented + verified (fresh-context verifier: PASS). Full suite 1323 green (incl. 46 new accent
tests), lint 0 errors, typecheck clean, no `any`. Both reported bugs fixed: live border (no Cmd+S)
+ per-env picker.

### AC -> proving test

| AC | Test |
| --- | --- |
| AC-001 | `accent-field.test.tsx` "should render the accent preset swatches, native picker and hex input on the Env toolbar" / "should show the selected env's saved color in the hex field" |
| AC-002 | `accent-field.test.tsx` "should persist the selected env's color live without a Cmd+S and without marking dirty" / "should leave other envs' colors untouched..." / "should remove the selected env's color if None is clicked" / custom-hex |
| AC-003 | `disk-format-accent.test.ts` round-trip + emit-only-when-non-empty |
| AC-004 | `accent-border.test.tsx` "should override --border with the active env's color if the active request is in a colored folder" |
| AC-005 | `accent-border.test.tsx` "should not override --border if there is no active environment" |
| AC-006 | `accent-border.test.tsx` "should recolor --border to the new env's color if the active environment switches" |
| AC-007 | `resolve-accent.test.ts` (inherit / nearest-wins / env-keyed / folder-own / uncolored-child-inherits) + `accent-border.test.tsx` nested-inherit |
| AC-008 | `disk-format-accent.test.ts` sanitize block (non-object / numeric / 3-digit / all-garbage-drops-field, each paired with a valid sibling) |
| AC-009 | `env-scope.test.tsx` "should list only the active tab's chain envs" + `resolve-accent.test.ts` `environmentNamesForScope` chain-union |
| AC-010 | `env-scope.test.tsx` reset case + keep case; `accent-border.test.tsx` border-clears-on-tab-change |
