import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts, findConflict } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS new actions", () => {
  // AC-007, TC-007 — behavior
  it("should register toggle-sidebar with the Mod+B default", () => {
    const action = findAction("toggle-sidebar");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+B");
  });

  // AC-007, TC-007 — behavior
  it("should register new-request with the Mod+T default", () => {
    const action = findAction("new-request");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+T");
  });

  // AC-007, TC-007 — behavior
  it("should register open-workspace with the Mod+O default", () => {
    const action = findAction("open-workspace");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+O");
  });

  // AC-007 — behavior
  it("should give each new action a non-empty name and description", () => {
    const ids: ShortcutActionId[] = [
      "toggle-sidebar",
      "new-request",
      "open-workspace",
    ];

    ids.forEach((id) => {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(action!.name.length).toBeGreaterThan(0);
      expect(action!.description.length).toBeGreaterThan(0);
    });
  });
});

describe("resolveShortcuts with new actions", () => {
  // AC-007, TC-007 — behavior
  it("should expose the new actions' defaults when no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["toggle-sidebar"]).toBe("Mod+B");
    expect(effective["new-request"]).toBe("Mod+T");
    expect(effective["open-workspace"]).toBe("Mod+O");
  });
});

describe("findConflict with new actions", () => {
  // AC-007, TC-007 — behavior
  it("should report toggle-sidebar as the owner if its binding is recorded for another action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+B", "new-request", effective);

    expect(owner).toBe("toggle-sidebar");
  });
});
