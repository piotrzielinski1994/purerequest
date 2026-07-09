# ReqUI

A minimal, keyboard-driven, fully configurable, file-based desktop HTTP client.

Built as a Tauri 2 desktop app with a React 19 + TypeScript frontend on the TanStack
stack (Router, Query, Table, Form, Hotkeys) and shadcn/ui + Tailwind v4.

## Prerequisites

- **Node.js** - version pinned in [.nvmrc](.nvmrc). Run `nvm use` before any npm command.
- **Rust** stable toolchain (`rustc`, `cargo`).
- **Tauri OS prerequisites** - platform-specific system libraries (WebKitGTK on Linux,
  Xcode CLT on macOS, WebView2 + Build Tools on Windows). See
  https://tauri.app/start/prerequisites/

If the Rust toolchain or system prerequisites are missing, `npm start` fails fast with
a build error from Cargo.

## Setup

```bash
nvm use
npm install
```

## Commands

| Command | Description |
| --- | --- |
| `npm start` | Launch the desktop app (`tauri dev`) - native window + Vite dev server. |
| `npm run dev` | Frontend-only Vite dev server (browser, no native shell) - seeds a demo workspace so the UI is interactive without a Tauri host. |
| `npm run build` | Typecheck + production frontend build (`dist/`). |
| `npm run tauri build` | Produce a native desktop bundle. |
| `npm run lint` | ESLint (flat config). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run format` | Prettier write. |
| `npm test` | Frontend behavior + integration tests (Vitest, run once). |
| `npm run test:watch` | Vitest in watch mode. |
| `npm run e2e` | Playwright E2E against the `npm run dev` build (starts the dev server itself). |

Rust backend tests: `cd src-tauri && cargo test`.

> E2E prerequisite (one-time): `npx playwright install` to fetch the browser. E2E drives the
> browser build wired to fakes (in-memory fs + fake HTTP), not the native Tauri boundary - that
> stays covered by `cargo test`.

## Releasing installers

The [`Release` workflow](.github/workflows/release.yml) builds installers for all three OSes and
publishes them to a GitHub Release. It is **manual only**: GitHub -> Actions -> "Release" -> "Run
workflow", enter a tag (e.g. `v0.1.0`). It produces a single universal macOS `.dmg`, a Windows
installer, and a Linux `.AppImage`, attached to a **draft** Release. The binaries are **unsigned**:
on macOS right-click the app and choose Open; on Windows choose "More info -> Run anyway".

To take installers down later, delete the Release (and its tag) or remove individual assets - the
download links 404 immediately. Anyone who already downloaded keeps their local copy.

> The home route renders the workspace layout (sidebar collection tree, request tabs,
> URL bar, request/response panes, console). The URL bar is editable (URL field + method
> select); **Send** issues a real HTTP request through a Rust `send_http_request` command
> (`reqwest`, rustls TLS) - the request's resolved config is applied (`{{var}}` substitution
> in the URL + header/param values, query params merged into the URL, auth header, timeout,
> and body for non-GET/DELETE methods). While a request is in flight, **Send** becomes **Stop**
> (the send shortcut/Enter also cancels): a `cancel_http_request` command fires a Rust
> `CancellationToken` that aborts the in-flight `reqwest` send, returning the pane to idle (no
> error shown). The response pane shows loading (`Sending…`), error (the failure reason), or
> success (status + formatted time/size + body + headers) per request; with no send yet it falls
> back to the seeded response. Time/size are human-readable (`142ms`/`1.52s`, `512 B`/`2.0 KB`/
> `2.0 MB`), and a body over ~2 MB is not fed whole into the viewer - it shows a head-truncated
> preview + a size notice (the filter is hidden) so a huge response can't freeze the UI. The response **Filter** input narrows the
> shown body by a JSONPath-ish path (`$.args.foo`, `$.headers[0]`); an empty path shows the
> full body, a path that matches nothing (or a non-JSON body) shows "No match". URL/method/body
> edits live in session memory until saved: `Mod+S` (the same Save action, also in the command
> palette) writes the active **saved** request's url/method/body back to its `*.req.json` (a
> config/`.env` editor, when open, wins the Save). **Every unsaved edit surface shows a dirty
> dot** - a request's dot sits beside its tab name (set by url/method/body edits **or** an
> unsaved config edit), a folder config / `.env` editor's dot sits on its editor tab. Closing
> any tab/editor with unsaved edits (its `X`, `Mod+W`, or close-all) asks to confirm before
> discarding.
> The request pane's **Body** tab has a body-type selector: **JSON** (a CodeMirror editor -
> JetBrains Darcula theme, JSON syntax highlighting, auto-closing brackets, and inline JSON
> linting that red-underlines malformed JSON), **None** (no body sent), **Form URL Encoded**
> and **Multipart Form** (a key/value grid; multipart is text parts only), and **GraphQL** (a
> resizable split with a GraphQL-highlighted query editor above a JSON variables editor; sent as
> `application/json` `{ query, variables }`, where `variables` is included only when it parses to
> a JSON object). Each mode auto-sets its `Content-Type` (an explicit `Content-Type` you set in
> the Headers tab always wins); switching modes preserves data - form and multipart share their
> rows, the JSON text and the GraphQL query/variables each keep their own slot. The mode + payload
> persist to the request's `*.req.json` and the Settings tab JSON.
>
> Per-installation UI settings (panel split sizes, whether the console is hidden, whether the
> window was fullscreen, and the set of open request tabs + the active one) persist to a
> `settings.json` in the OS
> app-config dir via the Tauri Store plugin, restored on launch (open tabs reopen on
> restart; ids no longer in the workspace are dropped, freshly-created in-session ids are not
> persisted until the workspace reloads from disk).
> Keyboard-shortcut overrides are stored separately in a `keymap.json` in the same dir, so
> a user can sync their keymap across devices independently of the device-local UI state.
> The **theme** splits the same way: the chosen mode (light / dark / system) is device-local
> UI state in `settings.json` (`theme.mode`), while per-mode **custom colors** live in their own
> `theme.json` so a color scheme is syncable on its own. The Settings tab's **Theme** section has
> a mode selector plus a raw-JSON editor for the colors (18 app tokens + 9 editor-syntax tokens
> per mode, as `oklch(...)` strings); only values that differ from the built-in default are saved,
> and editing one back to its default clears the override. **System** follows the OS
> `prefers-color-scheme` and flips live. A **Toggle theme** command (`Mod+Shift+L`, also in the
> command palette) cycles light -> dark -> system without opening Settings, showing a toast naming
> the chosen mode (System spells out the resolved scheme, e.g. `Theme: System (dark)`, so the
> switch is legible even when the OS is already dark). The six CodeMirror editors (request body, response viewer,
> config / `.env` / script, console) follow the active mode and honor the custom editor colors.
> In `npm run dev` (browser, no native shell) there is no Tauri host, so settings fall back
> to defaults and saving is a no-op.
>
> Every wired action has a configurable keyboard shortcut (TanStack Hotkeys). Defaults:
> open settings `Mod+Shift+S`, close settings `Esc`, toggle console `Mod+J`, toggle sidebar
> `Mod+B`, toggle theme `Mod+Shift+L`, next/prev request `Ctrl+Tab`/`Ctrl+Shift+Tab`, close request `Mod+W`, close other
> request tabs `Mod+Alt+W`, close all request tabs `Mod+Shift+W`, new request `Mod+T`, open workspace `Mod+O`, send request
> `Mod+Enter`, copy as cURL `Mod+Shift+C`, import cURL `Mod+Shift+I`, import Bruno collection
> `Mod+Shift+B`, command palette `Mod+K`
> (`Mod` = Cmd on macOS, Ctrl
> elsewhere). The command palette is an overlay listing every wired action with its shortcut;
> type to filter, arrow to move, Enter (or click) to run, Esc to close. Settings open as a
> tab inside the workspace (sidebar + console stay visible); `Mod+Shift+S` opens/activates it,
> `Esc` or the tab's close button returns to the request. `Mod+W` closes whatever tab is
> active (settings or a request). Open workspace shows a native folder picker and loads the chosen folder. Rebind any
> shortcut there (no on-screen link yet); a new binding is rejected if another action already
> uses it. Settings is not a route, so it never resets the workspace.
>
> Drag-and-drop: open request tabs can be dragged to reorder them (the new order persists
> like the rest of the tab state). In the sidebar collection tree, drag a request or folder
> onto another folder to move it inside, or between two rows to reorder siblings; the change
> is written back to the workspace on disk so it survives a reload (in `npm run dev` there is
> no Tauri host, so the move stays in-session only). The sidebar supports **multi-select**:
> `Cmd/Ctrl+click` toggles a row into the selection, `Shift+click` picks the range from the
> last-clicked row, and dragging any selected row moves the whole selection in one drop.
>
> The collection tree is fully writable from the UI. **Right-click a folder** for New request /
> New folder (created inside it) / Rename / Delete; **right-click a request** for Rename /
> Duplicate / Delete; **right-click the empty sidebar area** for New request / New folder (at the
> workspace root). The same ops run from the **command palette** or via shortcuts: new request
> `Mod+T`, new folder `Mod+Shift+N`, duplicate `Mod+D`, rename `F2`, delete `Mod+Backspace`
> (palette/shortcut ops act on the selected node; `delete` is suppressed while a text field is
> focused). Palette/shortcut creates land relative to the selection (inside a selected folder,
> after a selected request, else at the root). New request and new folder both write to disk
> immediately and open/select the new node. A new **folder** drops into inline rename; a new
> **request** opens its tab and **focuses the URL input** - while it stays unnamed, its name
> auto-tracks the URL path (e.g. typing `{{baseUrl}}/widgets` names it `/widgets`, the same
> path-as-name convention the workspace files use). The auto-naming stops once you rename the
> request (inline `F2` or Settings) or save it; an already-named request never renames from a
> URL edit. Rename is an inline edit in the row (Enter commits, Esc cancels; the input is
> focused + selected on open). Deleting a request or an empty folder is immediate; deleting a
> non-empty folder asks to confirm. Every op persists through the same on-disk write path as a move.
>
> **cURL bridges** (command palette + shortcuts): **Copy as cURL** (`Mod+Shift+C`) writes the
> active request to the clipboard as a runnable `curl` command - the *resolved wire* form
> (`{{vars}}` substituted, query params appended, auth as an `Authorization` header, body
> encoded + `Content-Type` set), so it pastes-and-runs (and may embed secrets, like the
> plaintext workspace). **Import cURL** (`Mod+Shift+I`) opens a paste dialog; the pasted command
> is parsed (method, url, `-H` headers, `-d`/`--data*` body, `-u` basic auth, `-b` cookie;
> unknown flags ignored) into a **new** request node placed relative to the tree selection and
> persisted - it never overwrites the active request.
>
> **Import Bruno collection** (`Mod+Shift+B` + palette) opens a folder picker and reads a Bruno
> collection directory in **either on-disk format** - the legacy `.bru` markup (`.bru` +
> `bruno.json` + `environments/*.bru`) **or** OpenCollection YAML (`*.yml` + `opencollection.yml`/
> `folder.yml` + `environments/*.yml`; what real Bruno/Postman-converted exports use). The collection
> is parsed (method/url/headers/params/body/auth/scripts/vars; disabled rows kept disabled;
> `tests`/`assert`/`docs`/`body:graphql` skipped) into a ReqUI subtree and inserted as a **new
> top-level folder** named from `bruno.json`/`opencollection.yml` (Bruno `environments/<name>` fold
> into that folder's `config.environments`). The collection's own root `.env` is **merged into the
> workspace `.env`** (imported keys win on a clash) so its `{{process.env.X}}` tokens resolve.
> Additive like cURL import - it never replaces the open workspace; an empty collection adds nothing.
> In `npm run dev` (no native host) the action is a no-op.
>
> A **workspace** is a folder on disk holding the collection tree + config. By default it lives
> in a `collection` subfolder of the app data dir (next to `settings.json`), created on first
> write - so a fresh install is writable out of the box. Point the app elsewhere by hand-editing
> `workspacePath` in that same `settings.json`; it loads on launch (and a configured-but-empty or
> not-yet-created folder mounts a writable empty workspace, bootstrapped by the first request you
> create). Folders/requests carry inheritable config fields (variables,
> environments, headers, auth, scripts, timeout); a request resolves them by inheriting
> from its folder chain (child overrides parent), and that resolved config is what Send uses.
> On disk these fields sit flat at the doc's top level (no `config` wrapper). Body and
> params also live directly on the request (`request.body`,
> `request.params`) and are never inherited. The request pane's **Vars / Auth / Headers /
> Params / Body / Script** tabs are structured
> editors: Vars/Headers/Query are key→value grids (edit a cell, or type into the always-present
> trailing blank row to add; trash icon removes; Headers/Query rows have a full-cell enable
> checkbox - a disabled row is kept on disk but excluded from the sent request). A folder pane
> has no Params or Body tab.
> The **Params** tab nests a **Path / Query** sub-bar (Query default), both request-only:
> **Query** is `request.params.query` (a key→value grid, bidirectionally mirrored to the URL
> `?query`); **Path** is `request.params.path` (a `:name`→value record). A path param can be
> defined in the grid OR by writing `:name` in the URL
> (e.g. `/users/:id`) - the two stay in sync (typing `:name` in the URL adds a row, removing it
> prunes that row; grid-only rows are untouched). At send time each `:name` is replaced by its
> value (editable, `{{var}}`-interpolated); an empty value leaves the `:name` literal. Auth is a
> type select + fields, Script is pre/post text areas. These commit **immediately on
> blur** (or selection) via the same write path. The **Script** tab's `pre`/`post` JavaScript runs
> on every send (in a sandboxed QuickJS-WASM realm - no `window`/`fetch`/`process`): a **pre**
> script runs before the request is built and can mutate it (`req.setUrl/setMethod/setHeader/
> setBody`, still `{{var}}`-interpolated downstream) or set variables (`requi.setVar`); a **post**
> script runs after the response and can read it (`res.getStatus/getBody/getJson/getHeader`) and
> set variables for chaining the next request. `requi.setVar(name, value)` persists the variable to
> the `variables` field (nearest scope that already defines it, else the request's own).
> Bruno's `bru.*` API is aliased onto the same surface (`bru.setVar`, `bru.getVar`/`getEnvVar`/
> `getCollectionVar` -> `getVar`, `bru.getProcessEnv`, `bru.cwd()` is a no-op), so scripts in an
> imported Bruno collection run instead of throwing `'bru' is not defined`.
> `console.log/info/warn/error` output lands in the Console (prefixed `[pre]`/`[post]`),
> `console.clear()` wipes it; scripts may
> use `async`/`await`. A throwing **pre** script aborts the send (error in the response pane); a
> throwing **post** script only logs (the response stays). Config can also be edited as raw JSON
> (**Edit** in a sidebar row's right-click menu opens a raw-JSON editor in the content
> area - a **folder** edits its config object, while a **request**'s Settings tab edits the
> **whole request** JSON
> `{name, method, url, body, params, headers, auth, scripts, variables, ...}` (config fields flat
> at the top level) so everything about it lives in one place (saving a
> new body/url/method there re-syncs the Body tab + URL bar). The raw-JSON editors have no Save
> button - save with `Mod+S` or via the close-confirm popup (its **Save** is disabled while the
> JSON is invalid); malformed JSON shows a red lint underline. You can also hand-edit the files.
> A folder's own `.env` and its `config.environments` are edited from the folder pane's **Env**
> tab (an **Envs** / **.env** sub-bar of key->value tables). The **workspace-root** `.env` has a
> raw-text editor in the **Settings** view's **Env** section (saving - `Mod+S` or the close
> popup - writes `<workspace>/.env` and re-parses it live so token previews update without reload).
>
> **Variables & environments** (Bruno-style): any `{{name}}` token in a URL, header/param
> value, auth field, or body is interpolated on send. Values come from `config.variables`
> (plain) and, when an environment is active, from `config.environments.<name>` - both
> inherited down the folder chain. Within one scope a plain variable wins over that scope's
> environment block; across scopes the nearer scope wins. Environments are defined inside the
> folder/request config (no dedicated env files); the sidebar header **env selector** lists
> every environment name found in the tree plus "No Environment", and the active choice
> persists per-installation (`activeEnvironment` in `settings.json`, falling back to No
> Environment if it no longer exists). Interpolation is recursive (a variable value may
> reference another `{{var}}`), cycle-guarded, and leaves unknown tokens verbatim. Typing
> `{{` anywhere a token is valid - the URL bar, key/value + auth fields, the request **Body**
> editor, and the raw-JSON folder-config / request-Settings editors - opens a **completion
> dropdown** of the in-scope variables, the active environment's vars, and `.env` keys (as
> `process.env.X`), grouped nearest-scope-first; accepting one inserts `{{name}}`. The
> **script** editor (which reads vars via `requi.getVar`, not `{{}}`) and the theme-colors
> editor are deliberately excluded.
>
> `.env` files (standard `KEY=value`, gitignore them) are a separate namespace referenced as
> `{{process.env.KEY}}` (a bare `{{KEY}}` does not read `.env`). A `.env` may live at the
> workspace root **and in any folder**; a request resolves a key by folding its folder chain
> over the root - the **nearest folder** defining the key wins, the root `.env` is the base
> fallback (a request outside any folder resolves only the root `.env`). On-disk format
> (schemaVersion 5):
>
> ```
> <workspace>/
>   requi.workspace.json        manifest { schemaVersion, name }
>   <folder>/folder.json        { name, <config fields...>, order }
>   <folder>/.env               KEY=value (per-folder, gitignored; nearest wins)
>   <folder>/<request>.req.json { name, method, url, body, params, <config fields...>, order }
>   .env                        root base KEY=value (gitignored; {{process.env.KEY}})
> ```
>
> Config fields (variables, environments, headers, auth, scripts, timeoutMs) sit flat at the
> doc's top level - there is no `config` wrapper. Legacy files (a nested `config` object, or
> the earlier body/param shapes) still load and migrate to the flat shape on the next save.
>
> `body` is `{ "active": "json"|"none"|"form"|"multipart"|"graphql", "types": { "json": <StoredBody>,
> "form": [rows], "multipart": [rows], "graphql": { "query", "variables" } } }` - `active` picks
> the sent type while every type's payload is kept side-by-side (switching mode never discards the
> others). The `json` slot is a tagged `StoredBody`: `{ "type": "json", "payload": <parsed JSON> }`
> (real nested JSON, not an escaped string) or `{ "type": "text", "payload": "<raw>" }`. The
> `graphql` slot holds raw `query` + `variables` text. `params` is
> `{ "path": [rows], "query": [rows] }` - both `[{ "key", "value", "enabled"? }]` arrays, like
> `headers` and `variables`. Empty body/param slots are omitted for a minimal diff. Legacy
> workspaces (v2 bare-string body; v3 `body`+`bodyMode`+`bodyForm`, `config.params`, `pathParams`;
> pre-array record `variables`/path params) still load and migrate to the new shape on the next save.
>
> The variables + environments fields (flat on the node's doc) look like - every
> config grid is a `[{ key, value }]` array now (variables, headers, path, query,
> and each env's vars). A folder's per-env border color folds into its environments
> entry as `color`; a colored-but-undeclared env is an entry with empty `variables`.
>
> ```
>   "variables": [ { "key": "baseUrl", "value": "https://default" } ],
>   "environments": [
>     { "name": "local", "variables": [ { "key": "baseUrl", "value": "http://localhost:3000" } ] },
>     { "name": "prod", "color": "#dc262680",
>       "variables": [ { "key": "baseUrl", "value": "https://api.example.com" } ] } ]
> ```
>
> `order` is the node's position among its siblings (written on a drag-move; siblings sort by
> it on load, folders-first-then-name for legacy v1 files that lack it).
>
> Workspace files (including auth tokens / variable values) are stored **plaintext** -
> treat a workspace folder as sensitive and gitignore secrets accordingly.

## Repo layout

```
index.html              Vite entry HTML
src/
  main.tsx              React entry: providers + RouterProvider
  router.tsx            Code-based TanStack Router assembly
  app/providers.tsx     QueryClientProvider + HotkeysProvider
  routes/               __root (layout + 404), index (workspace home); dev build wires fakes + demo seed
  components/
    workspace/          workspace layout: sidebar tree, tabs, panes, console, loader
    ui/                 shadcn primitives
  lib/                  utils.ts (cn)
    runtime/            environment.ts (isDevBrowser: gates the dev-browser fakes)
    bruno/              Bruno import: parseBru (.bru) + parseOpenCollection (.yml), brunoToTree (ext-dispatch), reader port
    http/               HTTP loop: buildHttpRequest, filterJson, HttpClient port + Tauri/fake adapters
    settings/           per-installation settings: model + port, Tauri-store + in-memory adapters, provider
    workspace/          workspace domain: model, resolveConfig, disk-format, fs port + adapters, demo-seed
  index.css             Tailwind v4 + theme tokens
  test/setup.ts         Vitest + Testing Library setup
src-tauri/              Rust desktop shell (send_http_request/cancel_http_request, tauri.conf.json)
tests/
  e2e/                  Playwright specs (*.e2e.ts) against the dev-browser build
  integration/          Vitest jsdom routing/app-shell tests (*.spec.tsx)
playwright.config.ts    Playwright config (webServer = npm run dev on :1430)
docs/                   spec/plan per feature, ADR, learnings
```
