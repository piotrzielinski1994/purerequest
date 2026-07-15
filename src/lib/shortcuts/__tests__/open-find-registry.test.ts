import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts, findConflict } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS open-find", () => {
  // TC-005 (AC-001) — behavior: the action is registered so it appears in
  // Settings and the command palette like every other action.
  it("should register open-find with the Mod+F default", () => {
    const action = findAction("open-find");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+F");
  });

  // TC-005 (AC-001/AC-006) — behavior: the palette builds its command list from
  // the registry names, so a non-empty display name is what surfaces "Find".
  it("should give open-find a non-empty name and description", () => {
    const action = findAction("open-find");

    expect(action).toBeDefined();
    expect(action!.name.length).toBeGreaterThan(0);
    expect(action!.description.length).toBeGreaterThan(0);
  });

  // TC-005 (AC-001/AC-006) — behavior: the palette lists a command literally
  // named "Find"; that label is the registry action's name.
  it("should name the open-find action Find so the palette lists it", () => {
    const action = findAction("open-find");

    expect(action).toBeDefined();
    expect(action!.name).toBe("Find");
  });
});

describe("resolveShortcuts with open-find", () => {
  // TC-005 (AC-001) — behavior: an absent override resolves to the single default.
  it("should expose open-find as [Mod+F] if no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["open-find"]).toEqual(["Mod+F"]);
  });

  // TC-005 (AC-001) — behavior: it is rebindable like every other action.
  it("should honor an override for open-find", () => {
    const effective = resolveShortcuts({ "open-find": ["Mod+Shift+F"] });

    expect(effective["open-find"]).toEqual(["Mod+Shift+F"]);
  });
});

describe("findConflict with open-find", () => {
  // TC-005 (AC-001) — behavior: open-find owns Mod+F, so a conflict points back to it.
  it("should report open-find as the owner if Mod+F is recorded for another action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+F", "toggle-console", effective);

    expect(owner).toBe("open-find");
  });
});
