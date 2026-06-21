# Spec: Body Types (form-urlencoded, multipart text, none)

**Version:** 0.1.0
**Created:** 2026-06-21
**Status:** Approved

## 1. Overview

The request **Body** tab is a single CodeMirror JSON editor today: every request body is one
raw string, sent verbatim, and the user must hand-add a `Content-Type` header. This feature
adds a **body mode** selector with three new modes beyond the existing JSON editor:

- `none` - no body is sent (even for POST/PUT/PATCH).
- `x-www-form-urlencoded` - a key/value grid encoded as `a=1&b=2`.
- `multipart/form-data` - a key/value grid encoded as a multipart document (**text parts
  only**, no file uploads).

The existing JSON editor stays as the `json` mode. A fifth `text` raw mode is **out** (see
Scope) - JSON mode already accepts arbitrary text on the wire.

Each mode that has a canonical media type **auto-sets its `Content-Type`** request header when
building the wire request; an explicit `Content-Type` set by the user in the Headers tab always
wins. The HTTP wire contract is unchanged: `body` stays a single `string | null`. The frontend
encodes form/multipart to that string and computes the boundary, so **no Rust / `send_http_request`
change is needed**.

### Scope

- **In:** body-mode selector (`json` | `none` | `form` | `multipart`); urlencoded encoder;
  multipart (text-part) encoder + boundary; auto `Content-Type` per mode with user-header
  override; per-request persistence of the mode + the form rows; mode switch preserves data.
- **Out:** file-upload multipart parts (native dialog, Rust file read, binary wire - deferred,
  user call); raw `text` mode (JSON mode covers arbitrary strings); GraphQL/XML body grammars;
  per-part Content-Type override inside multipart; binary/raw-bytes body.

### Decisions captured (user)

- **Modes to ship:** `x-www-form-urlencoded`, `multipart/form-data` (text only), `none` - plus
  the existing JSON editor. (Raw `text` not requested.)
- **Multipart depth:** **text fields only.** Wire stays a string, frontend builds the boundary,
  no native file dialog, no Rust change.
- **Content-Type:** **auto-set for all modes, explicit user header wins.** This means existing
  JSON requests now send `Content-Type: application/json` automatically (a deliberate behavior
  change - previously the user had to add it by hand). `none` sets no body and no auto header.
- **Mode switch:** **preserve form<->multipart shared rows, keep JSON text in its own slot.**
  `form` and `multipart` share one set of key/value rows (same shape), so switching between them
  keeps the rows. JSON text lives in its own slot and returns if you switch back. Switching to
  `none` keeps both slots intact (just sends nothing). No silent data loss on any switch.

## 2. Data model

`RequestNode` (and its disk `*.req.json`) gains two optional fields beside the existing `body`:

```ts
type BodyMode = "json" | "none" | "form" | "multipart";

type RequestNode = {
  // ...existing...
  body: string;            // JSON-mode text (unchanged slot, also legacy raw bodies)
  bodyMode?: BodyMode;     // absent => "json" (legacy + the common case)
  bodyForm?: KeyValue[];   // shared form/multipart rows; absent => []
};
```

- `bodyMode` **absent** resolves to `"json"` - every existing request keeps its current behavior
  except for the new auto `Content-Type` (see §3).
- `bodyForm` reuses the existing `KeyValue` shape (`{ key, value, enabled? }`) so the existing
  `EditableKeyValueTable` (`withToggle`) renders it directly, and disabled rows are excluded
  from the wire (consistent with headers/params).
- On disk, `bodyMode` / `bodyForm` are only written when non-default (mode !== json or rows
  non-empty), to keep `*.req.json` diffs minimal for plain-JSON requests. The disk `body` field
  stays the tagged `StoredBody` (`body-codec.ts`) for the JSON slot only.

## 3. Wire build (`buildHttpRequest`)

`buildHttpRequest` resolves the body **and** an auto `Content-Type` from the mode:

| mode        | wire `body`                                  | auto `Content-Type`                          |
| ----------- | -------------------------------------------- | -------------------------------------------- |
| `json`      | `subst(node.body)` (as today)                | `application/json`                           |
| `none`      | `null`                                       | (none)                                       |
| `form`      | urlencoded `subst`-ed enabled rows           | `application/x-www-form-urlencoded`          |
| `multipart` | multipart doc of `subst`-ed enabled rows     | `multipart/form-data; boundary=<boundary>`   |

Rules:
- `BODYLESS_METHODS` (GET/DELETE) still force `body: null` regardless of mode, and suppress the
  auto `Content-Type` (no body => no content type).
- Auto `Content-Type` is only added if the resolved headers do **not** already contain a
  `Content-Type` (case-insensitive); a user header always wins, including its value.
- `{{var}}` interpolation (`subst`) applies to JSON text (as today) and to **both key and value**
  of every form/multipart row, matching how headers/params interpolate.
- Multipart boundary is **deterministic** (derived from the request id / a fixed token), not
  random - so wire output is stable and unit-testable without injecting a clock/RNG (the script
  env forbids `Math.random`). Each enabled row becomes one `Content-Disposition: form-data;
  name="<key>"` text part. CRLF (`\r\n`) line endings per RFC 7578.

## 4. UI

The Body tab gains a mode selector (a `Select`, matching the Auth panel's pattern) above the
body content area. The content area swaps by mode:

- `json` -> the existing `BodyEditor` (CodeMirror), unchanged.
- `none` -> a muted "This request has no body." placeholder.
- `form` / `multipart` -> the existing `EditableKeyValueTable` (`withToggle`) bound to
  `bodyForm`, shared between the two modes.

### UI States

| State          | Behavior                                                                   |
| -------------- | -------------------------------------------------------------------------- |
| json (default) | CodeMirror JSON editor, as today; selector shows "JSON".                   |
| none           | Selector "None"; muted placeholder, no editor; nothing sent on the wire.   |
| form           | Selector "Form URL Encoded"; key/value grid (toggle); urlencoded on wire.  |
| multipart      | Selector "Multipart Form"; same grid (shared rows); multipart on wire.     |
| empty grid     | form/multipart with no rows -> empty body string, but auto Content-Type    |
|                | is still set (matches a deliberately-empty form post).                     |

## 5. Persistence & dirty/override

- The session-override map (`requestOverrides`) and `RequestPatch` extend from
  `name|url|method|body|config` to also carry `bodyMode|bodyForm`. Editing the mode or the rows
  marks the request dirty (dot beside the tab) exactly like a `body` edit does today, and
  `Mod+S` / Settings save persists them through the existing `updateRequest` + `onTreeChange`
  seam. No new save path.
- The Settings tab's raw-request JSON gains `bodyMode` / `bodyForm` in the document it shows and
  parses (round-trips through `config-editor.tsx`).

## 6. Acceptance criteria

- **AC-001:** A request defaults to `json` mode when `bodyMode` is absent, and the existing JSON
  editor + body string round-trip is unchanged.
- **AC-002:** Selecting `none` sends `body: null` and adds no auto `Content-Type`, even for a
  POST/PUT/PATCH method.
- **AC-003:** `form` mode encodes enabled rows as `application/x-www-form-urlencoded`
  (`a=1&b=2`, URL-escaped) and auto-sets `Content-Type: application/x-www-form-urlencoded`.
- **AC-004:** `multipart` mode encodes enabled rows as an RFC-7578 multipart document with a
  deterministic boundary and auto-sets `Content-Type: multipart/form-data; boundary=<boundary>`
  matching the body's boundary.
- **AC-005:** An explicit `Content-Type` header (any case) set by the user overrides the auto
  one for every mode (the user value is sent, the auto value is not added).
- **AC-006:** `{{var}}` interpolation applies to JSON text and to both key and value of every
  form/multipart row; disabled rows are excluded from the wire.
- **AC-007:** GET/DELETE always send `body: null` and no auto `Content-Type`, regardless of mode.
- **AC-008:** Switching `form` <-> `multipart` preserves the shared rows; switching to/from
  `json` keeps the JSON text in its own slot (no data loss on any switch).
- **AC-009:** `bodyMode` + `bodyForm` persist to / load from `*.req.json` (and the Settings raw
  JSON), and are omitted from disk when at their defaults (json mode, empty rows).
- **AC-010:** Editing the body mode or a form row marks the request dirty (tab dot) and `Mod+S`
  persists it via the existing save seam.

## 7. Test cases

- **TC-001** (happy, AC-003): form mode, rows `{a:1},{b:2}` -> wire body `a=1&b=2`,
  Content-Type `application/x-www-form-urlencoded`.
- **TC-002** (happy, AC-004): multipart mode, rows `{a:1}` -> wire body contains
  `Content-Disposition: form-data; name="a"` + `1`, boundary matches the Content-Type.
- **TC-003** (edge, AC-002/AC-007): none mode on POST -> `body: null`, no Content-Type; GET in
  any mode -> `body: null`, no Content-Type.
- **TC-004** (edge, AC-005): user sets `content-type: text/plain` -> that value sent, no auto
  one added, for json/form/multipart.
- **TC-005** (edge, AC-006): row `{ {{k}}: {{v}} }` with vars resolves both sides; a disabled
  row is omitted; special chars (`a&b`, space) are escaped in urlencoded.
- **TC-006** (behavior, AC-008): json text "X" -> switch to form -> add row -> switch to
  multipart -> rows kept -> switch back to json -> "X" still present.
- **TC-007** (persistence, AC-009): a form request serialize -> deserialize round-trips
  `bodyMode`/`bodyForm`; a default json request writes neither field.
- **TC-008** (edge): empty form (no rows) -> empty body string, Content-Type still set.

## 8. Edge cases

- Empty form/multipart (no enabled rows): wire body is `""` (form) / a multipart doc with no
  parts; auto Content-Type still set. Not `null` - the user chose form on purpose.
- Legacy request (`bodyMode` absent, `body` a raw string or tagged JSON): resolves to json mode,
  behavior unchanged except the new auto `application/json`.
- A row with an empty key after `subst`: dropped (consistent with `EditableKeyValueTable`'s
  blank-key drop and the headers/params build).
- Boundary collision with body content: deterministic boundary uses a long fixed token unlikely
  to appear in text parts; not defended against beyond that (minimalist; same posture as typical
  clients).

## 9. Dependencies

- Reuses `EditableKeyValueTable`, `Select`, `KeyValue`, `interpolate`, `StoredBody`/body-codec,
  `updateRequest`, `onTreeChange` write seam. No new npm dependency. No Rust change.
