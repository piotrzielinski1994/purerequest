# Keymap multi-binding, binding removal, mac Option-record fix, panel focus-on-toggle

Branch: `20260714113951-keymap-multibind-and-panel-focus`

## Overview

Four related keyboard/shortcut improvements, one branch:

1. **Multiple bindings per action** - an action can be triggered by more than one hotkey (e.g. Toggle sidebar on `⌘B` *and* `⌥1`).
2. **Remove a binding entirely** - a single binding can be deleted; deleting the last one leaves the action with no shortcut (disabled).
3. **Fix mac Option-key recording** - recording `⌘⌥P` currently stores the *default* `⌘⇧P` instead of the pressed combo. Root cause: the vendored `@tanstack/hotkeys` recorder builds the hotkey from `event.key`, and macOS Option composes the key into a special char (`⌥P` → `event.key = "π"`), which `safeNormalize` rejects as an unknown key, so `resolveShortcuts` silently reverts to the registry default. The *matcher* already falls back to `event.code`; the recorder must too.
4. **Focus a panel when toggled open** - toggling the sidebar/console visible moves keyboard focus into it (roving tree row / scrollable console region) so the user can immediately navigate with arrows; toggling it hidden returns focus to the content area.

## Data model

Current override model is one hotkey string per action:

```ts
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string>>;
// resolveShortcuts(...) => Record<ShortcutActionId, string>
```

New model = a **list** of hotkeys per action:

```ts
export type ShortcutOverrides = Partial<Record<ShortcutActionId, string[]>>;
// resolveShortcuts(...) => Record<ShortcutActionId, string[]>
```

Resolution semantics (the single source of truth for every consumer):

| Stored override for id | Effective bindings          | Meaning                    |
| ---------------------- | --------------------------- | -------------------------- |
| absent (no key)        | `[action.defaultHotkey]`    | registry default           |
| `["Mod+B", "Alt+1"]`   | those (each normalized)     | custom, multiple           |
| `[]`                   | `[]`                        | disabled, no shortcut      |
| legacy `"Mod+B"` (str) | `["Mod+B"]`                 | migrated on read           |

Invalid individual entries are dropped from the list; a non-array/non-string override value is ignored (falls back to default). An empty resolved list means the action has no keyboard trigger (still runnable from the command palette).

## Acceptance criteria

Multi-binding + removal (points 1-2):

- **AC-001**: An action with no override resolves to exactly `[action.defaultHotkey]`.
- **AC-002**: Adding a second/third binding to an action makes **every** bound hotkey trigger the action.
- **AC-003**: Removing one binding from a multi-binding action leaves the remaining bindings working.
- **AC-004**: Removing the last binding disables the action - no hotkey triggers it, and its stored override is `[]`.
- **AC-005**: Reset restores the action to its single registry default and clears the stored override (Reset shows only while an override exists).
- **AC-006**: Adding a hotkey already bound to a *different* action is rejected with a conflict message and not saved; adding a hotkey already in *this* action's list is a no-op (no duplicate).
- **AC-007**: Persistence round-trips the array model: a legacy single-string override reads as a one-element list; a non-array value is ignored (default); invalid individual hotkeys are dropped; `[]` persists as disabled.
- **AC-008**: The command palette shows an action's first effective binding (nothing when disabled) and still runs the action.

Mac Option recording (point 3):

- **AC-009**: Recording a combo whose key composes under Option on macOS (`⌘⌥P` → `event.key="π"`, `event.code="KeyP"`) stores the **physical** combo (`Mod+Alt+P`), i.e. the same thing the matcher fires on - not the default.
- **AC-010**: Recording an ASCII-letter combo stores the layout key from `event.key` (so a remapped layout such as Dvorak records what the matcher will match, not the physical position).

Panel focus-on-toggle (point 4):

- **AC-011**: Toggling the sidebar from hidden → visible moves focus to the sidebar tree's roving row so arrow keys navigate it immediately.
- **AC-012**: Toggling the console from hidden → visible moves focus into the console region (a focusable, scrollable element).
- **AC-013**: Toggling either panel visible → hidden returns focus to the content area (focus is not left on the unmounted panel).

## Test cases

- **TC-001** (AC-001): `resolveShortcuts({})[id]` equals `[action.defaultHotkey]` for every action.
- **TC-002** (AC-002): with override `{"toggle-console": ["Mod+J","Mod+K"]}`, `useActionHotkeys` fires the handler on **both** Ctrl+J and Ctrl+K (jsdom = non-mac → Mod=Control).
- **TC-003** (AC-003): resolve of `["Mod+J","Mod+K"]` minus `Mod+K` = `["Mod+J"]`; handler still fires on Ctrl+J.
- **TC-004** (AC-004): override `{"toggle-console": []}` → `resolveShortcuts[id] === []`; `useActionHotkeys` never fires for it.
- **TC-005** (AC-005): `resetShortcut(id)` removes the key from stored overrides; resolve returns `[default]`.
- **TC-006** (AC-006): `findConflict("Mod+W", "toggle-console", effective)` returns `"close-request"`; `findConflict` of a hotkey already in the same action's own list returns `null` (self ignored); `addShortcut` with a dup is a no-op.
- **TC-007** (AC-007): `mergeShortcuts("Mod+B")` legacy string → `["Mod+B"]`; `mergeShortcuts(["Mod+B","bogus!!"])` → `["Mod+B"]`; `mergeShortcuts(42)` → dropped; `mergeShortcuts([])` → `[]`.
- **TC-008** (AC-008): a disabled action's palette command has no binding text but its `run()` still invokes the handler.
- **TC-009** (AC-009): `eventToHotkey({metaKey, altKey, key:"π", code:"KeyP"}, "mac")` === `"Mod+Alt+P"`.
- **TC-010** (AC-010): `eventToHotkey({metaKey, key:"l", code:"KeyP"}, "mac")` === `"Mod+L"` (layout key wins for ASCII letters; not `Mod+P`).
- **TC-011** (AC-009 recorder): a recorder keydown of the composed event calls `onRecord("Mod+Alt+P")`; Escape calls `onCancel` and records nothing; a modifier-only keydown records nothing.
- **TC-012** (AC-011): showing the sidebar focuses the roving tree row (`rowRefs[rovingId]` becomes `document.activeElement`).
- **TC-013** (AC-012): showing the console focuses the console `<section>` (has `tabIndex=-1`).
- **TC-014** (AC-013): hiding a panel focuses the content region element.

## UI states (Shortcuts settings row)

| State       | Behavior                                                                        |
| ----------- | ------------------------------------------------------------------------------- |
| Default     | One binding chip (the default), `[+ Add]`, no Reset.                             |
| Multi       | N binding chips each with an `x`, `[+ Add]`, `[Reset]`.                          |
| Recording   | Existing chips + "Press keys…" + `[Cancel]`; Escape or Cancel aborts.            |
| Conflict    | "<Action> already uses that shortcut" alert; binding not added.                  |
| Disabled    | "(disabled)" text, `[+ Add]`, `[Reset]`. No hotkey triggers the action.          |

### ASCII wireframe (Shortcuts section rows)

```
+------------------------------------------------------------------------+
| Toggle sidebar         [ ⌘B  x ] [ ⌥1  x ]        [ + Add ] [ Reset ]   |
+------------------------------------------------------------------------+
| Toggle console         (disabled)                 [ + Add ] [ Reset ]   |
+------------------------------------------------------------------------+
| New request            [ ⌘T  x ]                  [ + Add ]             |
+------------------------------------------------------------------------+

  recording (after + Add):
+------------------------------------------------------------------------+
| New request            [ ⌘T  x ]   Press keys…             [ Cancel ]   |
+------------------------------------------------------------------------+

  conflict (tried to add ⌘K, owned by another action):
+------------------------------------------------------------------------+
| New request  [ ⌘T  x ]   Open command palette already uses that shortcut|
+------------------------------------------------------------------------+
```

No rounded corners (design contract). Chips reuse existing muted/mono styling; `x` and Add/Reset are the existing `Button` variants (ghost/outline, `size="sm"`).

## Edge cases

- **E-1** Add a hotkey already in the same action's list → no-op, no duplicate entry (TC-006).
- **E-2** Disabled action (`[]`) is skipped by `useActionHotkeys`, `resolveTreeKey`, and the context-menu key matcher; findConflict never reports a disabled action as an owner.
- **E-3** Legacy string override migrated to `[string]` on read so existing users keep custom bindings (TC-007).
- **E-4** Recording an unbindable/modifier-only event records nothing (recorder ignores it, keeps listening).
- **E-5** Showing the sidebar when the tree is empty (no roving row) focuses nothing extra (no crash); focus stays where it was.
- **E-6** Toggling a panel via the command palette or a keyboard shortcut both route through the same handler, so both get the focus behavior.
- **E-7** `findConflict` compares normalized forms and ignores the action being edited (unchanged behavior, now over lists).

## Dependencies

- Vendored `@tanstack/hotkeys` (already installed): reuse `normalizeHotkeyFromParsed`, `normalizeKeyName`, `isModifierKey`, `PUNCTUATION_CODE_MAP`, `detectPlatform`, `matchesKeyboardEvent`, `formatForDisplay`. The library `useHotkeyRecorder` (react-hotkeys) is **replaced** by an in-repo recorder that fixes point 3.
- No new npm deps. No Rust change. No on-disk schema version bump (keymap.json tolerant-migrated).

## Decision log

| Date       | Decision | Rationale |
| ---------- | -------- | --------- |
| 2026-07-14 | Design gate: pz-ddd N/A (no domain model - keyboard config), pz-archetypes N/A (config, not accounting/inventory/etc. shape), **pz-codebase-design applies** (new `record-hotkey` module + reshaping the `resolve`/settings-context interface string→string[]). | Mandatory gate. Only the module-interface skill matches. |
| 2026-07-14 | Override model = **array of hotkeys per action**; `[]` = disabled, absent = default. | User choice. Enables both multi-binding (pt 1) and full removal/disable (pt 2) in one model. Chosen over "default always on + extras" which can't disable an action. |
| 2026-07-14 | Legacy single-string override **migrated** to `[string]` on read (not dropped). | Existing `keymap.json` stores strings; dropping would silently reset every user's custom bindings. |
| 2026-07-14 | Point 3 fixed with an **own `event.code`-aware recorder** replacing the library `useHotkeyRecorder`. | The vendored recorder records `event.key`; mac Option composes it (`⌥P`→"π") and `safeNormalize` rejects it → default. The matcher already uses `event.code`; recorder must match it. Patching node_modules is not durable. |
| 2026-07-14 | Recorder records **`event.key` for ASCII letters/digits**, `event.code` only for composed/dead/punctuation keys. | Must mirror the matcher exactly: `match.ts` matches ASCII letters via `event.key` (Dvorak/AZERTY support) and only falls to `event.code` for non-ASCII-letter+Alt / non-letter special chars. Recording purely from `event.code` would break remapped layouts. |
| 2026-07-14 | Panel focus via a **consume-once flag** in workspace-context (`pendingPanelFocus: "sidebar"\|"console"\|"content"\|null`), set by the toggle handlers, cleared by the consumer that focuses. | A nonce+diff (like `focusUrlNonce`) fails here: the sidebar/console consumers **unmount** when hidden, so a freshly-mounted consumer's `seenNonce` would already equal the current nonce and skip. A consume-once flag focuses correctly regardless of mount timing. |
| 2026-07-14 | Show focuses the panel; **hide returns focus to the content region**. Console focus target = the scrollable `<section>` (made `tabIndex=-1`). | User choices (Q2, Q3). Sidebar has real arrow nav (roving rows); console has only log lines, so "focus" = focus the scroll container for keyboard scrolling. |
