import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { javascript } from "@codemirror/lang-javascript";

import { jsSyntaxLinter } from "@/components/workspace/script-lint";

function viewOf(doc: string): EditorView {
  const state = EditorState.create({ doc, extensions: [javascript()] });
  return new EditorView({ state });
}

describe("jsSyntaxLinter", () => {
  it("should report no diagnostics for valid javascript", () => {
    const view = viewOf("const a = 1; console.log(a);");

    expect(jsSyntaxLinter()(view)).toEqual([]);
  });

  it("should report no diagnostics for an empty document", () => {
    const view = viewOf("   \n  ");

    expect(jsSyntaxLinter()(view)).toEqual([]);
  });

  it("should report a diagnostic for an unclosed brace", () => {
    const view = viewOf("function f() {");

    const diagnostics = jsSyntaxLinter()(view);

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics[0].severity).toBe("error");
  });

  it("should report a diagnostic for an unterminated string", () => {
    const view = viewOf('const a = "oops');

    expect(jsSyntaxLinter()(view).length).toBeGreaterThan(0);
  });

  it("should give each diagnostic a valid from/to range within the doc", () => {
    const view = viewOf("const = ;");

    const diagnostics = jsSyntaxLinter()(view);

    expect(diagnostics.length).toBeGreaterThan(0);
    diagnostics.forEach((d) => {
      expect(d.from).toBeGreaterThanOrEqual(0);
      expect(d.to).toBeLessThanOrEqual(view.state.doc.length);
      expect(d.from).toBeLessThanOrEqual(d.to);
    });
  });
});
