import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS export-postman action (AC-013)", () => {
  // AC-013 - behavior: export-postman registered with the Mod+Alt+P default.
  it("should register export-postman with the Mod+Alt+P default", () => {
    const action = findAction("export-postman");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Alt+P");
  });

  // AC-013 - behavior: the action carries a non-empty name and description.
  it("should give export-postman a non-empty name and description", () => {
    const action = findAction("export-postman");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // AC-013 - behavior: the resolved defaults expose the binding with no overrides.
  it("should expose the export-postman default from resolveShortcuts", () => {
    const effective = resolveShortcuts({});

    expect(effective["export-postman"]).toEqual(["Mod+Alt+P"]);
  });
});
