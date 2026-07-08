import { describe, it, expect } from "vitest";
import { render, waitFor } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import { startCompletion } from "@codemirror/autocomplete";

import { BodyEditor } from "@/components/workspace/body-editor";
import { TokenSuggestionList } from "@/components/workspace/token-suggestions";
import {
  TOKEN_KIND_COLOR,
  tokenOptionClass,
} from "@/components/workspace/token-suggestion-style";
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
const processEnv = { HOST: "localhost" };
const CANDS = tokenCandidates(effective, processEnv);

function liveView(container: HTMLElement): EditorView {
  const el = container.querySelector<HTMLElement>(".cm-editor");
  if (!el) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(el);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

describe("token suggestion visual parity", () => {
  // behavior: the CodeMirror `{{token}}` popup and the React input listbox draw
  // each candidate name in the SAME per-kind color (from the shared contract). The
  // CM side proves it by applying the `cm-token-<kind>` class the makeChrome CSS
  // colors; the React side by applying TOKEN_KIND_COLOR to the option name.
  it("should color a variable/environment/dotenv candidate by the shared kind map in the React listbox", () => {
    const { container } = render(
      <TokenSuggestionList
        id="test-listbox"
        candidates={CANDS}
        activeIndex={0}
        onPick={() => {}}
        onActivate={() => {}}
      />,
    );

    const nameSpan = (label: string) =>
      Array.from(container.querySelectorAll("span")).find(
        (s) => s.textContent === label,
      );

    expect(nameSpan("BASE_URL")?.className).toContain("text-emerald-500");
    expect(nameSpan("ENV_TOKEN")?.className).toContain("text-sky-600");
    expect(nameSpan("process.env.HOST")?.className).toContain("text-amber-500");
    // the map the CM side keys off is the very same one.
    expect(TOKEN_KIND_COLOR.variable).toContain("emerald-500");
  });

  // side-effect-contract: tokenOptionClass maps a completion's kind `type` to the
  // `cm-token-<kind>` class the popup CSS colors, and returns "" for a non-token
  // (schema/script) option so those stay default-colored.
  it("should map only token kinds to a cm-token class", () => {
    expect(tokenOptionClass({ label: "x", type: "variable" })).toBe(
      "cm-token-variable",
    );
    expect(tokenOptionClass({ label: "x", type: "environment" })).toBe(
      "cm-token-environment",
    );
    expect(tokenOptionClass({ label: "x", type: "dotenv" })).toBe(
      "cm-token-dotenv",
    );
    expect(tokenOptionClass({ label: "x", type: "keyword" })).toBe("");
    expect(tokenOptionClass({ label: "x" })).toBe("");
  });

  // behavior: the body editor popup renders each token option WITH its kind class
  // and WITHOUT the CodeMirror completion icon (icons hidden for parity).
  it("should render the CM token popup with kind classes and no icon column", async () => {
    const { container } = render(
      <BodyEditor value="" onChange={() => {}} candidates={CANDS} />,
    );
    const view = liveView(container);
    view.dispatch({
      changes: { from: 0, insert: "{{" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    startCompletion(view);

    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    });

    const tooltip = document.querySelector(".cm-tooltip-autocomplete")!;
    // EVERY kind gets its own cm-token-<kind> class (variable, environment AND
    // dotenv) - not just `variable`. The regression: the option `type` was remapped
    // (environment -> constant, dotenv -> property), so only `variable` matched and
    // env/dotenv rows rendered white instead of sky/amber.
    const li = (label: string) =>
      Array.from(tooltip.querySelectorAll("li")).find((el) =>
        el.textContent?.includes(label),
      );
    expect(li("BASE_URL")?.className).toContain("cm-token-variable");
    expect(li("ENV_TOKEN")?.className).toContain("cm-token-environment");
    expect(li("process.env.HOST")?.className).toContain("cm-token-dotenv");
    // no visible completion icon element rendered (icons: false).
    expect(tooltip.querySelector(".cm-completionIcon")).toBeNull();
  });

  // behavior: the CM popup lists the candidates in the SAME grouped order the
  // React listbox uses (nearest scope -> variable/env/dotenv groups), NOT
  // CodeMirror's default alphabetical re-sort. `filter: false` on the source is
  // what preserves it - without it CM would reorder to BASE_URL, ENV_TOKEN,
  // process.env.HOST alphabetically-by-score, diverging from the input popup.
  it("should list the CM options in the same order as the React token listbox", async () => {
    const inputRender = render(
      <TokenSuggestionList
        id="order-list"
        candidates={CANDS}
        activeIndex={0}
        onPick={() => {}}
        onActivate={() => {}}
      />,
    );
    const inputOrder = Array.from(
      inputRender.container.querySelectorAll('[role="option"] span:first-child'),
    ).map((s) => s.textContent);

    const { container } = render(
      <BodyEditor value="" onChange={() => {}} candidates={CANDS} />,
    );
    const view = liveView(container);
    view.dispatch({
      changes: { from: 0, insert: "{{" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    startCompletion(view);
    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    });
    const cmOrder = Array.from(
      document.querySelectorAll(
        ".cm-tooltip-autocomplete li .cm-completionLabel",
      ),
    ).map((l) => l.textContent);

    // both surfaces mirror the pure candidate order (grouped, not alphabetized).
    expect(cmOrder).toEqual(CANDS.map((c) => c.name));
    expect(cmOrder).toEqual(inputOrder);
  });

  // side-effect-contract: the CM option row is a flex row (name left, source
  // pushed right via the detail's margin-left:auto), matching the React listbox's
  // justify-between layout - so the source column aligns identically.
  it("should lay the CM option out as a flex row with the source right-aligned", async () => {
    const { container } = render(
      <BodyEditor value="" onChange={() => {}} candidates={CANDS} />,
    );
    const view = liveView(container);
    view.dispatch({
      changes: { from: 0, insert: "{{" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
    startCompletion(view);
    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete li")).not.toBeNull();
    });

    const li = document.querySelector<HTMLElement>(
      ".cm-tooltip-autocomplete li",
    )!;
    const detail = li.querySelector<HTMLElement>(".cm-completionDetail")!;
    expect(getComputedStyle(li).display).toBe("flex");
    expect(getComputedStyle(detail).marginLeft).toBe("auto");
  });
});
