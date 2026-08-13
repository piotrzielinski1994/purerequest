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
| `npm start` | Run the app in development (`tauri dev`). |
| `npm run tauri build` | Build the distributable desktop bundle. |

## Installing

- **macOS (Homebrew):** `brew install --cask piotrzielinski1994/tap/purerequest`
- **Windows (winget):** `winget install pzielinski.purerequest`
- **Any OS (manual):** download the installer for your platform from the [latest Release](https://github.com/piotrzielinski1994/purerequest/releases/latest).

Both package manifests are updated automatically on every published Release: the Homebrew cask via
[`publish-cask.yml`](.github/workflows/publish-cask.yml) and the winget manifest via
[`publish-winget.yml`](.github/workflows/publish-winget.yml). See [packaging/winget/](packaging/winget/) for the initial manifests that must be submitted manually once, before the workflow can take over.

## Releasing installers

The [`Release` workflow](.github/workflows/release.yml) builds installers for all three OSes and
publishes them to a GitHub Release. It is **manual only**: GitHub -> Actions -> "Release" -> "Run
workflow", enter a tag (e.g. `v0.1.0`). It produces a single universal macOS `.dmg`, a Windows
installer, and a Linux `.AppImage`, attached to a **draft** Release. The binaries are **unsigned**:
on macOS right-click the app and choose Open; on Windows choose "More info -> Run anyway".

To take installers down later, delete the Release (and its tag) or remove individual assets - the
download links 404 immediately. Anyone who already downloaded keeps their local copy.

### In-app auto-update

Release builds ship the Tauri updater: the app checks the latest GitHub Release on startup (and via
Settings -> Updates -> "Check for updates") and, when a newer version exists, shows a toast with an
"Update now" button that downloads the signed update in place and relaunches. Two caveats:

- **Only works forward.** A given build can only auto-update to releases published _after_ it. The
  first updater-enabled build (and any build a user already has that predates the updater) must be
  downloaded manually once.
- **Signing secrets required in CI.** The workflow signs update artifacts with a minisign key. Add
  two GitHub repo secrets before releasing: `TAURI_SIGNING_PRIVATE_KEY` (the private key contents)
  and `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` (empty string if the key has no password). The matching
  public key lives in `src-tauri/tauri.conf.json` under `plugins.updater.pubkey`. Without the
  secrets the build still succeeds but emits unsigned artifacts the updater will reject.

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