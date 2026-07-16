# Timeout config field (structured UI)

Backlog: `.pzielinski/todos.md` F3

## Overview

`timeoutMs` is a resolved, inheritable `ConfigScope` scalar (`resolve.ts` folds it through the
folder chain, default `DEFAULT_TIMEOUT_MS = 30000`) and is sent on the wire (`build-request.ts`).
Every other config field (vars/auth/headers/params/script) has a structured editor panel; `timeoutMs`
has none - it is only settable via the raw-JSON editor tab. This feature adds a structured number
field for it.

The raw-JSON editor tab (today labeled "Settings", value `"settings"`) is renamed to **Raw** in both
the request pane and the folder pane. A new **Settings** tab (value `"settings"`) is added that hosts
the structured scalar config - the timeout field now, room for future scalars. The request "Edit"
context-menu action keeps opening the Raw tab (unchanged behavior). The app-level Settings view (the
gear, `settings sections` tablist) is unrelated and untouched.

The field is an empty-means-inherit number input: when this scope sets `timeoutMs` the input shows the
own value; when it is unset the input is empty and its placeholder shows the effective value plus its
origin - `30000 (default)` when no ancestor sets it, or `<value> (from <ScopeName>)` when inherited.
Clearing the field removes `timeoutMs` from this scope (falls back to inherit); typing a value sets it.

## Acceptance Criteria

- AC-001: A structured **Settings** tab (tab value `"settings"`) exists in the request pane, alongside Vars/Auth/Headers/Params/Body/Script, hosting the timeout field.
- AC-002: A structured **Settings** tab exists in the folder pane, alongside Vars/Auth/Headers/Script/Env, hosting the timeout field.
- AC-003: The former raw-JSON editor tab is renamed **Raw** (label) in both panes; its tab value becomes `"raw"`. The full-node/folder JSON editor content is unchanged.
- AC-004: Editing the timeout field to a positive integer sets `config.timeoutMs` on that scope and persists on save (same draft+save model as the other structured panels).
- AC-005: Clearing the timeout field removes `timeoutMs` from that scope's config (reverts to inherit) and persists on save.
- AC-006: When the scope sets no `timeoutMs`, the input is empty and its placeholder shows the resolved effective value + origin: `30000 (default)` with no ancestor, `<value> (from <ScopeName>)` when an ancestor sets it.
- AC-007: A non-positive / non-integer / non-numeric entry is rejected (not written to config); the field only ever commits a positive integer or a clear.
- AC-008: The request "Edit" context-menu action and `openConfigEditor` still open the **Raw** tab (behavior preserved).
- AC-009: The `GeneralPanel`/timeout field is design.md-compliant: no rounded corners, theme tokens, IDE density, uses the shared grid/input styling of the existing panels.

## User Test Cases

- TC-001 (happy path): request Settings tab -> type `5000` in timeout -> save -> `config.timeoutMs === 5000`. Maps to: AC-001, AC-004.
- TC-002 (happy path): folder Settings tab -> type `8000` -> save -> folder `config.timeoutMs === 8000`. Maps to: AC-002, AC-004.
- TC-003 (clear/inherit): request with `timeoutMs: 5000` -> clear field -> save -> `config.timeoutMs === undefined`. Maps to: AC-005.
- TC-004 (placeholder default): request whose scope + ancestors set no timeout -> field empty, placeholder contains `30000` and `default`. Maps to: AC-006.
- TC-005 (placeholder inherited): request under a folder with `timeoutMs: 7000`, request unset -> field empty, placeholder contains `7000` and the folder name. Maps to: AC-006.
- TC-006 (reject invalid): type `0` / `-5` / `abc` / `1.5` -> field does not write a `timeoutMs` (config unchanged on save, or clears). Maps to: AC-007.
- TC-007 (rename Raw): request + folder panes expose a **Raw** tab; it renders the raw-JSON editor (a CodeMirror surface); no **Settings**-labeled raw editor remains. Maps to: AC-003.
- TC-008 (Edit jump): `openConfigEditor(requestId)` activates the **Raw** tab. Maps to: AC-008.

## UI States

| State   | Behavior                                                                                 |
| ------- | ---------------------------------------------------------------------------------------- |
| Loading | N/A - purely local, no async.                                                            |
| Empty   | Scope unset -> input empty, placeholder = effective value + origin (`30000 (default)`).  |
| Error   | Invalid entry (non-positive/non-integer/NaN) -> not committed; input reverts on blur.    |
| Success | Valid positive int typed -> shown as the input value; persists on save.                  |

### ASCII wireframe - request/folder Settings tab

```
+---------------------------------------------------------------+
| Vars | Auth | Headers | Params | Body | Script | Settings | Raw|
+---------------------------------------------------------------+
| +-----------+---------------------------------------------+   |
| | Timeout   | [ 5000                                    ] |   |   <- own value set
| +-----------+---------------------------------------------+   |
+---------------------------------------------------------------+

Inherited (own unset), placeholder shows origin:
| +-----------+---------------------------------------------+   |
| | Timeout   | [ 7000 (from Root)                        ] |   |   <- placeholder, input empty
| +-----------+---------------------------------------------+   |

No ancestor sets it:
| +-----------+---------------------------------------------+   |
| | Timeout   | [ 30000 (default)                         ] |   |   <- placeholder, input empty
| +-----------+---------------------------------------------+   |
```

The row mirrors the Auth grid (`8rem` label column + `1fr` value cell, `border-t border-l border-border`,
`AUTH_CELL`/`AUTH_INPUT` density). Folder pane omits the Params/Body tabs (its tab set is
Vars/Auth/Headers/Script/Env/Settings/Raw).

## Data Model

No new persisted model. `timeoutMs?: number` already lives on `ConfigScope` and resolves via
`resolveTimeout`. The feature only adds an editor for it and renames a tab. Tab-value change
`"settings"` -> `"raw"` (raw editor) and new `"settings"` (structured) affects the `RequestTab` union
and the `FolderTab` union; no persisted value keys off the tab id.

## Edge Cases

- Own value set to the same number as the inherited value: still written explicitly (own beats inherited in `resolveTimeout`; that is the user's choice to pin it).
- Clearing when the scope never had `timeoutMs`: no-op (config already lacks the key).
- Leading zeros / whitespace (`" 5000 "`): trimmed then parsed; `5000`.
- Very large value: accepted as a positive integer (Rust side is `u64`); no artificial upper cap beyond integer parsing.
- Fractional (`1.5`) and zero/negative: rejected (timeout must be a positive whole ms count).
- `openConfigEditor` currently forces the tab to the raw editor - it must target the new `"raw"` value, not the new structured `"settings"` value, to preserve behavior.

## Dependencies

- `src/lib/workspace/model.ts` (`ConfigScope.timeoutMs`)
- `src/lib/workspace/resolve.ts` (`resolveTimeout`, `DEFAULT_TIMEOUT_MS`, `EffectiveConfig.timeoutMs`)
- `src/components/workspace/config-panels.tsx` (panel home; shares `AUTH_CELL`/`AUTH_INPUT`)
- `src/components/workspace/request-pane.tsx`, `folder-pane.tsx` (tab wiring)
- `src/components/workspace/workspace-context/types.ts` (`RequestTab` union), `editors.ts` (`openConfigEditor` -> `"raw"`)
- Existing structured-panel draft+save seam (`FolderStructuredEditor`, `setRequestConfig`)
