import { describe, expect, it } from "vitest";

import { themeToggleMessage } from "@/lib/theme/toggle-message";

describe("themeToggleMessage", () => {
  // behavior
  it("should name the Light mode", () => {
    expect(themeToggleMessage("light", false)).toBe("Theme: Light");
  });

  // behavior
  it("should name the Dark mode", () => {
    expect(themeToggleMessage("dark", false)).toBe("Theme: Dark");
  });

  // behavior: system spells out the resolved scheme so the change is legible.
  it("should spell out the resolved scheme for system when the OS prefers dark", () => {
    expect(themeToggleMessage("system", true)).toBe("Theme: System (dark)");
  });

  it("should spell out the resolved scheme for system when the OS prefers light", () => {
    expect(themeToggleMessage("system", false)).toBe("Theme: System (light)");
  });
});
