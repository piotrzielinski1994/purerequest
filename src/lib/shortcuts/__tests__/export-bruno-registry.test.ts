import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS export-bruno action (AC-012)", () => {
  // AC-012 - behavior: export-bruno registered with the Mod+Shift+E default.
  it("should register export-bruno with the Mod+Shift+E default", () => {
    const action = findAction("export-bruno");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+E");
  });

  // AC-012 - behavior: the action carries a non-empty name and description.
  it("should give export-bruno a non-empty name and description", () => {
    const action = findAction("export-bruno");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // AC-012 - behavior: the resolved defaults expose the binding with no overrides.
  it("should expose the export-bruno default from resolveShortcuts", () => {
    const effective = resolveShortcuts({});

    expect(effective["export-bruno"]).toEqual(["Mod+Shift+E"]);
  });
});
