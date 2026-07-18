# Spec: Pre/Post Request Scripts (execute `config.scripts.pre/post`)

**Version:** 0.1.0
**Created:** 2026-06-21
**Status:** Draft

## 1. Overview

`config.scripts.pre` and `config.scripts.post` already exist in the data model
(`ScriptConfig`), are resolved up the folder chain (`resolveConfig` -> `effective.scripts`),
and are editable in the request/folder pane's **Script** tab - but they are **dead**: nothing
ever executes them. This feature wires them into the send loop so a user can run JavaScript
**before** a request is sent (mutate the outgoing request, set variables) and **after** the
response arrives (read the response, extract values into variables for request chaining).

This mirrors Bruno/Postman pre-request + post-response scripting, scoped to this app's minimal
surface. Scripts run **frontend-side** inside the existing `sendRequest` loop
(`workspace-context.tsx`); the Rust side stays a pure transport (no change). One implementation
therefore covers both `npm start` (native) and `npm run dev` (browser).

### Scope

- **In:** execute resolved `scripts.pre` before send + `scripts.post` after response; a
  sandboxed JS runtime (QuickJS-WASM via `quickjs-emscripten`, async variant) behind a
  `ScriptRunner` port; a script context API (`purerequest` / `req` / `res` / `console`); pre-script
  mutation of url/method/headers/body (which then flow through the existing
  interpolation + body-encode + auth pipeline); `purerequest.setVar` persisting to disk; `console.*`
  output appended to the existing Console panel; a throwing **pre** script aborts the send (error
  in the response pane), a throwing **post** script reports to the console but keeps the response;
  a script wall-clock timeout (killable via QuickJS interrupt handler); `async`/`await` support in
  user scripts.
- **Out:** a `tests`/assertions block (rejected, item #14); `setNextRequest`/flow control; a
  declarative var-extraction phase; writing to **environment** blocks
  (`config.environments.<env>`) - `setVar` writes plain `config.variables` only; network/`fetch`,
  timers (`setTimeout`), filesystem, or any host API beyond the documented context; a per-script
  configurable timeout (fixed default this round); importing npm modules inside a script;
  pre-script reading `res`. (A post-script CAN read `req` - the sent request - but its setters are
  no-ops since the request already went out.)

### Decisions captured (user)

- **Sandbox:** the recommended pattern, **not** a hand-rolled `new Function`. For a webview
  (no Node `vm`/`isolated-vm`), that is **QuickJS compiled to WASM** (`quickjs-emscripten`,
  async variant) - the same engine Bruno migrated to after its vm2 sandbox-escape CVEs. Real
  realm isolation, killable on timeout, browser-compatible. Logged in `docs/adr.md`.
- **Stages:** wire up **both** `pre` and `post`.
- **`setVar` storage:** **persist to disk.** A `setVar` writes the variable into a node's
  `config.variables` and persists via the existing `onTreeChange`/`writeWorkspace` path
  (no separate in-memory runtime store; chaining works because the next request's `resolveConfig`
  reads the updated tree).
- **`setVar` scope:** **nearest scope that already defines the variable** (walk the resolved
  folder chain leaf-first; the first ancestor-or-self whose `config.variables` already has the
  name is overwritten); if no scope defines it, create it on the **request's own** config.
- **Pre-script mutation:** a pre-script may mutate **url, method, headers, body** (plus
  `setVar`). Mutations are applied **after** config resolution; the mutated (still raw, may
  contain `{{var}}`) values then flow through the existing `{{var}}` interpolation + body-encode +
  auth pipeline in `buildHttpRequest`.
- **Errors:** a throwing **pre** script **aborts** the send (response pane shows the error, the
  request never goes out); a throwing **post** script logs to the console but the
  already-received response stays visible.
- **Async:** **support `async`/`await`** in user scripts (QuickJS async variant +
  `executePendingJobs`).
- **API naming:** `req` / `res` (Bruno-identical) + a **`purerequest`** variable namespace (on-brand,
  in place of Bruno's `bru`). Fields are accessed via **Bruno-style `getX`/`setX` methods**
  (plain function calls - easy to marshal across the WASM boundary, no property proxies).

## 2. Script context API

The runtime exposes these globals. `req` exists in **both** stages (in **post** it reflects the
request as actually sent, including any pre mutation), `res` only in **post**; `purerequest` + `console`
exist in both. A post-script's `req` setters have no effect on the already-sent request.

```
purerequest.getVar(name)            -> string | undefined   resolved variable (incl. a value set
                                                       earlier in this same script run)
purerequest.setVar(name, value)                              persist to nearest-defining scope, else
                                                       the request's own config.variables
purerequest.getProcessEnv(name)     -> string | undefined   reads .env (`{{process.env.X}}` namespace)
purerequest.getEnvName()            -> string | null        active environment name

req.getUrl()  / req.setUrl(v)                          getUrl returns the {{var}}-interpolated url
                                                       (incl. vars set earlier this run); setUrl
                                                       takes a raw value, re-interpolated downstream
req.getMethod() / req.setMethod(v)                     HttpMethod; setMethod validates the enum
req.getHeader(name) / req.setHeader(name, value)       raw header value (case-insensitive name)
req.getHeaders() -> Record<string,string>
req.getBody() / req.setBody(v)                          raw body string

res.getStatus()        -> number
res.getBody()          -> string                        raw response body
res.getJson()          -> unknown | undefined           JSON.parse(body) or undefined on non-JSON
res.getHeader(name)    -> string | undefined            case-insensitive
res.getHeaders()       -> Record<string,string>
res.getResponseTime()  -> number                        ms

console.log / info / warn / error(...args)              appended to the Console panel,
                                                        prefixed `[pre]` / `[post]`
```

- `req` getters return the **raw, post-resolution, pre-interpolation** value. A value a script
  **sets** is treated the same - it is re-interpolated by `buildHttpRequest`, so
  `req.setUrl("{{baseUrl}}/x")` works and `req.setHeader("Authorization", "Bearer {{token}}")`
  works.
- Anything not listed (`window`, `fetch`, `process`, `setTimeout`, `require`, `import`) is
  **absent** in the sandbox - referencing it throws a `ReferenceError`, which (pre) aborts the
  send or (post) logs to the console.

## 3. Execution pipeline (`sendRequest`)

```
1. resolve effective config (existing resolveConfig, env-aware)
2. PRE (if effective.scripts.pre non-empty):
     - build a mutable reqDraft { method, url, body, headerOverrides:{} } seeded from the node
       + resolved headers, and a runtimeVars map + a varWrites list
     - run pre script against { purerequest, req, console }
         purerequest.setVar -> records to runtimeVars (for THIS send) AND varWrites (to persist)
         req.setX     -> mutates reqDraft
         console.*    -> pushes a console line
     - if the script ERRORS  -> set responseState = { error } , DO NOT send, return
     - if the send was cancelled meanwhile (generation changed) -> return
     - apply varWrites to the tree + persist (one persistTree call)
3. build the wire request:
     node2      = { ...node, method: reqDraft.method, url: reqDraft.url, body: reqDraft.body }
     effective2 = { ...effective,
                    variables: effective.variables + runtimeVars,
                    headers:   effective.headers  + reqDraft.headerOverrides }
     wire = buildHttpRequest(node2, effective2, processEnv)   // UNCHANGED fn
4. send (existing client.send + generation/cancel machinery)
5. on success:
     POST (if effective.scripts.post non-empty):
       - run post script against { purerequest, req, res, console } (res read-only over the response;
         req reflects the sent request - getters useful, setters no-op)
       - if the script ERRORS -> push a console line, KEEP the response state = success
       - apply varWrites to the tree + persist
   set responseState = { success, response }   (post runs before the state commit so a
   post setVar/log is reflected, but a post error never downgrades the success state)
```

Key design point: **`buildHttpRequest` is not modified.** The script layer only produces a
modified node + a modified `EffectiveConfig`; all interpolation, body-encode, auth, and bodyless
GET/DELETE handling stay exactly as today.

## 4. Sandbox (`ScriptRunner` port)

Mirrors the existing `HttpClient` / `fs` / `FolderPicker` seams:

```ts
type ScriptStage = "pre" | "post";

type ScriptOutcome = { ok: true } | { ok: false; error: string };  // ADT, no throw

type ScriptRunner = {
  run: (code: string, api: ScriptApi, opts?: { timeoutMs?: number }) => Promise<ScriptOutcome>;
};
```

- **Real adapter** `createQuickJsScriptRunner()` (`src/lib/scripts/quickjs-runner.ts`, the only
  file importing `quickjs-emscripten`): lazily loads the async WASM module **once** (memoized
  promise), and per `run` creates an async context, exposes `api` as globals, evaluates the code
  with `evalCodeAsync` + `executePendingJobs`, sets a wall-clock **interrupt handler**
  (`opts.timeoutMs`, default `SCRIPT_TIMEOUT_MS` = 5000), disposes every handle/context on every
  path. Returns `{ ok:false, error }` on a thrown guest error, on timeout, or on a load failure -
  never throws.
- **Fake adapter** `createFakeScriptRunner(impl?)` (`src/lib/scripts/fake-runner.ts`): runs an
  injected `(api) => void | Promise<void>` directly against the host `api` (so send-loop tests
  drive `req.setUrl`/`purerequest.setVar`/`console.log`/throw without WASM), or a no-op default.
- Threaded as a `WorkspaceProvider` prop (loader -> provider), held in a ref with the fake as the
  fallback - identical to `httpClient`. The QuickJS adapter is created in `routes/index.tsx`
  alongside the Tauri http client.

The single-file (embedded-WASM) async variant is used so there is **no separate `.wasm` asset**
for Vite to serve.

## 5. `setVar` persistence

- Pure helper `findVarWriteTarget(tree, requestId, name): nodeId`
  (`src/lib/scripts/var-write.ts`): walks the resolved scope path leaf-first, returns the first
  ancestor-or-self node whose `config.variables[name]` is defined; falls back to `requestId`.
- Pure helper `setNodeVar(tree, nodeId, name, value): TreeNode[]`: returns a tree with that
  node's `config.variables[name] = value` (immutable update, reuses `updateNodeConfig`).
- A script run collects `(name,value)` writes; after the script completes the send loop folds all
  of them into one tree (chaining `setNodeVar`) and calls `persistTree(next, "script")` once.
- Within a single script, `purerequest.getVar` reads the runtime value first (so a `setVar` then
  `getVar` in the same script sees the new value), then the resolved value.

## 6. UI

No new tab or view. Surfaces reused:

- **Script tab** (`config-panels.tsx` `ScriptPanel`): already edits `pre`/`post` (textareas,
  commit-on-blur). Unchanged behavior; it now drives real execution. (A short helper hint listing
  the available `purerequest`/`req`/`res`/`console` API may be added above the editor - cosmetic, not
  an AC.)
- **Console panel** (`console.tsx`): `console.*` from scripts append lines (prefixed
  `[pre]`/`[post]`); script errors and the pre-abort also append a line.
- **Response pane**: a pre-script error shows as the normal `{ status:"error" }` state with the
  script's error message; the body that would have been sent is not sent.

### UI States

| State                         | Behavior                                                                 |
| ----------------------------- | ------------------------------------------------------------------------ |
| no scripts                    | send loop unchanged (today's behavior).                                  |
| pre runs OK                   | request reflects pre mutations (url/method/headers/body) + set vars; sends.|
| pre throws / times out        | response pane = error (script message); request NOT sent; console line.  |
| post runs OK                  | response shown; set vars persisted; `console.*` lines appended.          |
| post throws / times out       | response STILL shown (success); console error line; partial setVars before the throw persist.|
| cancelled during pre          | send aborts (generation guard); state returns to idle.                   |

## 7. Acceptance criteria

- **AC-001:** When `effective.scripts.pre` is non-empty, it executes before the request is built;
  a pre-script `req.setUrl/setMethod/setHeader/setBody` changes the corresponding field of the
  wire request, and the set value is still `{{var}}`-interpolated + body-encoded + auth-applied by
  `buildHttpRequest` (e.g. `req.setHeader("X-Token","{{token}}")` sends the resolved token).
- **AC-002:** `purerequest.setVar(name, value)` persists the variable to disk via the existing tree
  write path; the write lands in the **nearest scope that already defines** `name`
  (`findVarWriteTarget`), or the **request's own** `config.variables` if none does.
- **AC-003:** A value set by `purerequest.setVar` in a **pre** script is visible to that same request's
  interpolation in the same send (runtime layer), and a value set in a **post** script is visible
  to the **next** request that resolves it (via the persisted tree) - i.e. request chaining works.
- **AC-004:** When `effective.scripts.post` is non-empty, it executes after the response arrives
  with a read-only `res` exposing status/body/json/headers/responseTime; `res.getJson()` returns
  the parsed body (or `undefined` for non-JSON).
- **AC-005:** A **pre** script that throws (or references an absent global, or exceeds the
  timeout) **aborts** the send: the response pane shows `{ status:"error" }` with the script error
  message, `client.send` is **not** called, and a console line is appended.
- **AC-006:** A **post** script that throws logs an error console line but the response stays in
  the `success` state (not downgraded to error).
- **AC-007:** `console.log/info/warn/error` inside a script append lines to the Console panel,
  prefixed `[pre]` / `[post]`.
- **AC-008:** Scripts run in an isolated QuickJS realm with **no** access to `window`, `fetch`,
  `process`, `setTimeout`, `require`, or `import`; the runtime is exposed behind a `ScriptRunner`
  port (real QuickJS adapter + a fake), threaded into `WorkspaceProvider` like `httpClient`, and
  the browser/dev build (no Tauri host) still builds and sends without throwing.
- **AC-009:** A script may use `async`/`await`; the send loop awaits the pre-script (before
  building the wire) and the post-script (before committing the success state).

## 8. Test cases

- **TC-001** (Rust/sandbox unit, AC-008/AC-009): QuickJS adapter - `run("purerequest.setVar('a','1')",
  api)` calls the host `setVar("a","1")` and returns `{ok:true}`; `run("await Promise.resolve(); purerequest.setVar('a', String(1+1))", api)` sets `a="2"` (async path); `run("nope()", api)` ->
  `{ok:false, error}`; `run("while(true){}", api, {timeoutMs:50})` -> `{ok:false}` within the
  timeout (does not hang); `run("window.x", api)` -> `{ok:false}` (no `window`).
- **TC-002** (unit, AC-002): `findVarWriteTarget` - var defined on a parent folder returns that
  folder's id; var defined nowhere returns the request id; var defined on both folder and request
  returns the request (nearest). `setNodeVar` writes `config.variables[name]` immutably.
- **TC-003** (send-loop integ, AC-001): fake runner whose pre impl does
  `req.setUrl("https://changed/{{v}}"); req.setHeader("X-A","1")`; send via a fake http client
  that records the wire; assert the wire `url` is the interpolated changed url and header `X-A` is
  present.
- **TC-004** (send-loop integ, AC-002/AC-003): fake pre impl `purerequest.setVar("token","abc")`; after
  send, the tree node's `config.variables.token === "abc"` (persisted) and the SAME send's wire
  reflects `{{token}}` -> `abc` (runtime layer).
- **TC-005** (send-loop integ, AC-005): fake pre impl that throws; assert `client.send` was NOT
  called, `responseState` is `error` with the message, and a console line was added.
- **TC-006** (send-loop integ, AC-004/AC-006): fake post impl reads `res.getStatus()`/`getJson()`
  and `purerequest.setVar("id", String(res.getJson().id))`; assert the var persisted and the response
  state is still `success`. A second case where post throws: response stays `success`, console
  error line present.
- **TC-007** (send-loop integ, AC-007): fake impl calls `console.log("hi")`; assert a `[pre] hi`
  (or `[post] hi`) line appears in `consoleLines`.
- **TC-008** (send-loop integ, AC-008): with the default (no scripts) config, the send loop
  behaves exactly as before (no runner invocation, wire unchanged) - regression net.

## 9. Edge cases

- **Empty / whitespace-only script:** treated as "no script" - runner not invoked (cheap guard),
  send proceeds normally.
- **Pre mutates method to a bodyless one (GET/DELETE):** `buildHttpRequest`'s existing
  `BODYLESS_METHODS` rule wins after the mutation (body nulled, no auto Content-Type) - tested via
  the changed `node2.method`.
- **`req.setHeader` colliding with an auto Content-Type / auth header:** header overrides merge
  into `effective.headers` by name (case-insensitive, same as `resolveHeaders`); the existing
  "explicit Content-Type wins" + auth-as-header logic in `buildHttpRequest` is unchanged.
- **`purerequest.setVar` to a name used in `config.environments`:** writes only to `config.variables`
  (the plain namespace); the env block is untouched (documented limitation).
- **Cancel during a pre-script:** the generation guard (already in `sendRequest`) is checked after
  the pre-script resolves; a changed generation aborts the send before `client.send`.
- **Script runtime fails to load (WASM init error):** `run` returns `{ok:false, error}`; a pre
  load-failure aborts the send with that error, a post load-failure logs it - the app never
  crashes.
- **Infinite loop / runaway script:** the QuickJS interrupt handler trips at `timeoutMs`
  (default 5000), returning `{ok:false}` - the UI thread is not frozen indefinitely (QuickJS
  evaluation is interruptible; the host stays responsive between interrupt checks).
- **`res.getJson()` on a non-JSON body:** returns `undefined` (no throw), so a post script can
  guard on it.
- **Many `setVar` calls in one script:** all collected and folded into one `persistTree` (one disk
  write per script run, not per call).
- **Post-script error after some `setVar`s:** the var writes made before the throw are still
  applied/persisted (they were recorded as the script ran); only the post-success state is
  unaffected.

## 10. Dependencies

- **Frontend (new npm dep):** `quickjs-emscripten` (async variant, embedded single-file WASM).
  No Rust change, no other npm dep. New pure-ish modules under `src/lib/scripts/`
  (`model.ts`, `quickjs-runner.ts`, `fake-runner.ts`, `var-write.ts`). Reuses `resolveConfig`,
  `buildHttpRequest` (unchanged), `updateNodeConfig`/`persistTree`, the Console panel, and the
  existing send loop + `HttpClient` port.
- **No** Rust / Cargo / capability change (scripts execute in the webview).

## 11. Open questions

- None blocking. Sandbox engine, stages, setVar storage + scope, pre-mutation surface, error
  policy, async support, and API naming all resolved with the user.
