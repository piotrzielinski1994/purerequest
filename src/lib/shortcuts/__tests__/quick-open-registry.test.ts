import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts, findConflict } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS open-quick-open", () => {
  // AC-001, TC-001 — behavior
  it("should register open-quick-open with the Mod+P default", () => {
    const action = findAction("open-quick-open");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+P");
  });

  // AC-001, TC-001 — behavior
  it("should give open-quick-open a non-empty name and description", () => {
    const action = findAction("open-quick-open");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });
});

describe("resolveShortcuts with open-quick-open", () => {
  // AC-001, TC-001 — behavior
  it("should expose open-quick-open as Mod+P when no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["open-quick-open"]).toEqual(["Mod+P"]);
  });
});

describe("findConflict with open-quick-open", () => {
  // AC-001, TC-001 — behavior
  it("should report open-quick-open as the owner if Mod+P is recorded for another action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+P", "toggle-console", effective);

    expect(owner).toBe("open-quick-open");
  });
});
