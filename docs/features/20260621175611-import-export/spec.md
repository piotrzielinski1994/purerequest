# Spec: Import / Export (cURL import + Copy as cURL)

**Version:** 0.1.0
**Created:** 2026-06-21
**Status:** Draft

## 1. Overview

purerequest can build and send requests but has no way to move a request in or out as text. This
feature adds two text bridges, both surfaced via the command palette **and** a keyboard
shortcut (user directive):

- **Copy as cURL** - serialize the **active** request to a runnable `curl` command string and
  write it to the clipboard.
- **cURL import** - paste a `curl` command into a dialog; parse it into a brand-new request
  node written to disk (same placement + persistence as "New request").

The two are inverses but not symmetric in fidelity (see Decisions).

### Scope

- **In:** `Copy as cURL` action (palette + shortcut) producing a **resolved/runnable** curl from
  the active request; `cURL import` action (palette + shortcut) opening a **paste dialog**; a
  pure curl-string generator; a pure curl-string parser (tokenizer + flag mapping); creation of
  a **new request node** from the parse, persisted immediately.
- **Out:** Postman / Bruno / OpenAPI / HAR import or export (deferred, user call - minimalist);
  curl `-F`/`--form` multipart import (deferred); importing into / overwriting the *active*
  request (we always create a new node); a "literal-token" copy variant (we copy resolved);
  exporting a whole folder/collection; round-trip guarantee (copy then re-import need not be
  byte-identical).

### Decisions captured (user)

- **Copy form: resolved/runnable.** Reuse `buildHttpRequest` so the copied curl is exactly the
  wire request Send issues - `{{var}}` substituted, query params appended, auth materialized as
  an `Authorization` header, body encoded, Content-Type set. Paste-and-run. This embeds secrets
  by design; the workspace is already plaintext-sensitive.
- **Import input: paste dialog.** A modal with a textarea; the user pastes and confirms. No
  silent `navigator.clipboard` read (permission-gated, untestable, surprising).
- **Import target: new request node.** Create a real `*.req.json` relative to the tree
  selection (same placement rule as New request), open + select its tab, persist immediately.
  Never mutate the active request.

## 2. Data model

No new persisted fields. Import produces an ordinary `RequestNode`; copy consumes the existing
wire `HttpRequest`. One internal parse-result ADT (not persisted):

```ts
type ParsedCurl = {
  method: HttpMethod;
  url: string;
  headers: KeyValue[];      // every -H, plus Cookie from -b; enabled:true
  body: string | null;      // -d / --data* joined; null if none
  auth?: Auth;              // basic, only from -u user:pass
};

type CurlParseResult =
  | { ok: true; request: ParsedCurl }
  | { ok: false; error: string };
```

Mapping a `ParsedCurl` into a `RequestNode`:

- `method`, `url` -> the node's `method` / `url`.
- `headers` -> `config.headers` (each `{ key, value, enabled: true }`).
- `auth` (basic from `-u`) -> `config.auth`; absent -> no `auth` key (inherits).
- `body` non-null -> node `body` string, `bodyMode` left **json** (the json slot sends an
  arbitrary string verbatim, so a non-JSON `-d` body still goes out unchanged). null -> `body:
  ""`.

## 3. Copy as cURL (generation)

Source = `buildHttpRequest(activeRequest, effectiveConfig, processEnv)` - the **resolved wire
request**. The generator (`toCurl`) reads only `method`, `url`, `headers`, `body` (auth is
already a header on the wire request, so it is **not** re-emitted from `req.auth`).

Output shape (multi-line, line-continued for readability):

```
curl -X POST 'https://api.example.com/widgets?page=2' \
  -H 'Authorization: Bearer abc123' \
  -H 'Content-Type: application/json' \
  --data-raw '{"name":"foo"}'
```

Rules:

- Method always emitted via `-X <METHOD>`.
- URL is the first positional arg, **single-quoted**.
- One `-H '<key>: <value>'` per resolved header, in resolved order.
- Body: emitted via `--data-raw '<body>'` only when the wire `body` is a non-null, non-empty
  string. `--data-raw` (not `-d`) so a leading `@` is never treated as a file and the body is
  sent verbatim (no urlencoding). GET/DELETE (wire `body: null`) emit no data flag.
- **Quoting:** every argument value is wrapped in single quotes; an embedded single quote is
  escaped with the POSIX `'\''` idiom (close-quote, escaped quote, reopen-quote). This is the
  one escaping concern - newlines inside a value survive inside the single quotes.
- The string is written via `navigator.clipboard.writeText` and a toast confirms ("Copied as
  cURL"). With no active request, the action is a no-op.

## 4. cURL import (parsing)

`parseCurl(text)` -> `CurlParseResult`. Two stages:

1. **Tokenize** the command respecting shell quoting: single quotes (literal), double quotes
   (literal here - we do not expand vars), backslash escapes, and backslash-newline line
   continuations (the `\` + newline that multi-line curls use). Leading `curl` token is dropped;
   leading `$` (as in `$ curl ...`) tolerated.
2. **Map flags** to `ParsedCurl`:

| curl flag                                            | effect                                               |
| ---------------------------------------------------- | ---------------------------------------------------- |
| `-X` / `--request <M>`                               | method (validated against `HttpMethod`)              |
| bare arg / `--url <u>`                               | url                                                  |
| `-H` / `--header '<k>: <v>'`                         | append header row                                    |
| `-b` / `--cookie '<c>'`                              | append `Cookie: <c>` header                          |
| `-u` / `--user '<user:pass>'`                        | `auth = { type: "basic", username, password }`       |
| `-d`/`--data`/`--data-raw`/`--data-binary`/`--data-urlencode <v>` | body (multiple joined with `&`)         |
| `--compressed`, `-L`, `-k`, `-s`, `-v`, `-i`, `-#`, other unknown flags | ignored (no error)                |

Method defaulting: an explicit `-X` always wins; else `POST` if any data flag was present
(curl's own default); else `GET`.

`ok: false` only when no URL can be found (empty input, or `curl` with no positional/`--url`).
Unknown flags never fail the parse - they are skipped (lenient, like a tolerant importer).

## 5. UI

- **Copy as cURL** - no UI surface of its own; a palette command + shortcut + a toast.
- **cURL import** - a `Dialog` (reusing the `ui/dialog` primitives, same as the close/delete
  confirm dialogs) holding a multi-line `textarea`, an **Import** button (disabled while the
  textarea is empty), and a **Cancel** button. On Import: parse; on `ok` create the node + close
  + toast ("Imported request"); on `!ok` show the parse error inline in the dialog and keep it
  open. Dialog state lives in the workspace context (mirrors `pendingClose` / `pendingDelete`),
  rendered by a `CurlImportDialog` component in `Main` next to the other dialogs.

### UI States

| State           | Behavior                                                                  |
| --------------- | ------------------------------------------------------------------------- |
| Closed          | No dialog; palette/shortcut opens it.                                      |
| Open, empty     | Textarea focused; Import disabled; no error.                              |
| Open, typed     | Import enabled.                                                            |
| Import error    | Inline error message under the textarea; dialog stays open; nothing made. |
| Import success  | Dialog closes; new request node created, opened, selected; toast shown.   |
| Copy, no active | No-op (no clipboard write, no toast).                                      |
| Copy success    | Clipboard holds the curl string; toast "Copied as cURL".                  |

## 6. Acceptance criteria

- **AC-001:** Copy as cURL serializes the active request's **resolved wire** form: `-X <METHOD>`,
  single-quoted URL with query params appended and `{{vars}}` substituted, one `-H` per resolved
  header (including the auth-derived `Authorization` and the auto `Content-Type`).
- **AC-002:** Copy emits the body via `--data-raw '<body>'` for a non-empty wire body, and emits
  **no** data flag when the wire body is null (GET/DELETE) or empty.
- **AC-003:** Copy quotes every argument in single quotes and escapes embedded single quotes via
  the `'\''` idiom, so the output is a valid runnable shell command.
- **AC-004:** Copy writes the string to the clipboard and toasts; with no active request it is a
  no-op (no write, no toast).
- **AC-005:** `parseCurl` extracts method (`-X`/`--request`), URL (positional or `--url`), and
  every `-H`/`--header` into header rows.
- **AC-006:** `parseCurl` maps `-d`/`--data`/`--data-raw`/`--data-binary`/`--data-urlencode` to
  the body (multiple data flags joined with `&`) and defaults the method to `POST` when a data
  flag is present and no `-X` was given, else `GET`.
- **AC-007:** `parseCurl` tokenizes shell quoting correctly: single quotes, double quotes, and
  backslash-newline line continuations (a multi-line pasted curl parses the same as one line).
- **AC-008:** `parseCurl` maps `-u user:pass` to `auth: { type: "basic", ... }` and `-b/--cookie`
  to a `Cookie` header; unknown flags (`--compressed`, `-L`, ...) are ignored without failing.
- **AC-009:** `parseCurl` returns `{ ok: false, error }` when no URL is present (empty input or
  bare `curl`), and `{ ok: true }` otherwise.
- **AC-010:** Importing a valid curl creates a new `RequestNode` (method/url/headers/body/auth
  from the parse) placed relative to the tree selection, opened + selected, and persisted via the
  existing `onTreeChange` write path. Cancel makes nothing.
- **AC-011:** Both actions are registered in the shortcut registry (palette entries + default
  hotkeys) and run from the command palette.

## 7. Test cases

- **TC-001** (happy, AC-001/002/003): POST request with a header + JSON body + a `{{var}}` URL ->
  curl with `-X POST`, substituted single-quoted URL, `-H` lines, `--data-raw`; a body
  containing `'` is escaped via `'\''`.
- **TC-002** (edge, AC-002): GET request -> no `--data-raw`; empty body -> no data flag.
- **TC-003** (happy, AC-005/006/007): multi-line `curl -X POST '<url>' -H 'A: 1' -d 'x=1'`
  parses to method POST, url, header A:1, body `x=1`; same string on one line parses identically.
- **TC-004** (edge, AC-006): two `-d a=1 -d b=2` -> body `a=1&b=2`; `-d` with no `-X` -> POST;
  no data + no `-X` -> GET.
- **TC-005** (edge, AC-008): `-u user:pw` -> basic auth; `-b 'k=v'` -> `Cookie: k=v` header;
  `--compressed -L` ignored.
- **TC-006** (error, AC-009): empty string and bare `curl` -> `{ ok: false }`; `curl 'http://x'`
  -> `{ ok: true }`.
- **TC-007** (quoting, AC-007): a header value with spaces inside single quotes
  (`-H 'Authorization: Bearer a b'`) tokenizes as one value; a `'\''`-escaped value round-trips.
- **TC-008** (integration, AC-010): confirming import in the dialog inserts a new request node
  (visible in the tree, opened tab), persisted; cancel inserts nothing.
- **TC-009** (integration, AC-004/011): the palette lists both commands; running Copy with an
  active request writes curl to the clipboard + toasts; running it with none does nothing.

## 8. Edge cases

- **No active request on copy:** no-op (guarded), no clipboard write.
- **Body with single quotes / newlines on copy:** `'\''` escaping; newlines survive in-quote.
- **Empty / whitespace-only import:** parse fails with a clear error, dialog stays open.
- **Bare `curl` with no URL:** parse fails (AC-009).
- **Unknown flags on import:** skipped, never fatal (AC-008) - keeps the importer tolerant of
  copy-pasted browser "Copy as cURL" output that carries flags we do not model.
- **`-d` body that is not JSON:** stored in the json `body` slot and sent verbatim (json mode
  sends an arbitrary string); we do not try to detect form vs json on import.
- **`--form`/`-F` multipart in pasted curl:** out of scope v1; the flag is skipped like any
  unknown flag (its argument is not specially consumed, so a `-F` with no other URL present would
  leave its argument as the positional URL - harmless when a real URL is also given). No body is
  produced. Documented limitation, not a crash.
- **Method casing on import:** `-X post` normalized to upper; an unrecognized method falls back
  to the data-presence default rather than erroring (lenient).

## 9. Dependencies

- Reuses `buildHttpRequest`, `HttpRequest`, `resolveConfig`/`EffectiveConfig`, `processEnv`,
  `KeyValue`/`Auth`/`HttpMethod`, the tree write path (`insertNode` + `persistTree`/
  `onTreeChange`), the placement logic shared with New request, `navigator.clipboard`, the
  `useToast` seam (`showToastRef`), and the `ui/dialog` primitives. No new npm dependency. No
  Rust change (text bridges are entirely frontend).
