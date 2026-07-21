import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings/settings";

describe("mergeSettings activeEnvironment", () => {
  // AC-003 - behavior: a string activeEnvironment round-trips through merge
  it("should keep a string activeEnvironment", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      activeEnvironment: "prod",
    });

    expect(merged.activeEnvironment).toBe("prod");
  });

  // AC-003, E-2 - behavior: a non-string activeEnvironment is dropped
  it("should drop a non-string activeEnvironment", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      activeEnvironment: 42,
    });

    expect(merged.activeEnvironment).toBeUndefined();
  });

  // AC-003, E-2 - behavior: an array activeEnvironment is dropped
  it("should drop an array activeEnvironment", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      activeEnvironment: ["prod"],
    });

    expect(merged.activeEnvironment).toBeUndefined();
  });

  // AC-003, E-3 - behavior: absent activeEnvironment defaults to undefined
  it("should default activeEnvironment to undefined if absent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { consoleHidden: true });

    expect(merged.activeEnvironment).toBeUndefined();
  });

  // AC-003 - behavior: garbage activeEnvironment does not throw
  it("should not throw if activeEnvironment is garbage", () => {
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { activeEnvironment: { name: "x" } }),
    ).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { activeEnvironment: null }),
    ).not.toThrow();
  });
});
