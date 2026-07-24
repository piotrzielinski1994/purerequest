import { invoke } from "@tauri-apps/api/core";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createTauriLogSink, logMessage } from "@/lib/logging/tauri-log-sink";

vi.mock("@tauri-apps/api/core", () => ({
  invoke: vi.fn(),
}));

const mockedInvoke = vi.mocked(invoke);

// Migrated from the byte-identical `file-log.test.ts` (R17, AC-004/TC-005/TC-006).
// Targets the app-side `createTauriLogSink()` factory's `log` port method rather
// than the bare `logMessage` free function. The factory wraps the native
// `invoke("log_message", …)` binding, so `@tauri-apps/api/core`'s `invoke` (the
// native boundary, NOT the SUT) is mocked while `createTauriLogSink` runs for real.
describe("createTauriLogSink", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // AC-004, TC-005 - side-effect-contract: routes the level + message to the
  // `log_message` Tauri command with the exact camel-keyed payload.
  it("should invoke the log_message command with the exact camel-keyed payload if log is called", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    const sink = createTauriLogSink();

    await sink.log("warn", "x");

    expect(mockedInvoke).toHaveBeenCalledWith("log_message", {
      level: "warn",
      message: "x",
    });
  });

  // AC-004, TC-006 - side-effect-contract: best-effort - outside a Tauri host
  // `invoke` rejects; the sink swallows it and resolves void rather than throwing.
  it("should resolve to undefined and not throw if invoke rejects", async () => {
    mockedInvoke.mockRejectedValue(new Error("not a tauri host"));
    const sink = createTauriLogSink();

    await expect(sink.log("error", "boom")).resolves.toBeUndefined();
  });

  // AC-004 (edge) - behavior: the happy path also resolves void, so callers
  // awaiting `.log(...)` never receive the raw `invoke` return value.
  it("should resolve to undefined if invoke resolves", async () => {
    mockedInvoke.mockResolvedValue("some native return value");
    const sink = createTauriLogSink();

    await expect(sink.log("info", "loaded")).resolves.toBeUndefined();
  });

  // AC-004 (edge) - side-effect-contract: the level + message are threaded
  // verbatim into the payload for every level (not hardcoded to one value).
  it("should thread each level verbatim into the log_message payload if log is called", async () => {
    mockedInvoke.mockResolvedValue(undefined);
    const sink = createTauriLogSink();
    const levels = ["info", "warn", "error", "debug"] as const;

    for (const level of levels) {
      await sink.log(level, `msg-${level}`);

      expect(mockedInvoke).toHaveBeenCalledWith("log_message", {
        level,
        message: `msg-${level}`,
      });
    }
  });
});

// The retained module-level facade is the public API every call site imports
// (settings/tauri-store), delegating to a module-singleton sink. These preserve
// the exact assertions the deleted `file-log.test.ts` made against the original
// `logMessage`, so the call site's behavior stays covered.
describe("logMessage facade", () => {
  beforeEach(() => {
    mockedInvoke.mockReset();
  });

  // AC-005 - side-effect-contract: the facade routes the level + message to the
  // `log_message` command with the exact camel-keyed payload.
  it("should route the level and message to log_message if called", async () => {
    mockedInvoke.mockResolvedValue(undefined);

    await logMessage("warn", "x");

    expect(mockedInvoke).toHaveBeenCalledWith("log_message", {
      level: "warn",
      message: "x",
    });
  });

  // AC-005 - behavior/edge: best-effort - the facade swallows a rejected invoke
  // (outside a Tauri host) and resolves void rather than throwing.
  it("should swallow a rejected invoke and resolve void when called via the facade", async () => {
    mockedInvoke.mockRejectedValue(new Error("not a tauri host"));

    await expect(logMessage("error", "boom")).resolves.toBeUndefined();
  });
});
