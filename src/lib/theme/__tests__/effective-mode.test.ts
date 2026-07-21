import { describe, expect, it } from "vitest";

import { resolveEffectiveMode } from "@/lib/theme/effective-mode";

// Stage 1 — Themes feature. Pure resolution of mode -> concrete effective mode.
// The "effective mode" is what actually gets applied to the DOM (.dark or not):
// equal to the chosen mode unless the mode is "system", in which case it is
// derived from the OS prefers-color-scheme flag.

describe("resolveEffectiveMode", () => {
  // AC-001 — behavior
  it("should resolve light to light regardless of prefersDark", () => {
    expect(resolveEffectiveMode("light", true)).toBe("light");
    expect(resolveEffectiveMode("light", false)).toBe("light");
  });

  // AC-002 — behavior
  it("should resolve dark to dark regardless of prefersDark", () => {
    expect(resolveEffectiveMode("dark", true)).toBe("dark");
    expect(resolveEffectiveMode("dark", false)).toBe("dark");
  });

  // AC-003 — behavior
  it("should resolve system to dark if the OS prefers dark", () => {
    expect(resolveEffectiveMode("system", true)).toBe("dark");
  });

  // AC-003 — behavior
  it("should resolve system to light if the OS does not prefer dark", () => {
    expect(resolveEffectiveMode("system", false)).toBe("light");
  });
});
