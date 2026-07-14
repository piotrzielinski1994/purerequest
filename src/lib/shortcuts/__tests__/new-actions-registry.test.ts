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

  it("should register close-all-requests with the Mod+Shift+W default", () => {
    const action = findAction("close-all-requests");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+W");
  });

  // behavior: a save action exists on Mod+S for the active editor.
  it("should register save-active-editor with the Mod+S default", () => {
    const action = findAction("save-active-editor");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+S");
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

    expect(effective["toggle-sidebar"]).toEqual(["Mod+B"]);
    expect(effective["new-request"]).toEqual(["Mod+T"]);
    expect(effective["open-workspace"]).toEqual(["Mod+O"]);
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
