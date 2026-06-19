import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { forceLinting, diagnosticCount } from "@codemirror/lint";

// Imported even though it does not exist yet: the test must fail on the missing
// feature (module/component), not on a typo. Once body-editor.tsx ships, these
// assertions pin the editor's wiring.
import { BodyEditor } from "@/components/workspace/body-editor";

// forceLinting runs the source synchronously but dispatches diagnostics through
// Promise.resolve().then (a microtask), so the count is only updated after the
// queue drains. Awaiting a resolved promise lets that dispatch land.
function flushLint(): Promise<void> {
  return Promise.resolve();
}

function liveView(container: HTMLElement): EditorView {
  const editorEl = container.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

describe("BodyEditor", () => {
  // AC-001/AC-002 — behavior: it renders an editable CodeMirror surface.
  it("should mount an editable code editor surface", () => {
    const { container } = render(<BodyEditor value="" onChange={() => {}} />);

    const surface = container.querySelector(".cm-content");
    expect(surface).not.toBeNull();
    expect(surface).toHaveAttribute("contenteditable", "true");
    expect(surface).toHaveAttribute("role", "textbox");
  });

  // AC-004 — side-effect-contract: the JSON language extension is wired.
  it("should apply the JSON language to the editor", () => {
    const { container } = render(
      <BodyEditor value={'{ "a": 1 }'} onChange={() => {}} />,
    );

    expect(container.querySelector(".cm-content")).toHaveAttribute(
      "data-language",
      "json",
    );
  });

  // AC-005, TC-004 — side-effect-contract: closeBrackets registers an input
  // handler on the rendered editor's state. json() alone registers zero; the
  // bracket-closing extension is what adds the keystroke-level auto-close.
  // Per spec section 6, we assert the wiring, not a simulated raw keystroke.
  it("should wire bracket auto-close into the editor", () => {
    const { container } = render(<BodyEditor value="" onChange={() => {}} />);

    const handlers = liveView(container).state.facet(EditorView.inputHandler);
    expect(handlers.length).toBeGreaterThanOrEqual(1);
  });

  // AC-003 — side-effect-contract: edits flow out through onChange.
  it("should report edits through onChange when the document changes", () => {
    let reported: string | null = null;
    const { container } = render(
      <BodyEditor value="" onChange={(next) => (reported = next)} />,
    );

    const view = liveView(container);
    view.dispatch({ changes: { from: 0, insert: '{"x":1}' } });

    expect(reported).toBe('{"x":1}');
  });

  // AC-008 — behavior: malformed JSON produces a lint diagnostic.
  it("should flag malformed JSON with a lint diagnostic", async () => {
    const { container } = render(
      <BodyEditor value={'{ "a": 1, }'} onChange={() => {}} />,
    );

    const view = liveView(container);
    forceLinting(view);
    await flushLint();

    expect(diagnosticCount(view.state)).toBeGreaterThan(0);
  });

  // AC-008 — behavior: well-formed JSON produces no diagnostics.
  it("should not flag well-formed JSON", async () => {
    const { container } = render(
      <BodyEditor value={'{ "a": 1 }'} onChange={() => {}} />,
    );

    const view = liveView(container);
    forceLinting(view);
    await flushLint();

    expect(diagnosticCount(view.state)).toBe(0);
  });
});
