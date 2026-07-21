import { describe, expect, it } from "vitest";

// Imported before it exists: the suite must fail RED on the missing module, not
// on a typo. Once to-codemirror-key.ts ships these assertions pin the bridge.
import { toCodeMirrorKey } from "@/lib/shortcuts/to-codemirror-key";

describe("toCodeMirrorKey", () => {
  // TC-007 (AC-001) — behavior: a single trailing alphabetic key lower-cases.
  it("should convert Mod+F to the lower-cased CodeMirror key Mod-f", () => {
    expect(toCodeMirrorKey("Mod+F")).toBe("Mod-f");
  });

  // TC-007 (AC-001) — behavior: modifiers join with - and the trailing key lower-cases.
  it("should convert Mod+Shift+F to Mod-Shift-f", () => {
    expect(toCodeMirrorKey("Mod+Shift+F")).toBe("Mod-Shift-f");
  });

  // TC-007 (AC-001) — behavior: a bare named key is kept verbatim.
  it("should keep the named key Enter unchanged", () => {
    expect(toCodeMirrorKey("Enter")).toBe("Enter");
  });

  // TC-007 (AC-001) — behavior: an invalid hotkey returns null.
  it("should return null if the hotkey is invalid", () => {
    expect(toCodeMirrorKey("###")).toBeNull();
  });
});
