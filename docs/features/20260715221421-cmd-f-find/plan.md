# Plan: Cmd+F find bar

## Approach

Mirror purequery's CodeMirror find path verbatim (no grid to port). A `search()` extension plus a
`Prec.highest` keymap binding the resolved open-find key to `openSearchPanel` is injected into
every editor's extension list. The custom `search({ createPanel })` renders the shared React
`FindBar` inside a CodeMirror top `Panel`. The open key is resolved from settings through a new
`to-codemirror-key` bridge and threaded into `useEditorExtensions` (now settings-aware) so all
extension sets carry find; the two editors that build their own lists (script, GraphQL) append
the exposed `findExtension`.

## File Changes

- CREATE `src/components/workspace/find-bar.tsx` - shared presentational find bar (copy purequery).
- CREATE `src/components/workspace/editor-find.tsx` - CM search panel rendering FindBar + `editorFind(openKey)` (copy purequery).
- CREATE `src/lib/shortcuts/to-codemirror-key.ts` - "Mod+F"->"Mod-f" bridge (copy purequery).
- MODIFY `src/lib/shortcuts/registry.ts` - add `open-find` to the id union + one entry (`Mod+F`).
- MODIFY `src/components/workspace/use-editor-extensions.ts` - resolve open-find key, append `editorFind(findKey)` to all sets, expose `findExtension`.
- MODIFY `src/components/workspace/script-editor.tsx` / `graphql-body-editor.tsx` - append `findExtension`.
- MODIFY `src/components/workspace/main.tsx` - `triggerFind` helper + palette "Find" command (not a global hotkey).
- MODIFY `README.md` - open-find in the defaults list + feature blurb.
- MODIFY `src/lib/shortcuts/__tests__/resolve.test.ts` - add `open-find` to the ACTION_IDS snapshot.

## Execution Order

1. FindBar. 2. to-codemirror-key. 3. registry open-find. 4. editor-find + wire useEditorExtensions + script/graphql. 5. palette re-fire. 6. docs + verify.

## Acceptance Verification

- AC-001/006: registry + resolve tests, palette lists "Find".
- AC-002/005: editor-find integration test + real-app check across surfaces.
- AC-003/004/007: FindBar unit tests.
- Gates: typecheck clean, lint 0 errors, full suite 2025 pass.
