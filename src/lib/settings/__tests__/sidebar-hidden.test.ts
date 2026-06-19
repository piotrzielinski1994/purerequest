import { describe, it, expect } from "vitest";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
} from "@/lib/settings/settings";

describe("mergeSettings sidebarHidden", () => {
  // AC-003, TC-003 — behavior
  it("should default sidebarHidden to false", () => {
    expect(DEFAULT_SETTINGS.sidebarHidden).toBe(false);
  });

  // AC-003 — behavior
  it("should keep a boolean sidebarHidden value", () => {
    const partial = { sidebarHidden: true };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.sidebarHidden).toBe(true);
  });

  // AC-003 — behavior
  it("should default sidebarHidden to false if the persisted value is not a boolean", () => {
    const partial = { sidebarHidden: "yes" };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.sidebarHidden).toBe(false);
  });

  // AC-003 — behavior
  it("should default sidebarHidden to false if the key is absent", () => {
    const partial = { consoleHidden: true };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.sidebarHidden).toBe(false);
  });

  // AC-003 — behavior
  it("should pass a valid full settings object with sidebarHidden through unchanged", () => {
    const full: Settings = {
      version: 1,
      layouts: {},
      consoleHidden: false,
      sidebarHidden: true,
      shortcuts: {},
    };

    expect(mergeSettings(DEFAULT_SETTINGS, full)).toEqual(full);
  });
});
