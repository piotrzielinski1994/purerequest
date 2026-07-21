import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
  type ShortcutOverrides,
} from "@/lib/shortcuts/registry";
import {
  findConflict,
  resolveShortcuts,
  safeNormalize,
} from "@/lib/shortcuts/resolve";

const ACTION_IDS: ShortcutActionId[] = [
  "open-settings",
  "close-settings",
  "toggle-console",
  "toggle-sidebar",
  "toggle-theme",
  "next-request",
  "prev-request",
  "close-request",
  "close-other-requests",
  "close-all-requests",
  "new-request",
  "new-folder",
  "duplicate-node",
  "rename-node",
  "delete-node",
  "open-workspace",
  "send-request",
  "save-active-editor",
  "copy-as-code",
  "import-curl",
  "import-bruno",
  "import-postman",
  "import-openapi",
  "export-bruno",
  "export-postman",
  "export-openapi",
  "open-command-palette",
  "open-quick-open",
  "open-find",
  "collapse-all-folders",
  "expand-all-folders",
  "panel-expand",
  "panel-shrink",
  "tree-nav-down",
  "tree-nav-up",
  "tree-nav-first",
  "tree-nav-last",
  "tree-expand",
  "tree-collapse",
  "tree-activate",
  "tree-extend-down",
  "tree-extend-up",
  "tree-move-down",
  "tree-move-up",
  "tree-outdent",
  "tree-nest",
  "open-context-menu",
];

describe("SHORTCUT_ACTIONS registry", () => {
  // AC-001 — behavior
  it("should define every in-scope action exactly once", () => {
    const ids = SHORTCUT_ACTIONS.map((action) => action.id).sort();
    expect(ids).toEqual([...ACTION_IDS].sort());
  });

  // AC-001 — behavior
  it("should give every action a non-empty default hotkey", () => {
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(typeof action.defaultHotkey).toBe("string");
      expect(action.defaultHotkey.length).toBeGreaterThan(0);
    });
  });

  // AC-001 — behavior
  it("should give every action a non-empty display name", () => {
    SHORTCUT_ACTIONS.forEach((action) => {
      expect(typeof action.name).toBe("string");
      expect(action.name.length).toBeGreaterThan(0);
    });
  });
});

describe("safeNormalize", () => {
  // AC-007 — behavior
  it("should return a normalized string if the input is a valid hotkey", () => {
    expect(safeNormalize("Mod+J")).toBe("Mod+J");
  });

  // AC-007 — behavior
  it("should canonicalize a lower-case modifier+key into the uppercase form", () => {
    expect(safeNormalize("mod+j")).toBe("Mod+J");
  });

  // AC-007 — behavior
  it("should return null if the input is garbage", () => {
    expect(safeNormalize("not a hotkey!!")).toBeNull();
  });

  // AC-007 — behavior
  it("should return null if the input is an empty string", () => {
    expect(safeNormalize("")).toBeNull();
  });
});

describe("resolveShortcuts", () => {
  // AC-001 — behavior
  it("should return every action's registry default as a one-element list if no overrides are given", () => {
    const effective = resolveShortcuts({});

    SHORTCUT_ACTIONS.forEach((action) => {
      expect(effective[action.id]).toEqual([action.defaultHotkey]);
    });
  });

  // AC-002 — behavior
  it("should replace the registry default with a valid override list", () => {
    const overrides: ShortcutOverrides = { "toggle-console": ["Mod+K"] };

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual(["Mod+K"]);
  });

  // AC-007, E-2 — behavior
  it("should fall back to the default if an override value is not an array", () => {
    const overrides = {
      "toggle-console": 42,
    } as unknown as ShortcutOverrides;
    const def = SHORTCUT_ACTIONS.find(
      (a) => a.id === "toggle-console",
    )!.defaultHotkey;

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual([def]);
  });

  // AC-007, E-2 — behavior
  it("should drop an invalid hotkey entry from the override list", () => {
    const overrides: ShortcutOverrides = {
      "toggle-console": ["Mod+K", "bogus!!"],
    };

    const effective = resolveShortcuts(overrides);

    expect(effective["toggle-console"]).toEqual(["Mod+K"]);
  });

  // AC-007, E-3 — behavior
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

  // AC-007 — behavior
  it("should not throw on a corrupt overrides map", () => {
    const overrides = {
      "toggle-console": 42,
      bogus: "Mod+Q",
    } as unknown as ShortcutOverrides;

    expect(() => resolveShortcuts(overrides)).not.toThrow();
  });
});

describe("findConflict", () => {
  // AC-006 — behavior
  it("should return the owning action id if another action holds the hotkey", () => {
    const effective = resolveShortcuts({});
    const closeRequestKey = effective["close-request"][0];

    const owner = findConflict(closeRequestKey, "toggle-console", effective);

    expect(owner).toBe("close-request");
  });

  // AC-006 — behavior
  it("should match on normalized equality if the candidate differs only in casing", () => {
    const effective = resolveShortcuts({});
    const closeRequestKey = effective["close-request"][0];
    const lowered = closeRequestKey.toLowerCase();

    const owner = findConflict(lowered, "toggle-console", effective);

    expect(owner).toBe("close-request");
  });

  // AC-005 — behavior
  it("should return null if the hotkey is not owned by any other action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+Shift+Q", "toggle-console", effective);

    expect(owner).toBeNull();
  });

  // AC-006 — behavior
  it("should ignore the action being edited when checking for a conflict", () => {
    const effective = resolveShortcuts({});
    const ownKey = effective["toggle-console"][0];

    const owner = findConflict(ownKey, "toggle-console", effective);

    expect(owner).toBeNull();
  });
});
