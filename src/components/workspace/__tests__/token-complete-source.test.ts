import { CompletionContext } from "@codemirror/autocomplete";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";
import { tokenCandidates } from "@/components/workspace/token-complete";
// Imported even though it does not exist yet: the file must fail on the missing
// module (the feature), not on a typo. Once token-complete-source.ts ships, these
// assertions pin the pure CodeMirror completion source that wraps the tested core.
import { tokenCompletionSource } from "@/components/workspace/token-complete-source";
import { authOf } from "@/lib/workspace/model";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

// Reused verbatim from token-complete.test.ts so the source is driven against the
// exact same candidate fixtures the pure core is tested with.
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

const all = tokenCandidates(effective, processEnv);

function contextAt(doc: string, pos: number): CompletionContext {
  const state = EditorState.create({ doc, selection: { anchor: pos } });
  return new CompletionContext(state, pos, true);
}

// A DOM-attached view so a dispatched apply() lands (TC-004/005). The context is
// built from THIS view's state so the source sees the same doc apply() edits.
function liveViewWith(doc: string, caret: number): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({ doc, selection: { anchor: caret } }),
    parent,
  });
}

describe("tokenCompletionSource", () => {
  // TC-001, AC-001/005 - behavior: caret right after `{{` returns every candidate,
  // with `from` at the index just after `{{`, options mapping the candidate names.
  it("should return every candidate from just after {{ if the caret follows an open {{", () => {
    const source = tokenCompletionSource(all);
    const result = source(contextAt("{{", 2));

    expect(result).not.toBeNull();
    expect(result?.from).toBe(2);
    expect(result?.options.map((o) => o.label)).toEqual(all.map((c) => c.name));
  });

  // TC-002, AC-002 - behavior: a typed prefix filters the options by
  // case-insensitive substring (only BASE_URL contains "ba").
  it("should filter the options by the typed prefix after {{", () => {
    const source = tokenCompletionSource(all);
    const result = source(contextAt("{{ba", 4));

    const labels = result?.options.map((o) => o.label) ?? [];
    expect(labels).toContain("BASE_URL");
    expect(labels).not.toContain("ENV_TOKEN");
    expect(labels).not.toContain("process.env.HOST");
  });

  // TC-003, AC-002 - behavior: a prefix matching nothing returns null (no dropdown).
  it("should return null if no candidate matches the typed prefix", () => {
    const source = tokenCompletionSource(all);

    expect(source(contextAt("{{zzz", 5))).toBeNull();
  });

  // TC-004, AC-003 (E-4) - side-effect-contract: applying BASE_URL at `{{ba`
  // replaces the prefix, auto-closes with `}}`, and lands the caret after the `}}`.
  it("should insert the name and auto-close with }} if the applied candidate has no following braces", () => {
    const source = tokenCompletionSource(all);
    const view = liveViewWith("{{ba", 4);
    const result = source(new CompletionContext(view.state, 4, true));
    const option = result?.options.find((o) => o.label === "BASE_URL");

    expect(typeof option?.apply).toBe("function");
    if (!result || !option) {
      throw new Error("expected a BASE_URL completion option");
    }
    (
      option.apply as (
        v: EditorView,
        c: unknown,
        from: number,
        to: number,
      ) => void
    )(view, option, result.from, 4);
    const doc = view.state.doc.toString();
    const head = view.state.selection.main.head;
    view.destroy();

    expect(doc).toBe("{{BASE_URL}}");
    expect(head).toBe("{{BASE_URL}}".length);
  });

  // TC-005, AC-003 (E-3) - side-effect-contract: applying at `{{ba}}` (caret before
  // the existing `}}`) does NOT double the braces; caret still lands after `}}`.
  it("should not double the closing braces if a }} already follows the caret", () => {
    const source = tokenCompletionSource(all);
    const view = liveViewWith("{{ba}}", 4);
    const result = source(new CompletionContext(view.state, 4, true));
    const option = result?.options.find((o) => o.label === "BASE_URL");

    expect(typeof option?.apply).toBe("function");
    if (!result || !option) {
      throw new Error("expected a BASE_URL completion option");
    }
    (
      option.apply as (
        v: EditorView,
        c: unknown,
        from: number,
        to: number,
      ) => void
    )(view, option, result.from, 4);
    const doc = view.state.doc.toString();
    const head = view.state.selection.main.head;
    view.destroy();

    expect(doc).toBe("{{BASE_URL}}");
    expect(head).toBe("{{BASE_URL}}".length);
  });

  // TC-006, AC-004 - behavior: a caret past an already-closed token returns null.
  it("should return null if the caret is past a closed {{...}} token", () => {
    const source = tokenCompletionSource(all);
    const text = "{{BASE_URL}}/x";

    expect(source(contextAt(text, text.length))).toBeNull();
  });

  // TC-007, AC-004 - behavior: a caret in plain text (no open {{) returns null.
  it("should return null if the caret is in plain text with no open {{", () => {
    const source = tokenCompletionSource(all);
    const text = "/api/path";

    expect(source(contextAt(text, text.length))).toBeNull();
  });
});
