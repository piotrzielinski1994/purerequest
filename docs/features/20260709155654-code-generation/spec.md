# Spec: Copy as code (code generation)

## 1. Overview

Turn the existing single-target "Copy as cURL" export into a small multi-target **code
generator**. The active request is resolved to its wire form (exactly as for send / cURL:
env + vars + auth + query/path params folded in) and rendered as a runnable client snippet in
the language the user picks.

v1 ships **two targets**: cURL (the current output, reused verbatim) and **JavaScript - `fetch`**.
The generator layer is a strategy registry so a later pass can add axios / Python `requests` /
Go `net/http` by dropping one function + one registry row, with no UI change.

### Scope

In:
- A generator strategy layer over the already-resolved `HttpRequest` (`src/lib/codegen/`).
- `fetch` generator (`toFetch`) + reuse of the existing `toCurl`.
- One palette command **"Copy as code"** that opens a dialog: a language `Select`, a read-only
  code preview, and a **Copy** button (+ toast). It replaces the standalone "Copy as cURL"
  command and inherits its `Mod+Shift+C` default hotkey.
- cURL folded into the dialog as one of the language options (per user decision).

Out (deferred, cheap to add later behind the same registry):
- axios, Python `requests`, Go `net/http` (user narrowed v1 to fetch only).
- Any inline "insert snippet into an editor" flow - clipboard only.
- Persisting the last-picked language.

### Decisions (recommended defaults)

- **Fold cURL into the dialog** (user pick): the standalone `copy-as-curl` action is removed;
  its id becomes `copy-as-code` ("Copy as code") and keeps `Mod+Shift+C`. No new hotkey, no
  registry growth per language (languages live in a data registry, not the shortcut table).
- **Default language = cURL**, so `Mod+Shift+C` -> preview shows the same string the old command
  copied (least-surprising continuity), one extra click to switch to fetch.
- **Generators consume the resolved `HttpRequest`**, never the raw `RequestNode` - identical
  resolve path as `toCurl` / send, so a snippet always matches what the app would send.
- **Escaping via `JSON.stringify`** for every JS string literal (url, header key, header value,
  body), so quotes / newlines / backslashes are always valid.

## 2. Data model

```ts
// src/lib/codegen/model.ts
export type CodeTargetId = "curl" | "fetch";

export type CodeTarget = {
  id: CodeTargetId;
  label: string;                       // e.g. "cURL", "JavaScript - fetch"
  generate: (req: HttpRequest) => string;
};

export const CODE_TARGETS: readonly CodeTarget[]; // [curl, fetch], order = dropdown order
```

No new persisted state, no zod, no Rust, no wire change - `HttpRequest` already exists.

## 3. fetch mapping

Given a resolved `HttpRequest` (`method`, `url`, `headers: KeyValue[]`, `body: string | null`):

```js
fetch("<url>", {
  method: "<METHOD>",
  headers: {
    "<k>": "<v>",
    ...
  },
  body: "<escaped-body>"
});
```

- `url`, every header key/value, and `body` are emitted via `JSON.stringify` (valid JS literal).
- `method` is **always** emitted (explicit > relying on the `GET` default).
- `headers` key is **omitted** when there are no headers.
- `body` key is **omitted** when `body` is `null` or `""` (GET/DELETE, or an empty body).
- 2-space indentation; trailing `;`.

cURL target = the existing `toCurl(req)`, unchanged (regression-guarded).

## 4. UI

New `CodeGenDialog` (mirrors `curl-import-dialog.tsx`): reuses the `Dialog` primitive, a
`Select` (design-contract-styled) for the language, a read-only `CodeEditor` preview, and a
**Copy** / **Cancel** footer. Opened by the `copy-as-code` action (palette + hotkey) only when
there is an active request; a no-op otherwise (mirrors the old `copyAsCurl` guard).

### UI States

| State                | Behavior                                                             |
| -------------------- | -------------------------------------------------------------------- |
| Opened (has request) | Dialog shows language `Select` (default cURL) + preview of that code |
| Language changed     | Preview re-renders with the newly selected target's output          |
| Copy                 | Writes the previewed code to clipboard, toasts, closes dialog        |
| Cancel / dismiss     | Closes; nothing written                                              |
| No active request    | Command is a no-op; dialog does not open                             |

### ASCII wireframe (Copy as code dialog)

```
+-----------------------------------------------------+
|  Copy as code                                       |
|  Generate client code for the active request.       |
|                                                     |
|  Language  [ cURL                            v ]    |
|  +-----------------------------------------------+  |
|  | curl -X POST \                                |  |
|  |   'https://api.example.com/widgets' \         |  |
|  |   -H 'Content-Type: application/json' \       |  |
|  |   --data-raw '{"name":"foo"}'                 |  |
|  |                                               |  |
|  +-----------------------------------------------+  |
|                                                     |
|                              [ Cancel ]  [ Copy ]   |
+-----------------------------------------------------+
```

Same box with `Language = JavaScript - fetch`:

```
+-----------------------------------------------------+
|  Copy as code                                       |
|  Generate client code for the active request.       |
|                                                     |
|  Language  [ JavaScript - fetch              v ]    |
|  +-----------------------------------------------+  |
|  | fetch("https://api.example.com/widgets", {    |  |
|  |   method: "POST",                             |  |
|  |   headers: {                                  |  |
|  |     "Content-Type": "application/json"        |  |
|  |   },                                          |  |
|  |   body: "{\"name\":\"foo\"}"                  |  |
|  | });                                           |  |
|  +-----------------------------------------------+  |
|                              [ Cancel ]  [ Copy ]   |
+-----------------------------------------------------+
```

## 5. Acceptance criteria

- AC-001: A **"Copy as code"** command is registered (id `copy-as-code`) with the `Mod+Shift+C`
  default hotkey, and appears in the command palette. The old `copy-as-curl` id/command no
  longer exists.
- AC-002: Running the command with an active request opens the code-gen dialog; running it with
  no active request does nothing (no dialog, no clipboard write).
- AC-003: The dialog exposes a language `Select` with exactly the targets `cURL` and
  `JavaScript - fetch`, defaulting to `cURL`.
- AC-004: The preview shows the selected target's code generated from the active request's
  **resolved wire form** (env/vars/auth/params folded in, matching send).
- AC-005: Changing the selected language updates the preview to that target's output.
- AC-006: **Copy** writes the currently-previewed code to the clipboard, shows a
  `Copied as <label>` toast, and closes the dialog.
- AC-007: **Cancel** / dismissing the dialog writes nothing to the clipboard.
- AC-008: The cURL target's output is byte-identical to `toCurl(req)` (reuse, not reimplement).
- AC-009: The `fetch` target emits `fetch(<url>, { method, headers?, body? })`: `method` always
  present; `headers` omitted when the request has none; `body` omitted when `body` is `null` or
  `""`; url/keys/values/body JS-string-escaped.
- AC-010: The `fetch` target safely escapes embedded double-quotes, newlines, and backslashes in
  the url, header values, and body (output parses as valid JS string literals).

## 6. Test cases

- TC-001 (happy, AC-009): POST + JSON body + 2 headers -> `fetch("...", { method: "POST",
  headers: {...}, body: "..." })`, keys/values quoted. Maps to: AC-009.
- TC-002 (edge, AC-009): GET, no headers -> `fetch("...", { method: "GET" })` (no `headers`, no
  `body`). Maps to: AC-009.
- TC-003 (edge, AC-009): POST with `body: ""` -> no `body` key. Maps to: AC-009.
- TC-004 (edge, AC-010): body containing `"` + newline + `\` -> escaped, `JSON.parse` of the
  emitted body literal round-trips to the original. Maps to: AC-010.
- TC-005 (edge, AC-010): header value with a `"` -> escaped in the headers object. Maps to: AC-010.
- TC-006 (regression, AC-008): curl target output === `toCurl(req)` for a representative request.
  Maps to: AC-008.
- TC-007 (happy, AC-001/002/003/004/006): open palette -> "Copy as code" -> dialog opens with
  cURL selected, preview shows the curl string, Copy writes it + toasts + closes. Maps to:
  AC-001, AC-002, AC-003, AC-004, AC-006.
- TC-008 (happy, AC-005): switch Select to "JavaScript - fetch" -> preview switches to a
  `fetch(...)` string. Maps to: AC-005.
- TC-009 (edge, AC-002): no active request -> command opens no dialog, no clipboard write. Maps
  to: AC-002.
- TC-010 (edge, AC-007): open dialog, Cancel -> no clipboard write. Maps to: AC-007.

## 7. Edge cases

- No active request -> command no-op (guard mirrors old `copyAsCurl`).
- Request with no headers -> fetch omits the `headers` object entirely.
- Bodyless method (GET/DELETE) or empty body -> fetch omits the `body` key.
- Body / header value with quotes, newlines, backslashes -> `JSON.stringify` escaping.
- Language switch is synchronous and re-resolves the wire (cheap; resolve is pure).
- Clipboard unavailable (`navigator.clipboard` undefined) -> optional-chained write, no throw
  (same as `copyAsCurl`).

## 8. Dependencies

- None new. Reuses `HttpRequest`, `buildHttpRequest`, `resolveConfig`, `resolveProcessEnv`,
  `toCurl`, the `Dialog` + `Select` primitives, and `CodeEditor`. No npm dep, no Rust change.

## 9. Status - DONE (verified 2026-07-09)

Verifier (fresh context): PASS on all 10 ACs + all gates. 1691 frontend tests, 10 cargo, tsc
clean, lint clean (8 pre-existing warnings), no Rust delta, no design-contract violations.

### AC -> test traceability

| AC | Test |
| --- | --- |
| AC-001 | `curl-actions-registry.test.ts` "should register copy-as-code with the Mod+Shift+C default" / "should name the copy action Copy as code" / "should NOT register a copy-as-curl action anymore"; `resolve.test.ts` "should define every in-scope action exactly once"; `code-gen-dialog.test.tsx` "should list Copy as code and not Copy as cURL in the command palette" |
| AC-002 | `code-gen-dialog.test.tsx` "should open no dialog and write nothing if there is no active request" + "should open a dialog with a Language select defaulting to cURL and a curl preview" |
| AC-003 | `targets.test.ts` "should list exactly cURL then JavaScript - fetch, in that order" / "should have curl as the first (default) target"; `code-gen-dialog.test.tsx` open-preview (trigger defaults to cURL) |
| AC-004 | `code-gen-dialog.test.tsx` "should open a dialog with a Language select defaulting to cURL and a curl preview" (preview = resolved wire's curl) |
| AC-005 | `code-gen-dialog.test.tsx` "should switch the preview to a fetch string and copy it if JavaScript - fetch is selected" |
| AC-006 | `code-gen-dialog.test.tsx` "should write the previewed curl to the clipboard, toast, and close on Copy" |
| AC-007 | `code-gen-dialog.test.tsx` "should write nothing to the clipboard if the dialog is cancelled" |
| AC-008 | `targets.test.ts` "should produce byte-identical output to toCurl for the curl target" (curl target = `toCurl` by reference) |
| AC-009 | `to-fetch.test.ts` shape suite (method always; headers omitted when none; body omitted for null/"") |
| AC-010 | `to-fetch.test.ts` escaping suite (url / header value / body round-trip via `JSON.parse`) |
