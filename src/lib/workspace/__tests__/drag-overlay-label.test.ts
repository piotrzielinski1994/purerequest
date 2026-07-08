import { describe, it, expect } from "vitest";

import { dragOverlayLabel } from "@/lib/workspace/drag-overlay-label";

describe("dragOverlayLabel", () => {
  // behavior: dragging a row that is part of a multi-selection shows the count.
  it("should show the selection count if the dragged row is in a multi-selection", () => {
    expect(dragOverlayLabel("a", "alpha", new Set(["a", "b", "c"]))).toBe(
      "3 items",
    );
  });

  // behavior: dragging a selected row in a 2-item selection still pluralizes.
  it("should show the count for a two-item selection", () => {
    expect(dragOverlayLabel("a", "alpha", new Set(["a", "b"]))).toBe("2 items");
  });

  // behavior: a lone selected row shows its name, not "1 items".
  it("should show the node name if the dragged row is the only selected one", () => {
    expect(dragOverlayLabel("a", "alpha", new Set(["a"]))).toBe("alpha");
  });

  // behavior: dragging an UNselected row (even with others selected) shows its name.
  it("should show the node name if the dragged row is not part of the selection", () => {
    expect(dragOverlayLabel("z", "zeta", new Set(["a", "b"]))).toBe("zeta");
  });

  // behavior: no selection -> the node name.
  it("should show the node name if nothing is selected", () => {
    expect(dragOverlayLabel("a", "alpha", new Set())).toBe("alpha");
  });
});
