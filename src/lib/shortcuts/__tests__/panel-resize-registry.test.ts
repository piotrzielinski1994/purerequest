import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS panel resize actions", () => {
  // AC-001, TC-001 — behavior
  it("should register panel-expand with the Mod+Alt+= default", () => {
    const action = findAction("panel-expand");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Alt+=");
  });

  // AC-001, TC-001 — behavior
  it("should register panel-shrink with the Mod+Alt+- default", () => {
    const action = findAction("panel-shrink");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Alt+-");
  });

  // AC-006 — behavior: both actions carry a non-empty name + description so they
  // render in the palette and the Settings shortcuts list.
  it("should give each panel resize action a non-empty name and description", () => {
    const ids: ShortcutActionId[] = ["panel-expand", "panel-shrink"];

    ids.forEach((id) => {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(action!.name.length).toBeGreaterThan(0);
      expect(action!.description.length).toBeGreaterThan(0);
    });
  });
});

describe("resolveShortcuts with panel resize actions", () => {
  // AC-001, TC-001 — behavior
  it("should expose the panel resize defaults when no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["panel-expand"]).toEqual(["Mod+Alt+="]);
    expect(effective["panel-shrink"]).toEqual(["Mod+Alt+-"]);
  });
});
