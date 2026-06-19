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
| `npm run dev` | Frontend-only Vite dev server (browser, no native shell). |
| `npm run build` | Typecheck + production frontend build (`dist/`). |
| `npm run tauri build` | Produce a native desktop bundle. |
| `npm run lint` | ESLint (flat config). |
| `npm run typecheck` | `tsc --noEmit`. |
| `npm run format` | Prettier write. |
| `npm test` | Frontend behavior tests (Vitest, run once). |
| `npm run test:watch` | Vitest in watch mode. |

Rust backend tests: `cd src-tauri && cargo test`.

> The home route renders the workspace layout (sidebar collection tree, request tabs,
> URL bar, request/response panes, console). No real HTTP or in-app request editing yet.
>
> Per-installation UI settings (panel split sizes, whether the console is hidden, and
> keyboard-shortcut overrides) persist to a `settings.json` in the OS app-config dir via
> the Tauri Store plugin, restored on launch. In `npm run dev` (browser, no native shell)
> there is no Tauri host, so settings fall back to defaults and saving is a no-op.
>
> Every wired action has a configurable keyboard shortcut (TanStack Hotkeys). Defaults:
> open settings `Mod+Shift+S`, close settings `Esc`, toggle console `Mod+J`, toggle sidebar
> `Mod+B`, next/prev request `Ctrl+Tab`/`Ctrl+Shift+Tab`, close request `Mod+W`, new request
> `Mod+T`, open workspace `Mod+O`, command palette `Mod+K` (`Mod` = Cmd on macOS, Ctrl
> elsewhere). The command palette is an overlay listing every wired action with its shortcut;
> type to filter, arrow to move, Enter (or click) to run, Esc to close. Settings open as a
> tab inside the workspace (sidebar + console stay visible); `Mod+Shift+S` opens/activates it,
> `Esc` or the tab's close button returns to the request. `Mod+W` closes whatever tab is
> active (settings or a request). New request opens an in-memory draft tab (not yet saved to
> disk). Open workspace shows a native folder picker and loads the chosen folder. Rebind any
> shortcut there (no on-screen link yet); a new binding is rejected if another action already
> uses it. Settings is not a route, so it never resets the workspace.
>
> A **workspace** is a folder on disk holding the collection tree + config. Point the app
> at one by hand-editing `workspacePath` in that same `settings.json`; it loads on launch
> (empty state if unset/invalid). Folders/requests carry an inheritable config (variables,
> headers, params, auth, scripts, timeout); a request resolves it by inheriting from its
> folder chain (child overrides parent) - the request pane's read-only **Effective** tab
> shows each resolved value and where it came from. Config is authored by hand-editing the
> workspace files (no in-app editing or save yet). On-disk format:
>
> ```
> <workspace>/
>   requi.workspace.json        manifest { schemaVersion, name }
>   <folder>/folder.json        { name, config }
>   <folder>/<request>.req.json { name, method, url, body, config }
> ```
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
  routes/               __root (layout + 404), index (workspace home), settings
  components/
    workspace/          workspace layout: sidebar tree, tabs, panes, console, loader
    ui/                 shadcn primitives
  lib/                  tauri.ts (typed invoke wrappers), utils.ts (cn)
    settings/           per-installation settings: model + port, Tauri-store + in-memory adapters, provider
    workspace/          workspace domain: model, resolveConfig, disk-format (serialize/deserialize), fs port + adapters
  index.css             Tailwind v4 + theme tokens
  test/setup.ts         Vitest + Testing Library setup
src-tauri/              Rust desktop shell (greet command, tauri.conf.json)
tests/e2e/              Behavior smoke tests
docs/                   spec/plan per feature, ADR, learnings
```
