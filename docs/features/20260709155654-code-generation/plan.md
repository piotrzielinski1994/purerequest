# Plan: Copy as code (code generation)

From the approved [spec.md](spec.md). TDD order. **No Rust change, no new npm dep.** Extends the
proven "Copy as cURL" export path: same resolve-to-wire step (`resolveConfig` +
`resolveProcessEnv` + `buildHttpRequest`), same clipboard + toast, but the single hard-wired
`toCurl` call becomes a **strategy registry** (`CodeTarget[]`) chosen through a dialog.

## Approach

One pure module + one registry carry the logic, React-free:

- **`src/lib/codegen/to-fetch.ts`** - `toFetch(req: HttpRequest): string`. Emits
  `fetch(<url>, { method, headers?, body? })`. Every string literal (url, header key, header
  value, body) via `JSON.stringify` so quotes / newlines / backslashes are always valid JS.
  `method` always emitted; `headers` object omitted when `req.headers` is empty; `body` omitted
  when `req.body` is `null` or `""`. 2-space indent, trailing `;`.
- **`src/lib/codegen/targets.ts`** - `CodeTargetId` (`"curl" | "fetch"`), `CodeTarget`
  (`{ id, label, generate }`), and `CODE_TARGETS: readonly CodeTarget[]` = `[curl, fetch]`
  (order = dropdown order, first = default). `curl` reuses `toCurl` verbatim (import, don't
  reimplement). Small helper `codeTargetById(id)` for the dialog lookup.

The resolve-to-wire step is **not** duplicated: extract the existing `copyAsCurl` body's
resolve into a `resolveActiveWire(): HttpRequest | null` in the context (returns `null` when no
active request / node missing), reused by the new `copy-as-code` action so a snippet always
matches send.

The dialog is the UI seam: `CodeGenDialog` (mirrors `curl-import-dialog.tsx`) reads
`isCodeGenOpen` + the resolved wire from context, holds local `targetId` state (default first
target), renders a `Select` (design-contract-styled, mirror `body-panel.tsx`) + a read-only
`CodeEditor` preview + Copy/Cancel footer. Copy writes the previewed code + toasts
`Copied as <label>` + closes.

## File changes

**Pure core (no UI, no React):**
- `src/lib/codegen/to-fetch.ts` (new) - `toFetch(req): string`.
- `src/lib/codegen/targets.ts` (new) - `CodeTargetId`, `CodeTarget`, `CODE_TARGETS`,
  `codeTargetById`. Imports `toCurl` for the curl target.

**Shortcut registry (rename, not add):**
- `src/lib/shortcuts/registry.ts` - rename `copy-as-curl` -> `copy-as-code` in the
  `ShortcutActionId` union + `SHORTCUT_ACTIONS` row; name `"Copy as code"`, description
  `"Copy the active request as generated client code (curl, fetch, ...)."`, default
  `Mod+Shift+C` (unchanged).
- `src/lib/shortcuts/__tests__/resolve.test.ts` - swap `"copy-as-curl"` -> `"copy-as-code"` in
  the exhaustive id list / assertions.
- `src/lib/shortcuts/__tests__/curl-actions-registry.test.ts` - rename the copy-as-* assertions
  to `copy-as-code` / `Copy as code` (still `Mod+Shift+C`).

**Context (dialog state + action + resolve extraction):**
- `src/components/workspace/workspace-context.tsx`:
  - Add `isCodeGenOpen: boolean` state + `openCodeGen()` / `closeCodeGen()`.
  - Extract `resolveActiveWire(): HttpRequest | null` from the current `copyAsCurl` body
    (resolveConfig + resolveProcessEnv + buildHttpRequest), expose it on the context value.
  - Replace `copyAsCurl` with `openCodeGen` wired to the `copy-as-code` action; the action opens
    the dialog only when `resolveActiveWire() !== null` (no active request -> no-op).
  - Remove the now-unused `toCurl` import + `copyAsCurl` field (moved into the codegen path);
    keep the `Copied as cURL` behavior inside the dialog's Copy.
  - Extend `WorkspaceContextValue` type accordingly.

**UI:**
- `src/components/workspace/code-gen-dialog.tsx` (new) - the dialog (Dialog + Select + read-only
  CodeEditor preview + Copy/Cancel). Uses `useWorkspace()` for `isCodeGenOpen`, `closeCodeGen`,
  `resolveActiveWire`; local `targetId` state reset-on-open (render-time, mirror
  curl-import-dialog). Preview = `codeTargetById(targetId).generate(wire)`. Copy ->
  `navigator.clipboard?.writeText(code)` + toast + close. Read-only preview uses `CodeEditor`
  with `viewerExtensions` (no JSON linter mismatch on non-JSON - viewer is plain highlight).
- `src/components/workspace/main.tsx`:
  - Swap `copyAsCurl` for `openCodeGen` from `useWorkspace()`; handler
    `"copy-as-code": openCodeGen`. Remove the `"copy-as-curl"` handler entry.
  - Mount `<CodeGenDialog />` in the `palette` fragment (next to `<CurlImportDialog />`).

## Edge cases handled (from spec §7)

- No active request -> `resolveActiveWire()` null -> `openCodeGen` no-op (dialog stays closed).
- No headers -> fetch omits the `headers` object.
- Bodyless method / empty body -> fetch omits the `body` key.
- Quotes / newlines / backslashes in url / header value / body -> `JSON.stringify` escaping
  (fetch); curl keeps its existing POSIX single-quote escaping.
- Language switch is synchronous - `generate` is pure over the already-resolved wire.
- `navigator.clipboard` undefined -> optional-chained write (no throw), mirrors old copyAsCurl.

## Tests to write (RED first, one+ per AC)

Pure (Vitest, no React):
- `src/lib/codegen/__tests__/to-fetch.test.ts` (new) - shape with method/headers/body (AC-009,
  TC-001); GET no-headers-no-body omits both keys (AC-009, TC-002); empty body omits body key
  (AC-009, TC-003); escaping: body with `"`/newline/`\` -> `JSON.parse` of emitted literal
  round-trips (AC-010, TC-004); header value with `"` escaped (AC-010, TC-005).
- `src/lib/codegen/__tests__/targets.test.ts` (new) - `CODE_TARGETS` ids/labels/order = `[curl,
  fetch]`, curl default first (AC-003); curl target output === `toCurl(req)` (AC-008, TC-006);
  fetch target === `toFetch(req)`; `codeTargetById` lookup.
- `src/lib/shortcuts/__tests__/curl-actions-registry.test.ts` (edit) - `copy-as-code` registered
  with `Mod+Shift+C` + name/description; **no** `copy-as-curl` id (AC-001).
- `src/lib/shortcuts/__tests__/resolve.test.ts` (edit) - id-list swap.

React (Vitest + RTL), mirror `curl-import-export.test.tsx`:
- `src/components/workspace/__tests__/code-gen-dialog.test.tsx` (new):
  - palette lists "Copy as code", not "Copy as cURL" (AC-001, TC-007).
  - run command w/ active request -> dialog opens, language Select present defaulting to cURL,
    preview shows the curl string (AC-002/003/004, TC-007).
  - Copy -> clipboard gets the curl string + `Copied as cURL` toast + dialog closes (AC-006,
    TC-007).
  - switch Select to "JavaScript - fetch" -> preview shows a `fetch(...)` string; Copy writes
    that (AC-005, TC-008).
  - run command w/ **no** active request -> no dialog, no clipboard write (AC-002, TC-009).
  - open then Cancel -> no clipboard write (AC-007, TC-010).

## Execution order

1. RED: spawn a fresh test-writer subagent (skill Phase 3) for the ACs/TCs above.
2. GREEN per AC group: `to-fetch` -> `targets` -> registry rename (+ resolve/registry test
   edits) -> context (`resolveActiveWire` extract + `openCodeGen`/`isCodeGenOpen`) ->
   `code-gen-dialog.tsx` -> `main.tsx` wiring.
3. REFACTOR: keep targets a clean data table (strategy, no if-ladder); ensure the resolve step
   lives in exactly one place (`resolveActiveWire`); tighten types (no `any`).
4. VERIFY: fresh verifier subagent; `npm test`, `npm run typecheck`, `npm run lint`,
   `cd src-tauri && cargo test` (must stay green - no Rust delta).

## Acceptance verification

- AC-001..010 each map to a named test (trace table filled at verify). Gates: vitest all-green,
  tsc clean, eslint clean, cargo test green (no Rust change). Coverage threshold: none enforced
  (checked `vitest.config.*` / `package.json` - no coverage gate).

## Risks

- **Removing `copy-as-curl` id breaks a user's saved shortcut override**: a persisted
  `{"copy-as-curl": "..."}` override becomes dead (unknown id -> ignored by `resolveShortcuts`).
  Acceptable - default hotkey carries over to `copy-as-code`; no migration for a personal app.
- **Read-only CodeEditor on non-JSON code**: the viewer extension set is JSON-flavored; using it
  on `fetch(...)`/curl text renders fine (plain highlight, no linter in the viewer set), but
  highlighting is JSON-tuned, not JS. Acceptable for a preview; not worth a JS lang extension.
- **Preview divergence from clipboard**: Copy must write the *same* `generate(wire)` the preview
  shows - guaranteed by computing both from one `targetId` + one resolved wire in the dialog.

## Decision Log

Append-only. One row per architectural/design decision made while working this ticket.

| Date | Decision | Rationale |
| ---- | -------- | --------- |
| 2026-07-09 | Domain gate: **neither `pz-ddd` nor `pz-archetypes` applies** | GoF **Strategy** over the existing `HttpRequest` value - no new domain model / aggregate / boundary, no recognised archetype (accounting/inventory/ordering/...). Pure output-format layer, like `toCurl`. |
| 2026-07-09 | v1 targets = **cURL + JS fetch only** (axios / Python / Go deferred) | User decision, narrowing the todo's "multi-language". Registry is a data table, so each later target = one `generate` fn + one row, no UI change. |
| 2026-07-09 | **Fold cURL into a "Copy as code" dialog**; rename `copy-as-curl` -> `copy-as-code`, keep `Mod+Shift+C` | User decision. One command + one hotkey + one settings row instead of N; cURL becomes the default option so `Mod+Shift+C` behaves as before (one extra click to Copy). |
| 2026-07-09 | Generators consume the **resolved `HttpRequest`**, never the raw `RequestNode` | Same resolve path as send / `toCurl` (`resolveConfig` + `resolveProcessEnv` + `buildHttpRequest`), extracted once into `resolveActiveWire` - a snippet always matches what the app sends. |
| 2026-07-09 | JS string escaping via **`JSON.stringify`** (not hand-rolled) | Correct for quotes / newlines / backslashes / unicode in one call; the emitted literals `JSON.parse`-round-trip, which the tests assert. |
| 2026-07-09 | Dialog default language = **cURL** | Continuity: `Mod+Shift+C` still previews the exact string the old command copied; fetch is one Select click away. |
