# Spec: Request Body Code Editor

**Version:** 0.1.0
**Created:** 2026-06-19
**Status:** Draft

## 1. Overview

Replace the read-only `<pre>` in the request pane's **Body** tab with a real code editor so
the user can comfortably write a request body. The editor gives:

- **Syntax highlighting** - JSON grammar (every body in the app today is JSON), plaintext
  fallback otherwise.
- **Auto-closing brackets** - typing `{`, `[`, `(`, `"` inserts the matching closer.
- **Editing** - the body is now writable. Edits live in **session memory only** (mirrors the
  existing in-memory draft model); there is NO disk write. Persisting a body back to the
  `.req.json` on disk is a separate, future feature and is explicitly out of scope here.

The editor is built on **CodeMirror 6** via `@uiw/react-codemirror` + `@codemirror/lang-json`,
with `closeBrackets` from `@codemirror/autocomplete`. The app is hard-coded dark
(`index.html` has `class="dark"`), so the editor uses a single dark theme tuned to the
existing Tailwind/oklch tokens (transparent background so it inherits the pane).

What this feature delivers:

- An editable Body tab backed by CodeMirror, replacing the `<pre>` at
  `request-pane.tsx:249-253`.
- A `BodyEditor` component (`src/components/workspace/body-editor.tsx`) wrapping
  `@uiw/react-codemirror` with JSON highlighting + bracket-closing enabled.
- An in-memory body-override mechanism in `WorkspaceProvider`: a `setRequestBody(id, body)`
  action so typing updates the active request's body in state (works for both tree requests
  and in-memory drafts) without touching disk.

Out of scope (YAGNI): disk persistence/save, dirty-state indicators, non-JSON grammars
(XML/GraphQL), Content-Type-based language detection, format/prettify actions, send/execute.

## 2. Acceptance Criteria

- AC-001: The Body tab renders an editable code editor (not a read-only `<pre>`), seeded
  with the active request's current body.
- AC-002: When the active request has no body, the editor shows empty content (an empty
  editable editor), not the literal text "No body".
- AC-003: Typing in the editor updates the active request's body in session state; switching
  away to another request tab and back shows the edited body (edits survive tab switches
  while the session lives).
- AC-004: A JSON body is syntax-highlighted (JSON grammar applied - keys/strings/numbers/
  punctuation carry distinct token classes).
- AC-005: Auto-closing brackets is active: typing an opening `{`, `[`, `(`, or `"` inserts
  the matching closing character.
- AC-006: Editing one request's body does not change any other request's body (overrides are
  keyed per request id).
- AC-007: Edits to an in-memory draft's body are reflected when the draft is the active
  request, and the draft remains closeable/disposable as before.
- AC-008: Malformed JSON in the body is flagged inline (lint diagnostic: red wavy underline +
  gutter marker + hover message); well-formed JSON shows no diagnostics. Uses
  `jsonParseLinter` (syntax/parse errors only - NOT JSON-Schema type validation).
- AC-009: The editor uses a JetBrains Darcula (IntelliJ default dark) color scheme - bg
  `#2b2b2b`, text `#a9b7c6`, strings `#6a8759`, numbers `#6897bb`, keywords/bool/null
  `#cc7832`, property keys `#9876aa`.

## 3. User Test Cases

- TC-001 (happy path): Open `req-token` (has JSON body) -> click Body tab -> editor shows the
  JSON, highlighted. Maps to: AC-001, AC-004.
- TC-002 (empty body): Open a request with `body: ""` -> Body tab -> editor is empty and
  editable, no "No body" text. Maps to: AC-002.
- TC-003 (edit persists across tab switch): Body tab -> type into editor -> switch to another
  open request tab -> switch back -> edited text is still there. Maps to: AC-003.
- TC-004 (auto-close): Place caret in empty editor -> type `{` -> a `}` appears. Maps to:
  AC-005.
- TC-005 (isolation): Edit request A's body -> open request B -> B shows its own original
  body, unaffected. Maps to: AC-006.
- TC-006 (draft editing): New request (draft) -> Body tab -> type body -> it shows; close the
  draft tab -> draft gone. Maps to: AC-007.

## 4. UI States

| State                | Behavior                                                              |
| -------------------- | --------------------------------------------------------------------- |
| Body present (JSON)  | Editor seeded with body text, JSON syntax highlighting active.        |
| Body empty           | Empty editable editor (no placeholder text required; no "No body").   |
| Editing              | Keystrokes update state; brackets auto-close; highlighting live.      |
| No request selected  | Unchanged: RequestPane shows "No request selected" (tab not reached). |

### ASCII wireframe - Body tab

```
+--------------------------------------------------------------+
| Auth | Headers | Params | [ Body ] | Script | Effective      |
+--------------------------------------------------------------+
| 1  {                                                         |
| 2    "grant_type": "client_credentials"                      |
| 3  }                                                         |
|                                                              |
|                                                              |
|                                                              |
+--------------------------------------------------------------+
```

(JSON tokens highlighted; line gutter from CodeMirror basicSetup; caret editable.)

## 5. Data Model

No on-disk model change. In `WorkspaceProvider`:

- New state `bodyOverrides: Map<string, string>` (request id -> edited body).
- New action `setRequestBody(id: string, body: string): void` - sets `bodyOverrides[id]`.
- `activeRequest` body resolves as `bodyOverrides.get(id) ?? base.body`.
- `closeRequest` / `closeAllRequests` drop the override entry alongside the draft so a
  reopened/disposed request doesn't carry a stale edit.

`RequestNode` shape is unchanged (`body: string` already exists). No disk serialization touched.

## 6. Edge Cases

- Empty body string -> editor mounts empty, editable (AC-002).
- Switching active request -> editor remounts seeded with the new request's resolved body
  (key the editor by request id so CM internal doc resets cleanly).
- Editing a tree (mock) request -> override stored in state, original mock data untouched.
- Editing a draft -> override applied on top of the draft node (draft body starts `""`).
- Closing then reopening the same tree request -> override cleared on close, so it reopens
  with the original body (consistent with "session-memory only, disposable").
- Invalid JSON typed -> editor still accepts it (no validation/linting in scope); highlighting
  degrades gracefully (CM6 JSON grammar tolerates partial input).
- jsdom limitation: CodeMirror is contentEditable; jsdom can't simulate live keystroke
  editing into a CM doc. Live-typing behaviors (AC-005 auto-close) are verified by asserting
  the editor is wired with `closeBrackets`/JSON extensions and is editable, plus a
  state-level test of `setRequestBody` via `onChange`; not by simulating raw key events into
  the CM surface.

## 7. Dependencies

New npm deps:

- `@uiw/react-codemirror` - React wrapper for CodeMirror 6.
- `@codemirror/lang-json` - JSON language (highlighting) + `jsonParseLinter` (AC-008).
- `@codemirror/autocomplete` - provides `closeBrackets` (may arrive transitively; declare it).
- (`codemirror` / `@codemirror/state` / `@codemirror/view` / `@codemirror/language` /
  `@codemirror/lint` / `@lezer/highlight` arrive as peers - used directly for the Darcula
  `HighlightStyle`/`EditorView.theme` (AC-009) and the `linter`/`lintGutter` (AC-008); no
  extra install needed, they ship with the wrapper.)

No Rust/Tauri changes. No new capability/permission. Browser-safe (works in `npm run dev`).
