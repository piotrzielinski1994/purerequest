import { describe, expect, it } from "vitest";

import { cycleThemeMode } from "@/lib/theme/cycle-mode";

// Theme-toggle command: cycles light -> dark -> system -> light.
describe("cycleThemeMode", () => {
  // behavior
  it("should advance light to dark", () => {
    expect(cycleThemeMode("light")).toBe("dark");
  });

  // behavior
  it("should advance dark to system", () => {
    expect(cycleThemeMode("dark")).toBe("system");
  });

  // behavior
  it("should wrap system back to light", () => {
    expect(cycleThemeMode("system")).toBe("light");
  });
});
