import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { BodyEditor } from "@/components/workspace/body-editor";
import { JsonViewer } from "@/components/workspace/json-viewer";

const NESTED = '{\n  "a": {\n    "b": 1\n  }\n}';

// @uiw/react-codemirror injects its theme as global StyleModule rules into
// <style> tags in document.head. We assert the injected CSS hides the fold
// markers (opacity 0) rather than computed style, which jsdom does not resolve
// from StyleModule rules.
function foldMarkersHidden(): boolean {
  const css = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  return css
    .split("}")
    .some(
      (rule) => /\.cm-foldGutter/.test(rule) && /opacity:\s*0\b/.test(rule),
    );
}

describe("editor gutter consistency (request body vs response)", () => {
  // behavior (#1): both surfaces carry the SAME gutters - a fold gutter and no
  // lint gutter - so their content starts at the same horizontal offset.
  it("should give the body editor and the response viewer the same gutters", () => {
    const body = render(<BodyEditor value={NESTED} onChange={() => {}} />);
    expect(body.container.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(body.container.querySelector(".cm-gutter-lint")).toBeNull();
    body.unmount();

    const viewer = render(<JsonViewer text={NESTED} />);
    expect(viewer.container.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(viewer.container.querySelector(".cm-gutter-lint")).toBeNull();
  });

  // behavior (#2): the fold arrows are hidden (opacity 0) but the gutter element
  // stays in the DOM so it remains clickable.
  it("should hide the fold markers while keeping the fold gutter present", () => {
    const { container } = render(<JsonViewer text={NESTED} />);

    expect(container.querySelector(".cm-foldGutter")).not.toBeNull();
    expect(foldMarkersHidden()).toBe(true);
  });
});
