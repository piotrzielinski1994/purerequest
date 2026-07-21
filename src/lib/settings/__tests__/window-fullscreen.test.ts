import { describe, expect, it } from "vitest";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
} from "@/lib/settings/settings";

describe("mergeSettings windowFullscreen", () => {
  // behavior: a fresh install is not fullscreen
  it("should default windowFullscreen to false", () => {
    expect(DEFAULT_SETTINGS.windowFullscreen).toBe(false);
  });

  // behavior: a persisted boolean survives the merge
  it("should keep a boolean windowFullscreen value", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { windowFullscreen: true });

    expect(merged.windowFullscreen).toBe(true);
  });

  // behavior: a non-boolean persisted value falls back to the default
  it("should default windowFullscreen to false if the persisted value is not a boolean", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { windowFullscreen: "yes" });

    expect(merged.windowFullscreen).toBe(false);
  });

  // behavior: an absent key falls back to the default
  it("should default windowFullscreen to false if the key is absent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { consoleHidden: true });

    expect(merged.windowFullscreen).toBe(false);
  });

  // behavior: a valid full settings object round-trips unchanged
  it("should pass a valid full settings object with windowFullscreen through unchanged", () => {
    const full: Settings = {
      version: 1,
      layouts: {},
      consoleHidden: false,
      sidebarHidden: false,
      windowFullscreen: true,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: { mode: "system", colors: DEFAULT_SETTINGS.theme.colors },
    };

    expect(mergeSettings(DEFAULT_SETTINGS, full)).toEqual(full);
  });
});
