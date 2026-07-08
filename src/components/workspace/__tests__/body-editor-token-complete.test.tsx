import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";

// The `candidates` prop does not exist on BodyEditor yet - passing it is the RED
// signal (TS may complain until the prop ships). These assertions pin the token
// completion wiring the feature adds to the body editor.
import { BodyEditor } from "@/components/workspace/body-editor";
import { tokenCandidates } from "@/components/workspace/token-complete";
import type { EffectiveConfig } from "@/lib/workspace/resolve";
import { authOf } from "@/lib/workspace/model";

const effective: EffectiveConfig = {
  variables: {
    BASE_URL: {
      value: "https://api",
      from: { scopeId: "f1", scopeName: "asd1" },
      origin: "variable",
    },
    ENV_TOKEN: {
      value: "tok",
      from: { scopeId: "f1:env-11", scopeName: "asd1 (env-11)" },
      origin: "environment",
    },
  },
  headers: {},
  auth: {
    value: authOf({ active: "inherit" }),
    from: { scopeId: "d", scopeName: "d" },
  },
  scripts: {
    pre: { value: "", from: { scopeId: "d", scopeName: "d" } },
    post: { value: "", from: { scopeId: "d", scopeName: "d" } },
  },
  timeoutMs: { value: 30000, from: { scopeId: "d", scopeName: "d" } },
};

const processEnv = { HOST: "localhost", PORT: "3000" };
const CANDS = tokenCandidates(effective, processEnv);

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

// Type `{{` at the start and force the popup open synchronously (`{` is not a word
// char, so the auto-trigger is unreliable - startCompletion drives it in jsdom).
function typeOpenToken(view: EditorView) {
  view.dispatch({
    changes: { from: 0, insert: "{{" },
    selection: { anchor: 2 },
    userEvent: "input.type",
  });
  startCompletion(view);
}

// The token option labels present in any currently-open autocomplete tooltip.
function tokenLabelsInTooltip(): string[] {
  const tooltip = document.querySelector(".cm-tooltip-autocomplete");
  if (!tooltip) {
    return [];
  }
  return Array.from(tooltip.querySelectorAll("li")).map(
    (li) => li.textContent ?? "",
  );
}

describe("BodyEditor token autocomplete", () => {
  // TC-008, AC-001 - behavior: with candidates, typing `{{` opens the themed
  // autocomplete tooltip listing the in-scope token names.
  it("should open the token autocomplete tooltip with the candidate names if the user types {{", async () => {
    const { container } = render(
      <BodyEditor value="" onChange={() => {}} candidates={CANDS} />,
    );

    typeOpenToken(liveView(container));

    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    });
    expect(tokenLabelsInTooltip().some((t) => t.includes("BASE_URL"))).toBe(true);
  });

  // AC-004/008 boundary - behavior: with NO candidates the body editor does NOT
  // open a token popup (a JSON keyword tooltip may still appear, so the assertion
  // is scoped to the token names, which must be absent).
  it("should not offer any token names if no candidates are passed", async () => {
    const { container } = render(<BodyEditor value="" onChange={() => {}} />);

    typeOpenToken(liveView(container));

    // let any completion tooltip settle before asserting the token names are absent.
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    const labels = tokenLabelsInTooltip();
    expect(labels.some((t) => t.includes("BASE_URL"))).toBe(false);
    expect(labels.some((t) => t.includes("ENV_TOKEN"))).toBe(false);
    expect(labels.some((t) => t.includes("process.env."))).toBe(false);
  });
});
