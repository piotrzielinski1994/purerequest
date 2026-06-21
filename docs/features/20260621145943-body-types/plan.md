# Plan: Body Types

From the approved [spec.md](spec.md). TDD order. Wire stays `string | null` => **no Rust change**.

## Approach

Add a `bodyMode` tag + a shared `bodyForm: KeyValue[]` slot to `RequestNode`, keeping the
existing `body` string as the JSON slot. The body is **encoded to a string on the frontend**
inside `buildHttpRequest`, and the auto `Content-Type` is injected there too (user header wins).
This keeps the Rust `send_http_request`/`HttpRequestPayload` contract (`body: Option<String>`)
untouched - the single highest-leverage decision, since it removes the entire file-dialog /
binary-wire surface.

Encoding is a pure module (`body-encode.ts`) - a small strategy keyed by mode - so it is unit
testable without React. The deterministic multipart boundary (no `Math.random` in the env) is a
fixed long token; `buildHttpRequest` already takes the node so it can derive a per-request
boundary if needed, but a fixed token suffices and keeps tests trivial.

## File changes

**Model / encoding (pure, no UI):**
- `src/lib/workspace/model.ts` - add `BodyMode` type; add optional `bodyMode`, `bodyForm` to
  `RequestNode`.
- `src/lib/http/body-encode.ts` (new) - `encodeBody(mode, jsonText, rows, subst)` ->
  `{ body: string | null; contentType: string | null }`. urlencoded + multipart encoders +
  boundary constant live here.
- `src/lib/http/build-request.ts` - call `encodeBody`; inject auto `Content-Type` unless a
  header (case-insensitive) already sets it; keep `BODYLESS_METHODS` -> `null` + no content type.

**Persistence:**
- `src/lib/workspace/disk-format.ts` - serialize `bodyMode`/`bodyForm` only when non-default;
  parse them back (tolerant: absent -> json/[]). `ParsedRequest` gains the two fields.
- `src/components/workspace/config-editor.tsx` - `parseRequest` + `RequestSettingsForm` include
  `bodyMode`/`bodyForm` in the raw-JSON doc and validation.

**Session state / dirty / override:**
- `src/lib/workspace/update-request.ts` - `RequestPatch` adds `bodyMode|bodyForm`.
- `src/components/workspace/workspace-context.tsx` - `RequestOverride` adds `bodyMode|bodyForm`;
  add `setRequestBodyMode(id, mode)` + `setRequestForm(id, rows)` actions (mirror
  `setRequestBody` via `mergeOverride`); `newRequest` default leaves them absent (json).
  Dirty/override fold already generic over `RequestOverride` keys - extends for free.

**UI:**
- `src/components/workspace/body-panel.tsx` (new) - mode `Select` + content swap (BodyEditor /
  placeholder / EditableKeyValueTable bound to `bodyForm`).
- `src/components/workspace/request-pane.tsx` - Body tab renders `<BodyPanel request=... />`
  instead of `<BodyEditor>` directly.

## Edge cases handled (from spec §8)

- Empty form -> `""` body, Content-Type still set (not `null`).
- Legacy `bodyMode` absent -> json mode, behavior unchanged + new auto `application/json`.
- Empty-key row after subst -> dropped (reuse the headers/params filter posture).
- Disabled row -> excluded from wire.
- GET/DELETE -> `null` + no content type regardless of mode.

## Tests to write (RED first, one+ per AC)

Pure (Vitest, no React):
- `body-encode.test.ts` - urlencoded escaping (TC-001, TC-005), multipart doc + boundary
  (TC-002), empty form (TC-008), disabled-row exclusion (TC-005).
- `build-request*.test.ts` (extend) - auto Content-Type per mode (AC-003/004), user header wins
  (TC-004/AC-005), none -> null + no CT (TC-003), GET/DELETE -> null (TC-003/AC-007), var
  interpolation on rows (TC-005/AC-006).
- `disk-format` round-trip (TC-007/AC-009): form request round-trips; default json writes
  neither field.

React (Vitest + RTL):
- body-panel: selector switches modes; form rows render + edit; none placeholder (AC-001, UI).
- mode-switch preservation (TC-006/AC-008): json text kept across switches, form<->multipart
  rows shared - likely at the workspace-context/override layer (mirrors `body-override-context`).
- dirty/persist (AC-010): editing mode/row marks dirty; save persists (extend existing
  persist/dirty tests or add a focused one).

## Execution order

1. RED: spawn test-writer subagent (per skill Phase 3) for the ACs/TCs above.
2. GREEN per AC group: model + `body-encode` -> `build-request` -> disk-format/config-editor ->
   context actions/override -> UI panel. One commit per AC group `feat(body-types): AC-NNN ...`.
3. REFACTOR: collapse mode dispatch to a clean strategy if ifology appears; tighten types.
4. VERIFY: fresh verifier subagent; run `npm test`, `npm run typecheck`, `npm run lint`,
   `cd src-tauri && cargo test` (should be untouched/green).

## Acceptance verification

- AC-001..010 each map to a named test (table filled into `.pzielinski`-style trace in this
  feature folder after verify). Gates: vitest all-green, tsc clean, eslint clean, cargo test
  green (no Rust delta).

## AC traceability (verified PASS, 740 tests)

| AC | Test |
| ---- | ---- |
| AC-001 | build-request-body-modes "should pass the body through verbatim if bodyMode is absent" / "...auto-add application/json" |
| AC-002 | build-request-body-modes "should send a null body and no Content-Type if bodyMode is none on a POST" |
| AC-003 | build-request-body-modes "should encode enabled rows as a=1&b=2" / "...auto-set Content-Type application/x-www-form-urlencoded" |
| AC-004 | build-request-body-modes "should encode a row as a multipart text part with a boundary matching the Content-Type" |
| AC-005 | build-request-body-modes "should send only the user Content-Type and not the auto one" (json/form/multipart) |
| AC-006 | build-request-body-modes "should interpolate {{var}} in both form key and value" / "...exclude an enabled:false row" |
| AC-007 | build-request-body-modes "should send a null body and no auto Content-Type for {GET,DELETE} in {mode}" |
| AC-008 | body-mode-context "should preserve form rows across form<->multipart and the JSON text across json switches" |
| AC-009 | disk-format-body-modes round-trip/omit tests + request-settings-tab Settings-JSON round-trip/omit tests |
| AC-010 | body-mode-context dirty tests + "should persist bodyMode and bodyForm via the save seam if the request is saved" |
| §8 edge | build-request-body-modes empty-multipart + blank-key-drop (form & multipart) |

Status: **Implemented + verified** (fresh-context verifier PASS). typecheck clean, lint 0 errors,
cargo 5/5 (no Rust change). Deviation from plan: no standalone `body-encode.test.ts` (encoder
covered transitively through `buildHttpRequest`) and no isolated `BodyPanel` render test (panel
behavior covered via context + the existing request-pane suite).

## Risks

- Existing JSON requests start sending `application/json` (behavior change, user-approved): a
  few existing build-request tests may assert "no Content-Type" - update them to reflect the new
  contract, don't weaken the new assertion. Mitigation: grep build-request tests in RED.
- Reusing `EditableKeyValueTable` for `bodyForm` is a 4th caller - confirm its reseed-on-rows-
  identity behavior holds when the rows come from an override (same as headers/params today).
