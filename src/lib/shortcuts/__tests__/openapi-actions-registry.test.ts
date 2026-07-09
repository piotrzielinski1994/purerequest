import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS openapi action (AC-013)", () => {
  // AC-013 - behavior: import-openapi registered with the Mod+Shift+O default.
  it("should register import-openapi with the Mod+Shift+O default", () => {
    const action = findAction("import-openapi");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+O");
  });

  // AC-013 - behavior: the action carries a non-empty name and description.
  it("should give import-openapi a non-empty name and description", () => {
    const action = findAction("import-openapi");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // AC-013 - behavior: the resolved defaults expose the binding with no overrides.
  it("should expose the import-openapi default from resolveShortcuts", () => {
    const effective = resolveShortcuts({});

    expect(effective["import-openapi"]).toBe("Mod+Shift+O");
  });
});
