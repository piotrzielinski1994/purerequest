import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS bruno action (AC-010)", () => {
  // AC-010 - behavior: import-bruno registered with the Mod+Shift+B default.
  it("should register import-bruno with the Mod+Shift+B default", () => {
    const action = findAction("import-bruno");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+B");
  });

  // AC-010 - behavior: the action carries a non-empty name and description.
  it("should give import-bruno a non-empty name and description", () => {
    const action = findAction("import-bruno");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // AC-010 - behavior: the resolved defaults expose the binding with no overrides.
  it("should expose the import-bruno default from resolveShortcuts", () => {
    const effective = resolveShortcuts({});

    expect(effective["import-bruno"]).toEqual(["Mod+Shift+B"]);
  });
});
