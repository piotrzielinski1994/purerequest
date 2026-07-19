# purerequest

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

## Features

- **Requests** - method selector, URL bar, structured
  Vars / Auth / Headers / Params / Body / Script tabs plus a Settings tab
  (timeout, HTTP version Auto / HTTP/3) and a raw-JSON editor; **Send** issues a
  real HTTP request (resolved config applied), **Stop** cancels one in flight.
- **Response** - status, human-readable time/size, body with a JSONPath-ish **Filter**, headers,
  a **Timing** waterfall, and a Wireshark-style **Protocols** OSI dissection of the wire (TCP+TLS
  for HTTP/1.1+2; full QUIC packet/TLS/HTTP-3 decode for HTTP/3).
- **Collection** - a file-based workspace tree: create / rename / duplicate / delete / drag-move
  folders and requests, with multi-select and full keyboard navigation.
- **Config & variables** - inheritable variables, environments, headers, auth, scripts, and
  timeout; Bruno-style `{{var}}` and `{{process.env.KEY}}` interpolation with a completion popup.
- **Scripting** - sandboxed `pre`/`post` JavaScript per request (Bruno `bru.*` / Postman `pm.*`
  aliased) with a Console.
- **Import / export** - cURL, Bruno (`.bru` + OpenCollection), Postman, and OpenAPI/Swagger
  import; Bruno, Postman, and OpenAPI export; "Copy as code" (cURL / `fetch`).
- **UX** - light / dark / system theme with custom colors, a command palette + quick-open, in-app
  find, and fully configurable keyboard shortcuts.

The on-disk workspace format and JSON data model are documented in
[docs/data-format.md](docs/data-format.md). Per-feature specs live under
[docs/features/](docs/features/).

> Workspace files (including auth tokens / variable values) are stored **plaintext** - treat a
> workspace folder as sensitive and gitignore secrets accordingly.

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
    postman/            Postman import: parsePostman (v2.1 JSON -> subtree), postmanToTree (file-map + env fold), reader port
    http/               HTTP loop: buildHttpRequest, filterJson, HttpClient port + Tauri/fake adapters
    settings/           per-installation settings: model + port, Tauri-store + in-memory adapters, provider
    workspace/          workspace domain: model, resolveConfig, disk-format, fs port + adapters, demo-seed
  index.css             Tailwind v4 + theme tokens
  test/setup.ts         Vitest + Testing Library setup
src-tauri/              Rust desktop shell (send_http_request/cancel_http_request, tauri.conf.json)
  src/tap_client.rs     hand-rolled hyper + tokio-rustls send client (owns socket + TLS, taps wire bytes)
  src/quic_client.rs    HTTP/3 send client on quinn + h3 (tapping UDP socket + rustls KeyLog)
  src/quic_crypto.rs    RFC 9001 QUIC crypto (HKDF, header protection, AEAD) for packet decryption
  src/quic_dissect.rs   decodes a captured QUIC session into the layered Protocols-tab dissection
  src/qpack.rs          RFC 9204 QPACK decoder for HTTP/3 header blocks (used by quic_dissect.rs)
  src/pcap_capture.rs   optional libpcap/BPF side-car (PUREREQUEST_PCAP=1) capturing L2-L4 packet bytes
  src/dissect.rs        decodes captured bytes into the layered Protocols-tab dissection (TCP/TLS/HTTP-2)
  src/hpack.rs          RFC 7541 HPACK decoder for HTTP/2 header blocks (used by dissect.rs)
tests/
  e2e/                  Playwright specs (*.e2e.ts) against the dev-browser build
  integration/          Vitest jsdom routing/app-shell tests (*.spec.tsx)
playwright.config.ts    Playwright config (webServer = npm run dev on :1430)
docs/                   spec/plan per feature, ADR, learnings
```
