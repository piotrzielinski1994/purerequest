import { describe, it, expect } from "vitest";

import { mergeSettings, DEFAULT_SETTINGS } from "@/lib/settings/settings";

// The array migration lives in mergeShortcuts, which is private; exercise it
// through the public mergeSettings entry and read the merged `.shortcuts`.
function mergedShortcuts(shortcuts: unknown) {
  return mergeSettings(DEFAULT_SETTINGS, { shortcuts }).shortcuts;
}

describe("mergeSettings shortcuts migration (array model)", () => {
  // AC-007, E-3, TC-007 — behavior: a legacy single-string override reads as a one-element list.
  it("should migrate a legacy string override to a one-element list", () => {
    const result = mergedShortcuts({ "toggle-console": "Mod+B" });

    expect(result["toggle-console"]).toEqual(["Mod+B"]);
  });

  // AC-007, TC-007 — behavior: an array with a bad entry keeps only the valid ones.
  it("should drop invalid entries from an array override", () => {
    const result = mergedShortcuts({ "toggle-console": ["Mod+B", "bogus!!"] });

    expect(result["toggle-console"]).toEqual(["Mod+B"]);
  });

  // AC-007 — behavior: legacy string is normalized (casing/aliases) on migration.
  it("should normalize a legacy string override on migration", () => {
    const result = mergedShortcuts({ "toggle-console": "mod+b" });

    expect(result["toggle-console"]).toEqual(["Mod+B"]);
  });

  // AC-007, TC-007 — behavior: a non-array / non-string value is dropped, while a
  // sibling migrated entry survives (the surviving array pins the array model).
  it("should drop a key whose value is neither string nor array but keep a valid sibling", () => {
    const result = mergedShortcuts({
      "toggle-console": "Mod+B",
      "toggle-sidebar": 42,
    });

    expect(result["toggle-console"]).toEqual(["Mod+B"]);
    expect(result).not.toHaveProperty("toggle-sidebar");
  });

  // AC-004, AC-007, TC-007 — behavior: an empty array persists as disabled.
  it("should keep an empty-array override as an empty list (disabled persists)", () => {
    const result = mergedShortcuts({ "toggle-console": [] });

    expect(result["toggle-console"]).toEqual([]);
  });

  // AC-007 — behavior: an unknown action id is ignored, while a valid array entry survives.
  it("should ignore an unknown action id but keep a valid array override", () => {
    const result = mergedShortcuts({
      "toggle-console": ["Mod+B"],
      bogus: ["Mod+Q"],
    });

    expect(result["toggle-console"]).toEqual(["Mod+B"]);
    expect(result).not.toHaveProperty("bogus");
  });

  // AC-007 — behavior: an all-invalid array collapses to empty rather than being dropped.
  it("should keep the key as an empty list if every entry in the array is invalid", () => {
    const result = mergedShortcuts({ "toggle-console": ["bogus!!"] });

    expect(result["toggle-console"]).toEqual([]);
  });
});
