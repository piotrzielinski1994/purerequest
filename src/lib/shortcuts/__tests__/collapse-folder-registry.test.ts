import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { findConflict, resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS collapse-folder / expand-folder", () => {
  // AC-002, AC-005, TC-008 - behavior: collapse-folder is registered with an
  // EMPTY default hotkey (no default key), a palette label "Collapse folder",
  // and a non-empty description.
  it("should register collapse-folder with an empty default hotkey", () => {
    const action = findAction("collapse-folder");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("");
    expect(action!.name).toBe("Collapse folder");
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // AC-002, AC-005, TC-008 - behavior: expand-folder is registered with an EMPTY
  // default hotkey, a palette label "Expand folder", and a non-empty description.
  it("should register expand-folder with an empty default hotkey", () => {
    const action = findAction("expand-folder");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("");
    expect(action!.name).toBe("Expand folder");
    expect(action!.description.length).toBeGreaterThan(0);
  });
});

describe("resolveShortcuts with collapse-folder / expand-folder", () => {
  // AC-005, TC-008 - behavior: both actions are user-rebindable through the
  // override mechanism like every other action.
  it("should honor an override for collapse-folder", () => {
    const effective = resolveShortcuts({ "collapse-folder": ["Mod+Shift+K"] });

    expect(effective["collapse-folder"]).toEqual(["Mod+Shift+K"]);
  });

  // AC-005, TC-008 - behavior: expand-folder is rebindable too.
  it("should honor an override for expand-folder", () => {
    const effective = resolveShortcuts({ "expand-folder": ["Mod+Shift+J"] });

    expect(effective["expand-folder"]).toEqual(["Mod+Shift+J"]);
  });
});

describe("findConflict with collapse-folder / expand-folder", () => {
  // AC-005, TC-008 - behavior: a rebound collapse-folder participates in conflict
  // detection, so the empty default does not silently shadow other bindings.
  it("should report collapse-folder as the owner if its rebound key is recorded for another action", () => {
    const effective = resolveShortcuts({ "collapse-folder": ["Mod+Shift+K"] });

    expect(findConflict("Mod+Shift+K", "expand-folder", effective)).toBe(
      "collapse-folder",
    );
  });
});
