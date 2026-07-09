import { describe, it, expect } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS curl actions (AC-001, AC-011)", () => {
  // AC-001 - behavior: copy-as-code registered with the Mod+Shift+C default
  // (inherited from the old copy-as-curl).
  it("should register copy-as-code with the Mod+Shift+C default", () => {
    const action = findAction("copy-as-code");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+C");
  });

  // AC-001 - behavior: copy-as-code carries the "Copy as code" display name.
  it("should name the copy action Copy as code", () => {
    const action = findAction("copy-as-code");

    expect(action).toBeDefined();
    expect(action!.name).toBe("Copy as code");
  });

  // AC-001 - behavior: the old copy-as-curl id/command no longer exists.
  it("should NOT register a copy-as-curl action anymore", () => {
    const action = findAction("copy-as-curl" as ShortcutActionId);

    expect(action).toBeUndefined();
  });

  // AC-011 - behavior: import-curl registered with Mod+Shift+I default.
  it("should register import-curl with the Mod+Shift+I default", () => {
    const action = findAction("import-curl");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Shift+I");
  });

  // AC-001, AC-011 - behavior: both actions carry a name and a description.
  it("should give each action a non-empty name and description", () => {
    const ids: ShortcutActionId[] = ["copy-as-code", "import-curl"];

    ids.forEach((id) => {
      const action = findAction(id);
      expect(action).toBeDefined();
      expect(action!.name.length).toBeGreaterThan(0);
      expect(action!.description.length).toBeGreaterThan(0);
    });
  });

  // AC-001, AC-011 - behavior: the resolved defaults expose both bindings with no
  // overrides.
  it("should expose the actions' defaults from resolveShortcuts", () => {
    const effective = resolveShortcuts({});

    expect(effective["copy-as-code"]).toBe("Mod+Shift+C");
    expect(effective["import-curl"]).toBe("Mod+Shift+I");
  });
});
