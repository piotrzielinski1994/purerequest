# Spec: File logging

**Version:** 0.1.0
**Created:** 2026-06-25
**Status:** Done (verified)
**Branch:** `20260625221734-file-logging`

## 1. Overview

purerequest has no file logging today. The Rust backend prints nothing structured, and the only
diagnostic frontend call is a lone `console.warn` in the Tauri-store persistence wrapper (lost
to devtools). When a user hits a bug there is no on-disk artifact to inspect - you can't ask
"send me the log".

This feature mirrors the logging the sibling `vidui` repo already ships: the official
`tauri-plugin-log` v2, writing a fresh per-launch log file to the OS app-log dir, plus a
frontend bridge so the webview can write to the same file.

### Scope

- **In:**
  - `tauri-plugin-log` v2 registered in the Tauri builder. One **per-launch** file
    `purerequest-<YYYYMMDDHHMMSS>.log` in the OS app-log dir (macOS `~/Library/Logs/com.pzielinski.purerequest/`).
  - Targets: **Stdout + the per-launch file**. Level `Info`. `RotationStrategy::KeepAll`,
    `max_file_size(50_000_000)` (50 MB) - one session, one file, never rotated mid-run.
  - Best-effort init: if the log dir is unwritable the app still launches (log to stderr and skip).
  - Backend `send_http_request` / `cancel_http_request` emit `log::info!` lines (request method+url,
    status+time, cancellation) so the file has real content.
  - A frontend bridge: a `log_message` Tauri command + a small FE helper that routes a level + message
    to the file log. Wire the existing `tauri-store.ts` persist-failure `console.warn` through it.
  - Log permission added to the capability file.
- **Out:**
  - The JS `@tauri-apps/plugin-log` npm package (vidui doesn't use it; the custom-command bridge is
    simpler and matches the existing `invoke`-based FE->Rust pattern). YAGNI.
  - A user-facing "view logs" UI, log-level setting, or log export. Not requested.
  - Routing the in-app **script console** (QuickJS `console.*`) to the file - that's a user-facing
    feature with its own UI panel, not app diagnostics. Out of scope.
  - Structured/JSON log format, custom formatter, log shipping. Default plugin format only.

## 2. Acceptance Criteria

- **AC-001:** On app launch a log file named `purerequest-<YYYYMMDDHHMMSS>.log` (14-digit local-time stamp)
  is created in the OS app-log dir; a new file is created on each launch.
- **AC-002:** Log output goes to **both** stdout and the per-launch file, at level `Info` and above
  (Debug/Trace suppressed).
- **AC-003:** If the log dir is unwritable, init fails soft: a stderr notice is printed and the app
  still launches (no panic, no aborted setup).
- **AC-004:** The backend HTTP commands emit log lines: a request start line (method + url) and a
  result line (status + elapsed ms, or the error / cancellation), landing in the file.
- **AC-005:** The frontend can write a leveled message to the same file log via a Tauri command; the
  call is best-effort (no-op and never throws outside a Tauri host).
- **AC-006:** The existing `tauri-store.ts` persist-failure path logs a warning through that bridge
  (in addition to / instead of the bare `console.warn`).
- **AC-007:** Rotation is `KeepAll` with a 50 MB per-file cap (config-level assertion, mirrors vidui).

## 3. Test Cases

- **TC-001** (happy path, pure): `launch_log_name(2026, 6, 25, 22, 17, 34)` -> `"purerequest-20260625221734"`.
  Maps to: AC-001.
- **TC-002** (boundary, pure): single-digit fields zero-pad - `launch_log_name(2026, 1, 2, 3, 4, 5)`
  -> `"purerequest-20260102030405"`. Maps to: AC-001.
- **TC-003** (shape, pure): the stamp after the `purerequest-` prefix is exactly 14 ASCII digits.
  Maps to: AC-001.
- **TC-004** (FE behavior): `logMessage("warn", "x")` invokes the `log_message` command with
  `{ level: "warn", message: "x" }`. Maps to: AC-005.
- **TC-005** (FE error/edge): `logMessage(...)` resolves (does not throw) when `invoke` rejects
  (outside a Tauri host). Maps to: AC-005.
- **TC-006** (FE side-effect-contract): a failed `persist` calls the log bridge with a warn-level
  message naming the key. Maps to: AC-006.

## 4. Data model

No persisted app data. One pure helper:

```
launch_log_name(year, month, day, hour, minute, second) -> "purerequest-<YYYYMMDDHHMMSS>"
```

FE bridge level is a closed string union: `"info" | "warn" | "error" | "debug"`.

## 5. Edge cases

- **Unwritable log dir** -> soft-fail to stderr, app launches (AC-003).
- **FE call outside Tauri host** (`npm run dev`, Vitest jsdom) -> `invoke` rejects -> helper swallows,
  resolves void (AC-005 / TC-005).
- **Clock at midnight / single-digit month-day-time** -> zero-padded 14 digits (TC-002).
- **Empty / very long FE message** -> passed through verbatim; no truncation (plugin handles size cap).
- **Concurrent launches** -> distinct second-resolution stamps; same-second double launch could collide,
  acceptable (matches vidui; KeepAll appends, no data loss beyond interleave).

## 6. Dependencies

- New Rust deps (mirror vidui): `tauri-plugin-log = "2"`, `log = "0.4"`,
  `chrono = { version = "0.4", default-features = false, features = ["clock"] }`.
- Capability: `log:default` permission in `src-tauri/capabilities/default.json`.
- No new npm dependency.

## 7. AC traceability (verified)

| AC | Proven by |
| -- | --------- |
| AC-001 | `logging.rs` tests `should_format_launch_name_as_requi_plus_14_digits`, `should_zero_pad_single_digit_fields`, `should_match_feature_folder_timestamp_shape` (TC-001/002/003) + live launch (`purerequest-20260625223125.log` created) |
| AC-002 | `logging.rs::init` `targets([Stdout, LogDir{..}])` + `.level(Info)` (config) + live: startup line in both file and stdout |
| AC-003 | `logging.rs::init` early `return` on `app.plugin(...).is_err()` (config, vidui-mirror) |
| AC-004 | `lib.rs` `log::info!` lines in `send_http_request` (start + result) and `cancel_http_request` |
| AC-005 | `file-log.test.ts` `should invoke the log_message command with the level and message` (TC-004), `should resolve and not throw if invoke rejects` (TC-005) |
| AC-006 | `tauri-store-log.test.ts` `should log a warning through the file-log bridge if a persist fails` (TC-006), `should resolve save even if every persist fails` |
| AC-007 | `logging.rs::init` `RotationStrategy::KeepAll` + `max_file_size(50_000_000)` (config) |

Gates: `cargo test` 10/10, `npm test` 1167/1167, `npm run typecheck` clean, `npm run lint` 0 errors.
