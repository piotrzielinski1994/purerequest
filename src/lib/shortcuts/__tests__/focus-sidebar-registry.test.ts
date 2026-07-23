import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS focus-sidebar actions", () => {
  it("should register focus-sidebar with the Mod+E default", () => {
    const action = findAction("focus-sidebar");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+E");
  });

  it("should register focus-toggle-sidebar with the Mod+0 default", () => {
    const action = findAction("focus-toggle-sidebar");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+0");
  });

  it("should give each focus action a non-empty name and description", () => {
    const ids: ShortcutActionId[] = ["focus-sidebar", "focus-toggle-sidebar"];

    ids.forEach((id) => {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(action!.name.length).toBeGreaterThan(0);
      expect(action!.description.length).toBeGreaterThan(0);
    });
  });

  it("should expose the focus actions' defaults when no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["focus-sidebar"]).toEqual(["Mod+E"]);
    expect(effective["focus-toggle-sidebar"]).toEqual(["Mod+0"]);
  });
});
