# Plan: Request Body Code Editor

**Spec:** [spec.md](spec.md)
**Status:** COMPLETE - all 7 ACs verified by fresh verifier subagent, all gates green (223 tests).

## AC traceability (final)

| AC | Proving test |
| -- | ------------ |
| AC-001 | request-pane: `should render an editable code editor (not a read-only pre) on the Body tab`; `should seed the editor with the active request's body text` |
| AC-002 | request-pane: `should show an empty editable editor with no 'No body' text if the body is empty` |
| AC-003 | body-override-context: `should resolve activeRequest.body to the override...`; `should keep the edited body if the active request is switched away and back`; body-editor: `should report edits through onChange...` |
| AC-004 | request-pane: `should syntax-highlight a JSON body with JSON grammar applied`; body-editor: `should apply the JSON language to the editor` |
| AC-005 | body-editor: `should wire bracket auto-close into the editor` (inputHandler facet >= 1; verified 0 without closeBrackets) |
| AC-006 | body-override-context: `should not change another request's body...`; `should revert to the original body if a tree request is edited, closed, then reopened` |
| AC-007 | body-override-context: `should edit a draft's body via setRequestBody and still allow closing the draft` |
| AC-008 | body-editor: `should flag malformed JSON with a lint diagnostic`; `should not flag well-formed JSON` (real `@codemirror/lint` + `jsonParseLinter`, `forceLinting`+`diagnosticCount`) |
| AC-009 | Darcula theme is static hex->lezer-tag config (`EditorView.theme` + `HighlightStyle`); colors are visual, not jsdom-assertable - verified by code review + manual run |
| spec §5 | body-override-context: `should drop all overrides if every request is closed at once` |

## 1. Approach

CodeMirror 6 via `@uiw/react-codemirror`. One `BodyEditor` component owns the CM config;
`WorkspaceProvider` owns the in-memory body state. The Body tab in `request-pane.tsx` stops
rendering a `<pre>` and renders `<BodyEditor>` fed by context.

Key decisions:

- **In-memory body state** lives in `WorkspaceProvider` as `bodyOverrides: Map<string,string>`,
  mirroring the existing `drafts` pattern (state + derived merge). `activeRequest.body` is
  resolved as `bodyOverrides.get(id) ?? node.body`. New action `setRequestBody(id, body)`.
  `closeRequest`/`closeAllRequests` drop the override (matches draft disposal).
- **Editor remounts per request**: pass `key={activeRequest.id}` so switching tabs resets the
  CM document cleanly instead of diffing one doc into another.
- **Dark theme only**: app is hard-coded `class="dark"`. Build a small CM theme via
  `@uiw/codemirror-themes` `createTheme` (or inline `EditorView.theme`) using transparent
  background so it inherits the pane; token colors tuned to existing oklch foreground/muted.
  If a hand theme is more code than value, fall back to the bundled `@uiw/react-codemirror`
  default dark (`theme="dark"`) - decide during GREEN, record in Decision Log.
- **Extensions**: `[json(), closeBrackets()]`. `basicSetup` left at default (line numbers,
  bracket matching, history). `closeBrackets` is in `@codemirror/autocomplete`.

## 2. Files

| File | Change |
| ---- | ------ |
| `package.json` | add `@uiw/react-codemirror`, `@codemirror/lang-json`, `@codemirror/autocomplete` (+ peers pulled in) |
| `src/components/workspace/body-editor.tsx` | NEW - `BodyEditor` wrapping `@uiw/react-codemirror`: props `value`, `onChange`, `editorRef?`; extensions `[json(), closeBrackets()]`; dark theme; transparent bg; fills pane height |
| `src/components/workspace/workspace-context.tsx` | add `bodyOverrides` state + `setRequestBody`; resolve `activeRequest.body` via override; drop override in `closeRequest`/`closeAllRequests`; expose `setRequestBody` on context value + type |
| `src/components/workspace/request-pane.tsx` | Body `TabsContent`: replace `<pre>` with `<BodyEditor key={request.id} value={request.body} onChange={(v) => setRequestBody(request.id, v)} />` |
| `src/test/setup.ts` | likely CM6 jsdom stubs if needed (e.g. `document.createRange`/`getClientRects`); add only if tests surface a missing API |
| `src/components/workspace/__tests__/request-pane.test.tsx` | update: Body tab is no longer a `<pre>` "No body" - adjust any assertion that depended on old body rendering |
| `docs/features/.../plan.md`, `README.md`, `docs/adr.md` | docs |

## 3. Test plan (RED first, fresh test-writer subagent)

Vitest + Testing Library, matching existing `request-pane.test.tsx` conventions
(`WorkspaceProvider tree={fixtureTree} initialActiveRequestId=...`, click Body tab).

- TC-001/AC-001+004: Body tab renders an editable CM editor seeded with the request's body
  (assert the body text is present in the editor surface AND the surface is contentEditable /
  `role="textbox"`, not a `<pre>`). JSON highlight asserted structurally (CM token spans
  present / `.cm-editor` mounted with json extension) - not pixel colors.
- TC-002/AC-002: request with empty body -> editor present, no "No body" text.
- TC-003/AC-003: state-level - render with `setRequestBody` reachable; simulate `onChange`
  (call through the component's change path) -> switch active request and back -> body shown
  is the edited value. (Drives the override map, the part jsdom CAN test.)
- TC-005/AC-006: edit A -> B unaffected (override map keyed by id).
- TC-006/AC-007: draft body editable + draft still disposable on close.
- AC-005 (auto-close): assert `closeBrackets` extension is wired (e.g. BodyEditor exposes/uses
  it; test via a focused unit on the extensions array or a `onCreateEditor` probe). Documented
  jsdom limit: no raw-key simulation into CM.

Context-level tests (`setRequestBody`, override resolution, isolation, close-drops-override)
go in a `body-override-context.test.tsx` (pattern mirrors `new-request-context.test.tsx`).

## 4. Execution order

1. RED: spawn test-writer subagent -> failing tests for AC-001..007.
2. Add deps (`npm install ...`), confirm Vite resolves CM in jsdom (add setup stubs iff
   tests demand).
3. GREEN per AC:
   - `setRequestBody` + override resolution in context (AC-003/006/007).
   - `BodyEditor` component + wire into request-pane (AC-001/002/004/005).
4. REFACTOR: tidy theme/extensions, ensure no `any`, guards over nesting.
5. Fix the existing `request-pane.test.tsx` "No body"/`<pre>` assumption.
6. VERIFY: fresh verifier subagent -> all ACs + gates (lint, typecheck, full `npm test`).
7. Docs: README body-tab note (now editable, in-memory), ADR row, plan completion + Decision Log.

## 5. Acceptance verification

| AC | Proven by |
| -- | --------- |
| AC-001 | request-pane test: Body tab renders editable editor seeded with body |
| AC-002 | request-pane test: empty body -> empty editor, no "No body" |
| AC-003 | context test: onChange -> setRequestBody -> survives active-request switch |
| AC-004 | request-pane test: json extension mounted / token spans present |
| AC-005 | BodyEditor unit: closeBrackets in extensions (jsdom-limit documented) |
| AC-006 | context test: editing A leaves B's body unchanged |
| AC-007 | context test: draft body editable + disposable on close |

## 6. Risks

- CM6 under jsdom: contentEditable APIs (`Range`, `getClientRects`) may be missing -> add
  targeted stubs in `src/test/setup.ts` (precedent: existing `ResizeObserver`/`scrollIntoView`
  stubs). Mitigation: keep behavior tests at the wiring/state layer, not raw keystrokes.
- Bundle size: CM6 + json grammar adds weight. Accepted - it's the core editing feature; no
  lighter option meets "comfortable editor" (decided with user: CM6 over Monaco/textarea).
- Theme drift: hand CM theme could diverge from oklch tokens. Mitigation: transparent bg +
  minimal token overrides, or fall back to bundled dark theme.

## 7. Decision Log

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-06-19 | Editor = CodeMirror 6 (`@uiw/react-codemirror`), not Monaco/textarea+Prism | User choice. CM6 is light, themeable to Tailwind tokens, ships JSON highlight + closeBrackets; Monaco's worker setup fights Vite/Tauri, textarea+Prism needs hand-built bracket logic |
| 2026-06-19 | Body edits in-memory only (`bodyOverrides` map in `WorkspaceProvider`), no disk write | Matches current app state (disk write is an unbuilt feature; drafts already in-memory). YAGNI - "comfortable editor" doesn't require persistence |
| 2026-06-19 | JSON + plaintext highlighting only (no Content-Type detection) | All bodies are JSON today; multi-grammar detection is speculative until non-JSON bodies exist |
