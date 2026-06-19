import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { BodyEditor } from "@/components/workspace/body-editor";

// @uiw/react-codemirror injects its theme as global StyleModule rules into
// <style> tags in document.head. The built-in LIGHT theme (the default when no
// `theme` prop is given) sets a solid white editor-wrapper background via a bare
// generated class rule `.ͼN {background-color: #fff}`. The custom Darcula theme
// instead keeps the wrapper transparent, so that bare-class white rule must be
// absent. (We match the wrapper rule, not `.cm-*` helper rules like
// .cm-snippetField/.cm-textfield which legitimately carry whites unrelated to
// the editor background.)
function bareClassWhiteBackground(): boolean {
  const css = Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
  return css
    .split("}")
    .filter((rule) => !/\.cm-/.test(rule))
    .some((rule) =>
      /\{[^{]*background-color:\s*(#fff\b|#ffffff|white)\b/i.test(rule),
    );
}

describe("BodyEditor theme", () => {
  // AC-009 regression: a previous version dropped the `theme` prop, so the editor
  // fell back to the built-in light theme and rendered a white background that
  // overrode Darcula (the bug the user reported). theme="none" + a transparent
  // custom theme must leave no white editor-wrapper background.
  it("should not render a white editor background (Darcula, transparent wrapper)", () => {
    render(<BodyEditor value={'{ "a": 1 }'} onChange={() => {}} />);

    expect(bareClassWhiteBackground()).toBe(false);
  });
});
