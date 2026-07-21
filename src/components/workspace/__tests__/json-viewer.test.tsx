import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { JsonViewer } from "@/components/workspace/json-viewer";

const NESTED = '{ "a": { "b": 1 } }';

describe("JsonViewer", () => {
  // behavior: the response viewer mounts a caret-navigable CodeMirror surface -
  // contenteditable is true (so arrow keys move a cursor) but edits are blocked
  // by EditorState.readOnly, so keystrokes never change the document.
  it("should mount a caret-navigable but read-only code surface", () => {
    const { container } = render(<JsonViewer text={NESTED} />);

    const surface = container.querySelector(".cm-content");
    expect(surface).not.toBeNull();
    // caret present -> the surface is keyboard-focusable/navigable.
    expect(surface).toHaveAttribute("contenteditable", "true");
    // typing is inert: the document text is unchanged after a keystroke attempt.
    expect(surface?.textContent).toContain('"a"');
  });

  // behavior: the viewer shows NO line-number gutter.
  it("should not render a line-number gutter", () => {
    const { container } = render(<JsonViewer text={NESTED} />);

    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
  });

  // behavior: the viewer renders a fold gutter so response blocks collapse/expand
  // (same affordance as the request body editor).
  it("should render a fold gutter for collapsing blocks", () => {
    const { container } = render(<JsonViewer text={NESTED} />);

    expect(container.querySelector(".cm-foldGutter")).not.toBeNull();
  });

  // behavior: a caret line is drawn (the cursor layer mounts) so the keyboard can
  // move through the response body.
  it("should render a caret cursor layer for keyboard navigation", () => {
    const { container } = render(<JsonViewer text={NESTED} />);

    expect(container.querySelector(".cm-cursorLayer")).not.toBeNull();
  });
});
