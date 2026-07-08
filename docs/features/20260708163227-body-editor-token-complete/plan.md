# Plan: `{{var}}` autocomplete in the CodeMirror body + config editors

Implements [spec.md](./spec.md). TDD, red-green-refactor.

## Approach

One thin CodeMirror `CompletionSource` wrapping the already-tested pure core, registered
via the JSON language-data `autocomplete` facet so it composes with basicSetup's single
`autocompletion()` instance and (in the config editors) the JSON-schema source. No new
`autocompletion()` instance, no `override`.

## Task breakdown

### T1 - Pure CM source (RED then GREEN)

New `src/components/workspace/token-complete-source.ts`:

```
tokenCompletionSource(candidates: TokenCandidate[]): CompletionSource
```

- Reads `context.state.doc.toString()` + `context.pos`.
- Delegates to `tokenCompletionAt(text, pos, candidates)`; returns null when it returns
  null (AC-002/004, E-1).
- Maps `completion.candidates` -> `Completion[]`:
  - `label: candidate.name`
  - `detail: candidate.source` (the group label, when non-empty)
  - `type`: map kind -> a CM completion type (`variable`/`constant`/`property`) for the
    themed icon; purely cosmetic.
  - `apply(view, _c, from, to)`: recompute via `applyTokenCandidate(text, completion, to,
    candidate)` and dispatch `{ changes: { from: completion.start, to, insert }, selection:
    { anchor: newCaret } }`. Compute `insert`/caret from the pure fn so the editor path is
    byte-identical to the input path (AC-003, E-3/E-4).
- Return `{ from: completion.start, options, validFor: /^[\w.]*$/ }` (AC-005 filtering,
  E-5 dotted keys).

Tests `token-complete-source.test.ts` (TC-001..TC-007): construct an `EditorState` with a
doc + selection, build a `CompletionContext`, assert `from`/`options`/null. Assert the
`apply` change/selection for TC-004/TC-005 by applying to a live `EditorView`.

### T2 - Body editor wiring (RED then GREEN)

- `body-editor.tsx`: add optional `candidates?: TokenCandidate[]`. When present, append
  `jsonLanguage.data.of({ autocomplete: tokenCompletionSource(candidates) })` to the
  extension list, memoized on a stable candidates key (e.g. the joined names+sources) so a
  same-content array does not rebuild.
- `body-panel.tsx`: `const candidates = tokenCandidates(effectiveConfig, processEnv,
  request.id)` and pass `<BodyEditor candidates={candidates} ... />`.

Test `body-editor-token-complete.test.tsx` (TC-008): render with candidates, type `{{`
into the live editor, assert `.cm-tooltip-autocomplete` + option labels appear. If the
popup needs an explicit trigger after `{{`, add the trigger in the source (RED drives it).
Also assert: no candidates prop -> no token source (query the state's language-data
autocomplete sources).

### T3 - Config editors wiring (RED then GREEN)

- `config-editor.tsx`: add optional `candidates?: TokenCandidate[]` to `RawJsonEditor`;
  when present, append the token language-data source to `extensions` AFTER
  `makeSchemaExtensions(...)` (both sources collected).
- `ConfigEditorForm` (folder) + `RequestSettingsForm` (request): resolve their scope's
  candidates and pass them. Resolution reuses the folder-pane idiom - `resolveConfig(tree,
  id, { environment: activeEnvironment })` + `resolveProcessEnv(tree, id, rootProcessEnv)`
  -> `tokenCandidates(effective, processEnv, id)`. Pull `tree` / `activeEnvironment` /
  `rootProcessEnv` from `useWorkspace()`.
- `theme-section.tsx`: pass NO `candidates` (stays token-free, AC-008).
- Consider a `useScopeTokenCandidates(scopeId)` hook if the resolution repeats across the
  body panel + both config forms (3 call sites -> extract; else inline). Decide in GREEN.

Test `config-editor-token-complete.test.tsx` (TC-009/TC-010): assert the token source is
present in the folder + request editors' language-data autocomplete AND the schema source
is present; assert the theme + script editors have no token source.

### T4 - REFACTOR

- De-dupe candidate resolution (hook vs inline per the only-used-twice threshold).
- Tighten the kind->CM-type map and the memo key.
- Confirm no second `autocompletion()` sneaks in (basicSetup owns the single instance).

## Execution order

T1 -> T2 -> T3 -> T4. T1 unblocks T2/T3 (both import the source).

## File changes

| File | Change |
| ---- | ------ |
| `src/components/workspace/token-complete-source.ts` | NEW - `tokenCompletionSource` factory. |
| `src/components/workspace/body-editor.tsx` | Optional `candidates`, append token source. |
| `src/components/workspace/body-panel.tsx` | Compute + pass candidates. |
| `src/components/workspace/config-editor.tsx` | Optional `candidates` on `RawJsonEditor`; resolve + pass in both forms. |
| `src/components/settings/theme-section.tsx` | No change beyond confirming it passes no candidates. |
| `src/components/workspace/__tests__/token-complete-source.test.ts` | NEW - TC-001..TC-007. |
| `src/components/workspace/__tests__/body-editor-token-complete.test.tsx` | NEW - TC-008. |
| `src/components/workspace/__tests__/config-editor-token-complete.test.tsx` | NEW - TC-009, TC-010. |

## Acceptance verification

- AC-001/002/003/004/005: `token-complete-source.test.ts` (TC-001..007) + the body
  integration test (TC-008).
- AC-006/007: `config-editor-token-complete.test.tsx` (TC-009) - token source composed
  with schema source in both forms.
- AC-008: same file (TC-010) - theme + script editors token-free.
- Full gate: `npm run lint && npm run typecheck && npm test` all green; manual smoke in
  `npm run dev` (type `{{` in a body + a folder-config JSON, confirm the popup).

## Risks

- Auto-trigger after `{{`: `{` is not a word char, so verify basicSetup's `activateOnTyping`
  opens the popup after the second `{`; if not, add a trigger char / explicit
  `startCompletion` - TC-008 fails first and forces the fix.
- Double `autocompletion()`: only register a language-data source; never add our own
  `autocompletion()` (basicSetup already provides one).
