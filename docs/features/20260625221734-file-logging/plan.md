# Plan: File logging

**Spec:** [spec.md](spec.md)
**Branch:** `20260625221734-file-logging`
**Approach:** mirror `vidui` 1:1 (its `logging.rs` is the proven template), adapt names `vidui`->`requi`.
TDD where it pays: the pure `launch_log_name` helper (Rust) and the FE bridge (Vitest). Plugin wiring,
soft-fail, and backend `log::info!` calls are config/integration - asserted by the plugin config + manual
launch, not unit-tested (mirrors vidui, which only unit-tests the pure name helper).

## Key decisions / patterns

- **Custom-command FE bridge, not the JS plugin-log package.** vidui proves the pattern (`log_playback`);
  it matches requi's existing `invoke`-based FE->Rust seam (`tauri-client.ts`) and adds no npm dep. The
  command is generalized to `log_message(level, message)` (vidui's was playback-specific).
- **Register the plugin in `.setup()` via `app.plugin(...)`, not the builder `.plugin()` chain.** The
  `LogDir` target errors if the dir is unwritable; doing it in setup lets us swallow that and keep
  launching (AC-003). vidui does exactly this.
- **`targets([Stdout, LogDir{file_name}])` REPLACES the seeded defaults** (avoids a stray app-name file +
  duplicate stdout) - per vidui's comment.
- **No `tracing`** - the `log` facade + plugin is the whole story, matching vidui.

## Domain gate

Evaluated `pz-ddd` and `pz-archetypes`: **neither applies** - pure infrastructure/plumbing (logging
plugin wiring + a thin IPC bridge), no domain model, aggregate, boundary, or recurring domain shape.

## Files

**Create:**
- `src-tauri/src/logging.rs` - port of vidui's: `launch_log_name` (pure) + `current_launch_log_name`
  (clock) + `init(app)` (builds/registers plugin, soft-fail) + `log_message` command + the 3 pure tests.
- `src/lib/logging/file-log.ts` - FE helper `logMessage(level, message)`: best-effort `invoke("log_message", ...)`.
- `src/lib/logging/__tests__/file-log.test.ts` - TC-004, TC-005.

**Modify:**
- `src-tauri/Cargo.toml` - add `tauri-plugin-log`, `log`, `chrono` deps.
- `src-tauri/src/lib.rs` - `mod logging;`; add `.setup(|app| { logging::init(app.handle()); Ok(()) })` to
  the builder; register `logging::log_message` in `generate_handler!`; add `log::info!` lines to
  `send_http_request` (start + result) and `cancel_http_request`.
- `src-tauri/src/main.rs` - no change (already delegates to `requi_lib::run()`).
- `src-tauri/capabilities/default.json` - add `"log:default"`.
- `src/lib/settings/tauri-store.ts` - route the `persist` catch through `logMessage("warn", ...)`
  (keep behavior: still resolves, never throws). TC-006.
- `src/lib/settings/__tests__/...` (or a new test) - TC-006 asserting the bridge is called on persist failure.

## Execution order (TDD)

1. **RED (Rust):** add the 3 pure `launch_log_name` tests in `logging.rs` -> `cargo test` fails (no fn).
2. **GREEN (Rust):** add `launch_log_name` + `current_launch_log_name` -> tests pass.
3. **Wire plugin:** add deps, `init`, `log_message`, setup hook, handler, capability, backend log lines.
   Verify: `cargo build`, launch app, confirm `~/Library/Logs/com.pzielinski.requi/requi-*.log` appears
   and contains a request line after sending one.
4. **RED (FE):** `file-log.test.ts` TC-004/TC-005 -> `npm test` fails (no module).
5. **GREEN (FE):** add `file-log.ts` -> tests pass.
6. **RED (FE):** TC-006 (persist failure -> bridge called) -> fails.
7. **GREEN (FE):** wire `tauri-store.ts` `persist` catch through `logMessage` -> passes.
8. **REFACTOR:** tidy names/types, keep green.

## Tests to write (>= 1 per AC)

| AC | Test |
| -- | ---- |
| AC-001 | TC-001/002/003 (`launch_log_name` pure) |
| AC-002 | plugin config assertion / manual launch (Stdout+file, Info) |
| AC-003 | soft-fail manual check (config-level; vidui-mirrored, no unit test) |
| AC-004 | manual launch: send request, grep file for method+url+status line |
| AC-005 | TC-004, TC-005 (FE bridge invoke + no-throw) |
| AC-006 | TC-006 (persist failure routes through bridge) |
| AC-007 | plugin config assertion (KeepAll + 50 MB) |

## Acceptance verification

- `cargo test` in `src-tauri/` (Rust pure + existing suite green).
- `npm test` (Vitest FE green, incl. TC-004/005/006).
- `npm run typecheck` / lint clean, no `any`.
- Manual: `npm start`, send a request, confirm `requi-<ts>.log` exists in the OS log dir with the
  start+result lines; trigger a persist failure path is hard to force manually - covered by TC-006.

## Risks

- **AC-003/004/007 are not unit-tested** (config + integration only): mitigated by mirroring vidui's
  proven config verbatim + one manual launch check.
- **Same-second double-launch filename collision**: accepted (KeepAll appends; matches vidui).
