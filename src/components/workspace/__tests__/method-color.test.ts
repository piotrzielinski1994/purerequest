import { describe, expect, it } from "vitest";

import { METHOD_COLOR } from "@/components/workspace/method-color";

describe("METHOD_COLOR (AC-003)", () => {
  // AC-003 - behavior: QUERY renders with a distinct teal badge color.
  it("should map QUERY to a teal color class", () => {
    expect(METHOD_COLOR.QUERY).toContain("teal");
  });

  // AC-003 - behavior: the existing per-method colors are unchanged.
  it("should keep GET green and POST amber", () => {
    expect(METHOD_COLOR.GET).toContain("green");
    expect(METHOD_COLOR.POST).toContain("amber");
  });
});
