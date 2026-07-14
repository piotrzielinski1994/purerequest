import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS postman action (AC-011)", () => {
  // AC-011 - behavior: import-postman registered with the Mod+Shift+P default.
  it("should register import-postman with the Mod+Shift+P default", () => {
    const action = findAction("import-postman");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+P");
  });

  // AC-011 - behavior: the action carries a non-empty name and description.
  it("should give import-postman a non-empty name and description", () => {
    const action = findAction("import-postman");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // AC-011 - behavior: the resolved defaults expose the binding with no overrides.
  it("should expose the import-postman default from resolveShortcuts", () => {
    const effective = resolveShortcuts({});

    expect(effective["import-postman"]).toEqual(["Mod+Shift+P"]);
  });
});
