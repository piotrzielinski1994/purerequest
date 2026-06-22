import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";

import { jsUndefLinter } from "@/components/workspace/script-eslint";

function viewOf(doc: string): EditorView {
  const state = EditorState.create({ doc, extensions: [javascript()] });
  return new EditorView({ state });
}

describe("jsUndefLinter", () => {
  it("should flag an assignment to an undeclared variable", () => {
    const view = viewOf("csd = 2;");

    const diagnostics = jsUndefLinter("pre")(view);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].message).toContain("csd");
    expect(diagnostics[0].severity).toBe("error");
  });

  it("should flag a call to an undefined function", () => {
    const view = viewOf("nope();");

    expect(jsUndefLinter("pre")(view).length).toBeGreaterThan(0);
  });

  it("should not flag the requi/console globals in any stage", () => {
    const view = viewOf("requi.setVar('a','1'); console.log('x');");

    expect(jsUndefLinter("pre")(view)).toEqual([]);
    expect(jsUndefLinter("post")(view)).toEqual([]);
  });

  it("should not flag req in a pre script but should flag it in a post script", () => {
    const view = viewOf("req.setUrl('x');");

    expect(jsUndefLinter("pre")(view)).toEqual([]);
    expect(jsUndefLinter("post")(view).length).toBeGreaterThan(0);
  });

  it("should not flag res in a post script but should flag it in a pre script", () => {
    const view = viewOf("res.getStatus();");

    expect(jsUndefLinter("post")(view)).toEqual([]);
    expect(jsUndefLinter("pre")(view).length).toBeGreaterThan(0);
  });

  it("should not flag standard ES builtins", () => {
    const view = viewOf(
      "JSON.stringify({}); Math.max(1,2); const p = Promise.resolve(); String(1);",
    );

    expect(jsUndefLinter("pre")(view)).toEqual([]);
  });

  it("should support async/await syntax without a parse error", () => {
    const view = viewOf("await Promise.resolve(); requi.setVar('a','1');");

    expect(jsUndefLinter("pre")(view)).toEqual([]);
  });

  it("should return no diagnostics for an empty document", () => {
    const view = viewOf("  \n ");

    expect(jsUndefLinter("pre")(view)).toEqual([]);
  });

  it("should map a diagnostic to a valid range within the doc", () => {
    const view = viewOf("csd = 2;");

    const [d] = jsUndefLinter("pre")(view);

    expect(d.from).toBeGreaterThanOrEqual(0);
    expect(d.to).toBeLessThanOrEqual(view.state.doc.length);
    expect(d.from).toBeLessThan(d.to);
  });
});
