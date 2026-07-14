import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts, safeNormalize } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

const TREE_DEFAULTS: Array<[ShortcutActionId, string]> = [
  ["tree-nav-down", "ArrowDown"],
  ["tree-nav-up", "ArrowUp"],
  ["tree-nav-first", "Home"],
  ["tree-nav-last", "End"],
  ["tree-expand", "ArrowRight"],
  ["tree-collapse", "ArrowLeft"],
  ["tree-activate", "Enter"],
  ["tree-extend-down", "Shift+ArrowDown"],
  ["tree-extend-up", "Shift+ArrowUp"],
  ["tree-move-down", "Alt+ArrowDown"],
  ["tree-move-up", "Alt+ArrowUp"],
  ["tree-outdent", "Alt+ArrowLeft"],
  ["tree-nest", "Alt+ArrowRight"],
  ["open-context-menu", "Shift+F10"],
];

describe("SHORTCUT_ACTIONS tree/tab actions", () => {
  TREE_DEFAULTS.forEach(([id, hotkey]) => {
    it(`should register ${id} with the ${hotkey} default`, () => {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(action!.defaultHotkey).toBe(hotkey);
    });
  });

  it("should give every tree/tab action a non-empty name and description", () => {
    TREE_DEFAULTS.forEach(([id]) => {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(action!.name.length).toBeGreaterThan(0);
      expect(action!.description.length).toBeGreaterThan(0);
    });
  });

  it("should expose every tree/tab default when no overrides are given", () => {
    const effective = resolveShortcuts({});
    TREE_DEFAULTS.forEach(([id, hotkey]) => {
      expect(effective[id]).toEqual([hotkey]);
    });
  });

  it("should drop a bad tree override entry, leaving an empty list", () => {
    const effective = resolveShortcuts({ "tree-nav-down": [""] });
    expect(effective["tree-nav-down"]).toEqual([]);
  });

  it("should expose the tree default as a one-element list when no override", () => {
    const effective = resolveShortcuts({});
    expect(effective["tree-nav-down"]).toEqual(["ArrowDown"]);
  });
});

describe("safeNormalize accepts the ContextMenu key", () => {
  it("should accept a bare ContextMenu binding", () => {
    expect(safeNormalize("ContextMenu")).not.toBeNull();
  });

  it("should still reject a genuinely unknown key", () => {
    expect(safeNormalize("Bogus")).toBeNull();
  });
});
