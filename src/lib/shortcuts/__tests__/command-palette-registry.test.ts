import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts, findConflict } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS open-command-palette", () => {
  // AC-001 — behavior
  it("should register open-command-palette with the Mod+K default", () => {
    const action = findAction("open-command-palette");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+K");
  });

  // AC-001 — behavior
  it("should give open-command-palette a non-empty name and description", () => {
    const action = findAction("open-command-palette");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });
});

describe("resolveShortcuts with open-command-palette", () => {
  // AC-001 — behavior
  it("should expose open-command-palette as Mod+K when no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["open-command-palette"]).toBe("Mod+K");
  });
});

describe("findConflict with open-command-palette", () => {
  // AC-008 — behavior
  it("should report open-command-palette as the owner if Mod+K is recorded for another action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+K", "toggle-console", effective);

    expect(owner).toBe("open-command-palette");
  });
});
