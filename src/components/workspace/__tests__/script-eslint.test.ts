import { javascript } from "@codemirror/lang-javascript";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

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

  it("should not flag the purerequest/console globals in any stage", () => {
    const view = viewOf("purerequest.setVar('a','1'); console.log('x');");

    expect(jsUndefLinter("pre")(view)).toEqual([]);
    expect(jsUndefLinter("post")(view)).toEqual([]);
  });

  // bru is the Bruno-compat alias - an imported collection's script using it
  // must not be flagged as an undefined global.
  it("should not flag the bru global in any stage", () => {
    const view = viewOf('bru.setVar("x", bru.getCollectionVar("CULTURE"));');

    expect(jsUndefLinter("pre")(view)).toEqual([]);
    expect(jsUndefLinter("post")(view)).toEqual([]);
  });

  // `req` is injected in BOTH stages (a post script reads the sent request via
  // req.getUrl()/getHeader()), so neither stage should flag it.
  it("should not flag req in either a pre or a post script", () => {
    const view = viewOf("req.getUrl();");

    expect(jsUndefLinter("pre")(view)).toEqual([]);
    expect(jsUndefLinter("post")(view)).toEqual([]);
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
    const view = viewOf(
      "await Promise.resolve(); purerequest.setVar('a','1');",
    );

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
