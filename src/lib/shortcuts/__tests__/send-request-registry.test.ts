import { describe, expect, it } from "vitest";

import {
  SHORTCUT_ACTIONS,
  type ShortcutActionId,
} from "@/lib/shortcuts/registry";
import { findConflict, resolveShortcuts } from "@/lib/shortcuts/resolve";

function findAction(id: ShortcutActionId) {
  return SHORTCUT_ACTIONS.find((action) => action.id === id);
}

describe("SHORTCUT_ACTIONS send-request", () => {
  // AC-008 — behavior
  it("should register send-request with the Mod+Enter default", () => {
    const action = findAction("send-request");

    expect(action).toBeDefined();
    expect(action!.defaultHotkey).toBe("Mod+Enter");
  });

  // AC-008 — behavior
  it("should name send-request 'Send request'", () => {
    const action = findAction("send-request");

    expect(action).toBeDefined();
    expect(action!.name).toBe("Send request");
  });

  // AC-008 — behavior
  it("should give send-request a non-empty description", () => {
    const action = findAction("send-request");

    expect(action).toBeDefined();
    expect(action!.description.length).toBeGreaterThan(0);
  });
});

describe("resolveShortcuts with send-request", () => {
  // AC-008 — behavior
  it("should expose send-request as Mod+Enter when no overrides are given", () => {
    const effective = resolveShortcuts({});

    expect(effective["send-request"]).toEqual(["Mod+Enter"]);
  });
});

describe("findConflict with send-request", () => {
  // AC-008 — behavior
  it("should report send-request as the owner if Mod+Enter is recorded for another action", () => {
    const effective = resolveShortcuts({});

    const owner = findConflict("Mod+Enter", "new-request", effective);

    expect(owner).toBe("send-request");
  });
});
