import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts, findConflict } from "@/lib/shortcuts/resolve";

const CLOSE_REQUEST = SHORTCUT_ACTIONS.find((a) => a.id === "close-request")!;
const TOGGLE_CONSOLE = SHORTCUT_ACTIONS.find((a) => a.id === "toggle-console")!;

describe("resolveShortcuts (array model)", () => {
  // AC-001, TC-001 — behavior
  it("should resolve every action to a single-element list of its default if no overrides are given", () => {
    const effective = resolveShortcuts({});

    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });

  // AC-002 — behavior
  it("should resolve a multi-binding override to every normalized hotkey", () => {
    const overrides: ShortcutOverrides = {
      "toggle-console": ["Mod+J", "Mod+K"],
    };

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual(["Mod+J", "Mod+K"]);
  });

  // AC-002 — behavior: entries are canonicalized (casing/aliases) like the single model was.
  it("should normalize each entry in a multi-binding override", () => {
    const overrides: ShortcutOverrides = {
      "toggle-console": ["mod+j", "mod+k"],
    };

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual(["Mod+J", "Mod+K"]);
  });

  // AC-004, TC-004 — behavior
  it("should resolve an empty-array override to an empty list (disabled)", () => {
    const overrides: ShortcutOverrides = { "toggle-console": [] };

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual([]);
  });

  // AC-007 — behavior
  it("should drop invalid individual entries and keep the valid ones", () => {
    const overrides: ShortcutOverrides = {
      "toggle-console": ["Mod+J", "bogus!!"],
    };

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual(["Mod+J"]);
  });

  // AC-007 — behavior: a non-array override value is ignored -> default.
  it("should fall back to the default list if an override value is not an array", () => {
    const overrides = {
      "toggle-console": "Mod+J",
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual([TOGGLE_CONSOLE.defaultHotkey]);
  });

  // AC-007 — behavior: every-entry-invalid list collapses to empty (no valid binding survives).
  it("should resolve to an empty list if every entry in the override is invalid", () => {
    const overrides: ShortcutOverrides = {
      "toggle-console": ["bogus!!", "also bad!!"],
    };

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual([]);
  });

  // AC-007 — behavior
  it("should ignore an override for an unknown action id and keep all defaults", () => {
    const overrides = {
      bogus: ["Mod+Q"],
    } as unknown as ShortcutOverrides;

    const effective = resolveShortcuts(overrides);

    expect(effective).not.toHaveProperty("bogus");
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });
});

describe("findConflict (array model)", () => {
  // AC-006, TC-006 — behavior: the first (default) binding of another action is a conflict.
  it("should return the owning action id if another action's default holds the hotkey", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict(
      effective["close-request"][0],
      "toggle-console",
      effective,
    );

    expect(owner).toBe("close-request");
  });

  // AC-006 — behavior: a match against a NON-first entry proves the search scans the
  // whole list, not just the first binding (also covers casing-insensitive input).
  it("should detect a conflict from any binding in another action's multi-binding list", () => {
    const effective = resolveShortcuts({
      "close-request": ["Mod+W", "Mod+Shift+Q"],
    });

    const owner = findConflict("mod+shift+q", "toggle-console", effective);

    expect(owner).toBe("close-request");
  });

  // AC-006, E-7, TC-006 — behavior: the edited action is excluded even when the hotkey
  // sits in its own (multi-binding) list. The toContain guard also pins that the list
  // actually resolved to the array form.
  it("should return null if the hotkey is only in the edited action's own list", () => {
    const effective = resolveShortcuts({
      "toggle-console": ["Mod+J", "Mod+Shift+Q"],
    });

    expect(effective["toggle-console"]).toContain("Mod+Shift+Q");
    expect(findConflict("Mod+Shift+Q", "toggle-console", effective)).toBeNull();
  });

  // E-2 — behavior: a disabled action ([]) is never reported as an owner.
  it("should not report a disabled action as a conflict owner", () => {
    const effective = resolveShortcuts({ "close-request": [] });

    const owner = findConflict(
      CLOSE_REQUEST.defaultHotkey,
      "toggle-console",
      effective,
    );

    expect(owner).toBeNull();
  });
});
