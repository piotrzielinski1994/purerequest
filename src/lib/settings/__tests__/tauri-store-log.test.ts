import { describe, it, expect, vi, beforeEach } from "vitest";

// AC-006 / TC-006 - the Tauri adapter's persist path is best-effort: when a
// LazyStore save() rejects, the failure is routed to the file log (logMessage)
// rather than lost to a bare console.warn. We fake the plugin-store surface so
// save() rejects, and assert the log bridge is called with a warn-level message
// naming the failed key.

const failingSave = vi.fn(() => Promise.reject(new Error("disk full")));

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    get = vi.fn(() => Promise.resolve(undefined));
    set = vi.fn(() => Promise.resolve());
    save = failingSave;
    delete = vi.fn(() => Promise.resolve(true));
  },
}));

vi.mock("@/lib/logging/file-log", () => ({
  logMessage: vi.fn(),
}));

import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { logMessage } from "@/lib/logging/file-log";

const mockedLog = vi.mocked(logMessage);

describe("createTauriSettingsStore persist failure", () => {
  beforeEach(() => {
    mockedLog.mockReset();
    failingSave.mockClear();
  });

  // AC-006, TC-006 - side-effect-contract: a rejecting save logs a warn through
  // the file-log bridge naming the failed key (it no longer console.warns).
  it("should log a warning through the file-log bridge if a persist fails", async () => {
    const store = createTauriSettingsStore();

    await store.save(DEFAULT_SETTINGS);

    expect(mockedLog).toHaveBeenCalled();
    const [level, message] = mockedLog.mock.calls[0]!;
    expect(level).toBe("warn");
    expect(message).toContain("Failed to persist");
  });

  // AC-006 - behavior: a failing persist never rejects the save() call itself
  // (the catch swallows it), so the app keeps running.
  it("should resolve save even if every persist fails", async () => {
    const store = createTauriSettingsStore();

    await expect(store.save(DEFAULT_SETTINGS)).resolves.toBeUndefined();
  });
});
