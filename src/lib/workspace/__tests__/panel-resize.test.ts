import { afterEach, describe, expect, it } from "vitest";
import type { PanelLayout } from "@/lib/settings/settings";
import {
  PANEL_RESIZE_STEP,
  type PanelResizeTarget,
  resolveFocusedPanel,
  stepLayout,
} from "@/lib/workspace/panel-resize";

// Build a real [data-panel id="<id>"] node with a focusable child, attached to
// the document so `resolveFocusedPanel` can walk `closest("[data-panel]")` from
// the child - mirroring how the handler reads `document.activeElement`.
function panelChild(id: string): HTMLElement {
  const panel = document.createElement("div");
  panel.setAttribute("data-panel", "");
  panel.id = id;
  const child = document.createElement("button");
  panel.appendChild(child);
  document.body.appendChild(panel);
  return child;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("PANEL_RESIZE_STEP", () => {
  // AC-002/003 — behavior: the step is a fixed 5% of the group.
  it("should be a 5% step", () => {
    expect(PANEL_RESIZE_STEP).toBe(5);
  });
});

describe("resolveFocusedPanel", () => {
  // AC-002, TC-002 — behavior: focus inside the sidebar panel maps to the
  // workspace group, sibling `content`, sidebar bounds 12-40.
  it("should resolve the workspace sidebar target if focus is inside the sidebar panel", () => {
    const child = panelChild("sidebar");

    expect(resolveFocusedPanel(child)).toEqual({
      group: "workspace",
      panelId: "sidebar",
      siblingId: "content",
      min: 12,
      max: 40,
    });
  });

  // AC-003, TC-004 — behavior: focus inside the console panel maps to the main
  // group, sibling `content`, console bounds 10-70 (content sibling min 30%).
  it("should resolve the main console target if focus is inside the console panel", () => {
    const child = panelChild("console");

    expect(resolveFocusedPanel(child)).toEqual({
      group: "main",
      panelId: "console",
      siblingId: "content",
      min: 10,
      max: 70,
    });
  });

  // AC-005, TC-007 — edge: the content panel is not a resize target.
  it("should return null if focus is inside the content panel", () => {
    const child = panelChild("content");

    expect(resolveFocusedPanel(child)).toBeNull();
  });

  // AC-005, TC-008 — edge: nothing focused (null) is a no-op target.
  it("should return null if the element is null", () => {
    expect(resolveFocusedPanel(null)).toBeNull();
  });

  // AC-005, TC-008 — edge: an element with no [data-panel] ancestor (e.g. body)
  // is not a resize target.
  it("should return null if the element has no data-panel ancestor", () => {
    const loose = document.createElement("div");
    document.body.appendChild(loose);

    expect(resolveFocusedPanel(loose)).toBeNull();
    expect(resolveFocusedPanel(document.body)).toBeNull();
  });
});

const sidebarTarget: PanelResizeTarget = {
  group: "workspace",
  panelId: "sidebar",
  siblingId: "content",
  min: 12,
  max: 40,
};

const consoleTarget: PanelResizeTarget = {
  group: "main",
  panelId: "console",
  siblingId: "content",
  min: 10,
  max: 70,
};

describe("stepLayout", () => {
  // AC-002, TC-002 — behavior: a positive delta grows the panel and shrinks the
  // sibling by the inverse, keeping the group summed to 100.
  it("should grow the panel and give the inverse delta to the sibling", () => {
    const layout: PanelLayout = { sidebar: 20, content: 80 };

    expect(stepLayout(layout, sidebarTarget, PANEL_RESIZE_STEP)).toEqual({
      sidebar: 25,
      content: 75,
    });
  });

  // AC-002, TC-003 — behavior: a negative delta shrinks the panel, sibling grows.
  it("should shrink the panel and give the inverse delta to the sibling", () => {
    const layout: PanelLayout = { sidebar: 20, content: 80 };

    expect(stepLayout(layout, sidebarTarget, -PANEL_RESIZE_STEP)).toEqual({
      sidebar: 15,
      content: 85,
    });
  });

  // AC-004, TC-005 — boundary: expanding near the max clamps at the max, applying
  // only the partial delta and inverting it on the sibling.
  it("should clamp the panel at its max bound", () => {
    const layout: PanelLayout = { sidebar: 38, content: 62 };

    expect(stepLayout(layout, sidebarTarget, PANEL_RESIZE_STEP)).toEqual({
      sidebar: 40,
      content: 60,
    });
  });

  // AC-004, TC-006 — boundary: shrinking near the min clamps at the min.
  it("should clamp the panel at its min bound", () => {
    const layout: PanelLayout = { sidebar: 14, content: 86 };

    expect(stepLayout(layout, sidebarTarget, -PANEL_RESIZE_STEP)).toEqual({
      sidebar: 12,
      content: 88,
    });
  });

  // AC-004 — boundary: the console min (10) clamps a shrink at the bound.
  it("should clamp the console panel at its min bound", () => {
    const layout: PanelLayout = { content: 88, console: 12 };

    expect(stepLayout(layout, consoleTarget, -PANEL_RESIZE_STEP)).toEqual({
      content: 90,
      console: 10,
    });
  });

  // AC-004, TC-005 — boundary: already at the max, a further expand is a no-op
  // that returns the layout unchanged.
  it("should return the layout unchanged if already at the max bound", () => {
    const layout: PanelLayout = { sidebar: 40, content: 60 };

    expect(stepLayout(layout, sidebarTarget, PANEL_RESIZE_STEP)).toEqual({
      sidebar: 40,
      content: 60,
    });
  });

  // AC-004, TC-006 — boundary: already at the min, a further shrink is a no-op.
  it("should return the layout unchanged if already at the min bound", () => {
    const layout: PanelLayout = { sidebar: 12, content: 88 };

    expect(stepLayout(layout, sidebarTarget, -PANEL_RESIZE_STEP)).toEqual({
      sidebar: 12,
      content: 88,
    });
  });

  // AC-002 — behavior: the input layout is never mutated (a frozen input must
  // survive the call and the result is a distinct object).
  it("should not mutate the input layout", () => {
    const layout: PanelLayout = Object.freeze({ sidebar: 20, content: 80 });

    const next = stepLayout(layout, sidebarTarget, PANEL_RESIZE_STEP);

    expect(layout).toEqual({ sidebar: 20, content: 80 });
    expect(next).not.toBe(layout);
  });
});
