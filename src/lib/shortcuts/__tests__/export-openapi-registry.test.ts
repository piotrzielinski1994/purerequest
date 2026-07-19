import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS export-openapi action (AC-012)", () => {
  // AC-012 - behavior: export-openapi registered with the Mod+Alt+O default.
  it("should register export-openapi with the Mod+Alt+O default", () => {
    const action = findAction("export-openapi");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Alt+O");
  });

  // AC-012 - behavior: the action carries a non-empty name and description.
  it("should give export-openapi a non-empty name and description", () => {
    const action = findAction("export-openapi");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // AC-012 - behavior: the resolved defaults expose the binding with no overrides.
  it("should expose the export-openapi default from resolveShortcuts", () => {
    const effective = resolveShortcuts({});

    expect(effective["export-openapi"]).toEqual(["Mod+Alt+O"]);
  });
});
