# Plan: Pre/Post Request Scripts

From the approved [spec.md](spec.md). TDD order. The work is entirely **frontend** (no Rust /
Cargo / capability change): a sandboxed `ScriptRunner` port + adapters, two pure helpers, and the
splice of pre/post execution into the existing `sendRequest` loop.

## Approach

Four layers, sequenced so each lands behind its own tests; `buildHttpRequest` is **never
modified** (the script layer only produces a modified node + modified `EffectiveConfig`):

1. **`ScriptRunner` port + fake adapter** (`src/lib/scripts/model.ts`, `fake-runner.ts`). The port
   is `run(code, api, opts?) -> Promise<ScriptOutcome>` (ADT, never throws). The fake runs an
   injected `(api) => void | Promise<void>` directly against the host `api` so the whole send-loop
   layer is testable in jsdom without WASM. Default fake = no-op.
2. **`setVar` persistence helpers** (`src/lib/scripts/var-write.ts`, pure). `findVarWriteTarget`
   (nearest scope already defining the name, else the request id) + `setNodeVar` (immutable write
   into `config.variables`, reusing `updateNodeConfig`).
3. **Send-loop splice** (`workspace-context.tsx`). `sendRequest` becomes `async`: resolve config ->
   run pre (mutate a `reqDraft` + collect runtime vars + var writes) -> abort on pre error ->
   fold var writes into the tree (one `persistTree`) -> build the wire from a modified node +
   modified `EffectiveConfig` -> existing send/generation/cancel machinery -> run post (read-only
   `res`, collect + persist var writes) -> commit the success state. A `ScriptApi` factory builds
   the `purerequest`/`req`/`res`/`console` host object per stage.
4. **QuickJS adapter** (`src/lib/scripts/quickjs-runner.ts`, the only file importing
   `quickjs-emscripten`). Lazily loads the async single-file WASM module once (memoized promise);
   per `run` creates an async context, exposes `api` as globals (host-function handles), evaluates
   with `evalCodeAsync` + drains `executePendingJobs`, arms a wall-clock interrupt handler
   (`opts.timeoutMs`, default `SCRIPT_TIMEOUT_MS` = 5000), disposes every handle/context on every
   path. Wired into `routes/index.tsx` like the Tauri http client.

The Console panel + Script tab editor are reused as-is; no new tab/view.

## File changes

**New pure / sandbox modules (`src/lib/scripts/`):**
- `model.ts` - `ScriptStage`, `ScriptOutcome` (ADT), `ScriptRunner`, `ScriptApi` (the host shape:
  `purerequest`/`req`/`res`/`console` callbacks), `SCRIPT_TIMEOUT_MS`.
- `fake-runner.ts` - `createFakeScriptRunner(impl?)`: invokes `impl(api)` (awaited), maps a thrown
  error to `{ ok:false, error }`, default no-op `{ ok:true }`.
- `quickjs-runner.ts` - `createQuickJsScriptRunner()`: the real WASM adapter (memoized module load,
  per-run async context, host-fn marshalling, interrupt-handler timeout, full disposal).
- `var-write.ts` - `findVarWriteTarget(tree, requestId, name)` + `setNodeVar(tree, nodeId, name,
  value)` (pure).

**Send loop:**
- `src/components/workspace/workspace-context.tsx`:
  - `WorkspaceProviderProps` gains `scriptRunner?: ScriptRunner`; held in a ref with
    `createFakeScriptRunner()` fallback (mirrors `httpClientRef`).
  - `sendRequest` -> `async`: pre/post splice per spec §3. A `buildScriptApi(stage, ctx)` local
    builds the `ScriptApi` (closures over `reqDraft`, `runtimeVars`, `varWrites`, `consoleLines`,
    the resolved config, `processEnv`, `activeEnvironment`, the response for post). Pre error ->
    `setResponseStates(... { status:"error", message })` + console line + return (no send). Post
    error -> console line only, keep success. Var writes folded via `setNodeVar` chain +
    `persistTree(next, "script")`.
  - Generation guard: re-check `sendGeneration` after the awaited pre-script (cancel-during-pre).

**Wiring:**
- `src/lib/http/...` - unchanged. `buildHttpRequest` unchanged.
- `src/components/workspace/workspace-loader.tsx` - accept + thread `scriptRunner` prop into both
  `WorkspaceProvider` render sites (empty + loaded), like `httpClient`.
- `src/routes/index.tsx` - `const [scriptRunner] = useState(createQuickJsScriptRunner)`; pass to
  `WorkspaceLoader`.

**Editor hint (cosmetic, not an AC):**
- `src/components/workspace/config-panels.tsx` - optional one-line API hint above the Script
  editor (`purerequest.setVar / req.setUrl / res.getJson / console.log`). Skip if it complicates layout.

**Deps:**
- `package.json` - add `quickjs-emscripten`. No Rust change.

## Edge cases handled (from spec §9)

- Empty/whitespace script -> runner not invoked (guard before `run`).
- Pre sets a bodyless method -> `buildHttpRequest` `BODYLESS_METHODS` rule wins on `node2.method`.
- `req.setHeader` vs auto Content-Type / auth -> header overrides merge into `effective.headers`
  by name; existing build-request precedence unchanged.
- `setVar` to an env-block name -> writes `config.variables` only (documented).
- Cancel during pre -> generation re-check after the await, before `client.send`.
- WASM load failure -> `{ ok:false }`; pre aborts with it, post logs it; no crash.
- Infinite loop -> interrupt handler trips at `timeoutMs`. (Async-microtask-loop is best-effort -
  see Risks.)
- `res.getJson()` non-JSON -> `undefined`, no throw.
- Many `setVar`s -> one `persistTree` per run.
- Post error after some `setVar`s -> those writes still persisted; success state unaffected.

## Tests to write (RED first, one+ per AC)

Pure (Vitest, no React):
- `var-write.test.ts` - `findVarWriteTarget` (parent / request / nearest) + `setNodeVar` immutable
  write (TC-002/AC-002).
- `quickjs-runner.test.ts` - real adapter: sync `setVar` host call; `await Promise.resolve()` async
  path; `nope()` -> `{ok:false}`; `while(true){}` with `timeoutMs:50` -> `{ok:false}` (no hang);
  `window.x` -> `{ok:false}` (no host globals) (TC-001/AC-008/AC-009). Gated to skip if the WASM
  module can't load in the test env (logged, not silently passed - see Risks).
- `fake-runner.test.ts` - invokes impl, maps throw to `{ok:false}`, no-op default `{ok:true}`.

React (Vitest + RTL, fake runner + fake http client):
- pre mutates wire url/header -> recorded wire reflects it after interpolation (TC-003/AC-001).
- pre `setVar` -> tree node persisted + same-send wire reflects the runtime value (TC-004/AC-002/3).
- pre throws -> `client.send` NOT called, state `error`, console line (TC-005/AC-005).
- post reads `res` + `setVar` -> persisted, state still `success` (TC-006/AC-004); post throws ->
  still `success` + console error line (TC-006/AC-006).
- `console.log` in a script -> `[pre]`/`[post]` line in `consoleLines` (TC-007/AC-007).
- no-scripts config -> runner not invoked, wire unchanged (TC-008/AC-008 regression).

## Execution order

1. RED: spawn fresh test-writer subagent (skill Phase 3) for the ACs/TCs above.
2. GREEN per layer:
   a. Port + fake + `var-write` (pure) -> commit `feat(scripts): AC-002 ScriptRunner port + setVar target helpers`.
   b. Send-loop splice (pre/post against the fake runner) -> commit `feat(scripts): AC-001/003/004/005/006/007 pre+post execution in send loop`.
   c. QuickJS adapter + route wiring -> commit `feat(scripts): AC-008/009 QuickJS sandbox runtime`.
3. REFACTOR: extract `buildScriptApi`/var-fold helpers if `sendRequest` grows ifology; keep green.
4. VERIFY: fresh verifier subagent; run `npm test`, `npm run typecheck`, `npm run lint`. (No Rust
   change -> `cargo test` is a regression check only, expected unchanged 9/9.)

## Acceptance verification

- AC-001..009 each map to a named test (trace table filled in after verify). Gates: vitest
  all-green, tsc clean (no `any`), eslint clean. Manual smoke in the running app (real QuickJS):
  a pre `req.setHeader` + a post `purerequest.setVar` chained into a second request, console output
  visible.

## AC traceability (verified PASS, 871 frontend tests, fresh-verifier PASS)

| AC | Test |
| ---- | ---- |
| AC-001 | scripts-send-loop "should send the wire with the pre-script-mutated, interpolated url and header" (asserts the wire the fake httpClient received); script-context "buildScriptApi - req" block |
| AC-002 | var-write "should return the parent folder id…/the request id…/nearer ancestor folder id…" + "should set/overwrite config.variables…"; scripts-send-loop "should persist the set var and reflect it in the same send's wire" |
| AC-003 | scripts-send-loop "should persist the set var and reflect it in the same send's wire" (runtime layer: same-send `{{token}}`->abc; persisted tree for next-request chaining) |
| AC-004 | scripts-send-loop "should persist a post setVar and keep the response success" (reads res.getStatus/getJson); script-context "buildScriptApi - res" (incl. non-JSON getJson -> undefined) |
| AC-005 | scripts-send-loop "should abort the send, set error state, and log a console line if pre throws" (client.send NOT called + error state + console line) |
| AC-006 | scripts-send-loop "should keep the response success and log a console line if post throws" + "should persist a post setVar made before a later throw" |
| AC-007 | scripts-send-loop "should append a [pre]-/[post]-prefixed console line…"; script-context "buildScriptApi - console" |
| AC-008 | quickjs-runner "should not expose window…/fetch or process…" (REAL QuickJS-WASM, not faked); scripts-send-loop "should not invoke the runner…if scripts are empty/whitespace only" |
| AC-009 | quickjs-runner "should support async/await and call setVar with the resolved value" (real evalCodeAsync + resolvePromise + executePendingJobs drain) |

Edge cases (spec §9) additionally pinned: whitespace-only script skips runner; pre switching to a bodyless method nulls the body; many setVars -> one persistTree; post setVar before a throw still persists; non-JSON getJson -> undefined.

Status: **Implemented + verified** (fresh-context verifier PASS, all 9 ACs + 3 gates green; the 5 edge cases the verifier flagged as untested were then covered with regression tests - they passed on first run, confirming the code was already correct). typecheck clean, lint 0 errors (7 pre-existing warnings), `npm run build` bundles the WASM for the webview, vitest 871/871, cargo unchanged (no Rust change).

Deviations from plan: none material. `sendRequest` became `async` (planned). The QuickJS adapter evaluates user code in **module scope** (`type:"module"`) rather than an async IIFE - module scope is what enables native top-level `await`, and the module-completion promise is drained with `executePendingJobs` + `resolvePromise`. The umbrella `quickjs-emscripten` package bundles all 4 WASM variants (~4 MB total), heavier than the ~1 MB single-variant estimate.

## Risks

- **`quickjs-emscripten` WASM load under Vite/Tauri webview.** Using the embedded single-file async
  variant avoids a separate `.wasm` asset. Risk: the loader path differs in jsdom (test) vs the
  webview. Mitigation: the port/fake seam means the entire send-loop + helper suite runs WASM-free;
  only `quickjs-runner.test.ts` touches real WASM and is skip-gated with a logged reason if the
  module can't init under vitest, with a mandatory manual smoke in the running app as the backstop.
- **Async script interruption.** A sync `while(true)` is reliably killed by the interrupt handler;
  an `async` script parked in an awaited-microtask loop is a known `quickjs-emscripten` weak spot
  (interrupt fires on the eval stack, not pending jobs). Accepted: the common loop case is covered,
  the pathological-async case is best-effort. Documented in the spec.
- **`setVar` disk write on every send.** Persisting to disk (user decision) means a send with a
  `setVar` script rewrites a `*.req.json` / `folder.json` each run -> git churn. Mitigation: one
  `persistTree` per run (batched), and the write reuses the audited reconcile path
  (managed-files-only) so it can't corrupt user files. Noted as a tradeoff, not a defect.
- **Nearest-scope write blast radius.** `findVarWriteTarget` can resolve to a shared folder, so one
  request's script can rewrite a `folder.json` other requests read. This is the user's chosen
  semantic ("update the var where it logically lives"); covered by an explicit `var-write` test.
- **`sendRequest` becoming `async`.** Existing callers fire-and-forget it (return value ignored),
  so the signature change is non-breaking; the generation/cancel machinery already tolerates async
  resolution. The no-scripts regression test (TC-008) proves the splice is behavior-preserving when
  both scripts are empty.
- **New npm dep size.** `quickjs-emscripten` ships a WASM blob (~1 MB). Acceptable for a desktop
  app and the only recommended in-webview sandbox; logged in the ADR.
