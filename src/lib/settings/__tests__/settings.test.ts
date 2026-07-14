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
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: { mode: "system", colors: DEFAULT_SETTINGS.theme.colors },
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
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: { mode: "system", colors: DEFAULT_SETTINGS.theme.colors },
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

describe("mergeSettings open tabs", () => {
  it("should default openRequestIds to empty and activeRequestId to null if absent", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { consoleHidden: true });

    expect(merged.openRequestIds).toEqual([]);
    expect(merged.activeRequestId).toBeNull();
  });

  it("should keep a valid openRequestIds list and active id", () => {
    const partial = {
      openRequestIds: ["req-a", "req-b"],
      activeRequestId: "req-b",
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.openRequestIds).toEqual(["req-a", "req-b"]);
    expect(merged.activeRequestId).toBe("req-b");
  });

  it("should drop non-string entries from openRequestIds", () => {
    const partial = { openRequestIds: ["req-a", 42, null, "req-b"] };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.openRequestIds).toEqual(["req-a", "req-b"]);
  });

  it("should null the activeRequestId if it is not among the open ids", () => {
    const partial = {
      openRequestIds: ["req-a"],
      activeRequestId: "req-gone",
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.activeRequestId).toBeNull();
  });

  it("should yield an empty list if openRequestIds is not an array", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { openRequestIds: "nope" });

    expect(merged.openRequestIds).toEqual([]);
    expect(merged.activeRequestId).toBeNull();
  });

  it("should not throw if the open-tab fields are garbage", () => {
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, {
        openRequestIds: 42,
        activeRequestId: [],
      }),
    ).not.toThrow();
  });
});

describe("mergeSettings draft tabs", () => {
  const draft = {
    id: "new-1",
    request: {
      kind: "request",
      id: "new-1",
      name: "untitled",
      method: "GET",
      url: "https://example.test/x",
      body: { active: "json", types: { json: "", form: [], multipart: [], graphql: { query: "", variables: "" } } },
      params: { path: [], query: [] },
      config: {},
    },
    placement: { parentId: null, index: 0 },
  };

  it("should default draftTabs to an empty list if absent", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, {}).draftTabs).toEqual([]);
  });

  it("should keep a well-formed draft tab across a merge (restart round-trip)", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, { draftTabs: [draft] });

    expect(merged.draftTabs).toEqual([draft]);
  });

  it("should keep a draft id as the active id even when it is not an open on-disk request", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      draftTabs: [draft],
      openRequestIds: ["new-1"],
      activeRequestId: "new-1",
    });

    expect(merged.activeRequestId).toBe("new-1");
  });

  it("should drop malformed draft entries", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      draftTabs: [
        draft,
        { id: "bad" },
        { id: "no-placement", request: draft.request },
        42,
        null,
      ],
    });

    expect(merged.draftTabs).toEqual([draft]);
  });

  it("should yield an empty list if draftTabs is not an array", () => {
    expect(mergeSettings(DEFAULT_SETTINGS, { draftTabs: "nope" }).draftTabs).toEqual(
      [],
    );
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

  // AC-007, E-3 — behavior: a legacy single-string override migrates to a list.
  it("should migrate a legacy string override into a one-element list", () => {
    const partial = { shortcuts: { "toggle-console": "Mod+K" } };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).toEqual({ "toggle-console": ["Mod+K"] });
  });

  // AC-007 — behavior
  it("should keep a valid shortcuts override list", () => {
    const partial = { shortcuts: { "toggle-console": ["Mod+K", "Mod+G"] } };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).toEqual({ "toggle-console": ["Mod+K", "Mod+G"] });
  });

  // AC-007, E-2 — behavior
  it("should drop a non-string, non-array shortcut value", () => {
    const partial = {
      shortcuts: { "toggle-console": 42, "close-request": ["Mod+W"] },
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).not.toHaveProperty("toggle-console");
    expect(merged.shortcuts["close-request"]).toEqual(["Mod+W"]);
  });

  // AC-007, E-2 — behavior
  it("should drop an invalid hotkey entry from the list", () => {
    const partial = {
      shortcuts: { "toggle-console": ["bogus!!"], "close-request": ["Mod+W"] },
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts["toggle-console"]).toEqual([]);
    expect(merged.shortcuts["close-request"]).toEqual(["Mod+W"]);
  });

  // AC-007, E-3 — behavior
  it("should drop an override for an unknown action id", () => {
    const partial = {
      shortcuts: { bogus: ["Mod+Q"], "toggle-console": ["Mod+K"] },
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, partial);

    expect(merged.shortcuts).not.toHaveProperty("bogus");
    expect(merged.shortcuts["toggle-console"]).toEqual(["Mod+K"]);
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
    expect(
      mergeSettings(DEFAULT_SETTINGS, { shortcuts: "nope" }).shortcuts,
    ).toEqual({});
  });

  // AC-001 — behavior
  it("should reference a real registry default for the toggle-console action", () => {
    expect(typeof toggleConsoleDefault).toBe("string");
    expect(toggleConsoleDefault.length).toBeGreaterThan(0);
  });
});
