import { describe, it, expect } from "vitest";

import {
  DEFAULT_SETTINGS,
  mergeSettings,
  type Settings,
} from "@/lib/settings/settings";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";

describe("mergeSettings", () => {
  // AC-005 — behavior
  it("should pass a valid full settings object through unchanged", () => {
    const full: Settings = {
      version: 1,
      layouts: { workspace: { sidebar: 30, content: 70 } },
      consoleHidden: true,
      sidebarHidden: false,
      shortcuts: {},
    };

    expect(mergeSettings(DEFAULT_SETTINGS, full)).toEqual(full);
  });

  // AC-005, E-3 — behavior
  it("should fill missing keys from defaults if the partial omits them", () => {
    const partial = { consoleHidden: true };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.consoleHidden).toBe(true);
    expect(merged.version).toBe(DEFAULT_SETTINGS.version);
    expect(merged.layouts).toEqual(DEFAULT_SETTINGS.layouts);
  });

  // AC-005, E-3 — behavior
  it("should honor a nested layouts partial if only one group is present", () => {
    const partial = { layouts: { main: { content: 60, console: 40 } } };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.layouts.main).toEqual({ content: 60, console: 40 });
    expect(merged.consoleHidden).toBe(DEFAULT_SETTINGS.consoleHidden);
  });

  // AC-005, E-3 — behavior
  it("should drop unknown extra keys if the partial carries them", () => {
    const partial = { consoleHidden: true, bogus: "nope", extra: 42 };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged).toEqual({
      version: 1,
      layouts: {},
      consoleHidden: true,
      sidebarHidden: false,
      shortcuts: {},
    });
    expect(merged).not.toHaveProperty("bogus");
    expect(merged).not.toHaveProperty("extra");
  });

  // AC-005, E-2 — behavior
  it("should return defaults if the partial is null", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, null)).toEqual(DEFAULT_SETTINGS);
  });

  // AC-005, E-2 — behavior
  it("should return defaults if the partial is undefined", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, undefined)).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  // AC-005, E-2 — behavior
  it("should return defaults if the partial is a string", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, "garbage")).toEqual(
      DEFAULT_SETTINGS,
    );
  });

  // AC-005, E-2 — behavior
  it("should return defaults if the partial is a number", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, 123)).toEqual(DEFAULT_SETTINGS);
  });

  // AC-005, E-2 — behavior
  it("should not throw if the partial is garbage", () => {
    expect(() => mergeSettings(DEFAULT_SETTINGS, [])).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, true)).not.toThrow();
    expect(() => mergeSettings(DEFAULT_SETTINGS, null)).not.toThrow();
  });
});

describe("mergeSettings shortcuts", () => {
  const toggleConsoleDefault = SHORTCUT_ACTIONS.find(
    (a) => a.id === "toggle-console",
  )!.defaultHotkey;

  // AC-001, E-1 — behavior
  it("should default shortcuts to an empty map if the key is absent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { consoleHidden: true });

    expect(merged.shortcuts).toEqual({});
  });

  // AC-003 — behavior
  it("should keep a valid shortcuts override map", () => {
    const partial = { shortcuts: { "toggle-console": "Mod+K" } };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).toEqual({ "toggle-console": "Mod+K" });
  });

  // AC-007, E-2 — behavior
  it("should drop a non-string shortcut value", () => {
    const partial = {
      shortcuts: { "toggle-console": 42, "close-request": "Mod+W" },
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).not.toHaveProperty("toggle-console");
    expect(merged.shortcuts["close-request"]).toBe("Mod+W");
  });

  // AC-007, E-2 — behavior
  it("should drop an invalid hotkey string", () => {
    const partial = {
      shortcuts: { "toggle-console": "bogus!!", "close-request": "Mod+W" },
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).not.toHaveProperty("toggle-console");
    expect(merged.shortcuts["close-request"]).toBe("Mod+W");
  });

  // AC-007, E-3 — behavior
  it("should drop an override for an unknown action id", () => {
    const partial = {
      shortcuts: { bogus: "Mod+Q", "toggle-console": "Mod+K" },
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).not.toHaveProperty("bogus");
    expect(merged.shortcuts["toggle-console"]).toBe("Mod+K");
  });

  // AC-007 — behavior
  it("should not throw if the persisted shortcuts map is garbage", () => {
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { shortcuts: "nope" }),
    ).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { shortcuts: 42 }),
    ).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, {
        shortcuts: { "toggle-console": null, bogus: [] },
      }),
    ).not.toThrow();
  });

  // AC-007 — behavior
  it("should yield an empty shortcuts map if the persisted value is not an object", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { shortcuts: "nope" }).shortcuts).toEqual(
      {},
    );
  });

  // AC-001 — behavior
  it("should reference a real registry default for the toggle-console action", () => {
    expect(typeof toggleConsoleDefault).toBe("string");
    expect(toggleConsoleDefault.length).toBeGreaterThan(0);
  });
});
