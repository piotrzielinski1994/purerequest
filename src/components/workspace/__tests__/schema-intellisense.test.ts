import { describe, it, expect } from "vitest";
import { EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import {
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";
import { json } from "@codemirror/lang-json";
import {
  forceLinting,
  forEachDiagnostic,
  type Diagnostic,
} from "@codemirror/lint";

import { jsonSchemaHover } from "codemirror-json-schema";
import { makeSchemaExtensions } from "@/components/workspace/schema-intellisense";
import {
  configScopeJsonSchema,
  requestSettingsJsonSchema,
} from "@/lib/config-schema/json-schemas";
import type { EditorColors } from "@/components/workspace/editor-theme";
import type { EditorTokenName } from "@/lib/settings/settings";

// Unique sentinel colors (mirrors editor-theme-factories.test.ts) so a present
// color in the injected CSS can only have come from THIS factory call.
function sentinelEditorColors(
  overrides: Partial<Record<EditorTokenName, string>> = {},
): EditorColors {
  return {
    caret: "oklch(0.911 0.311 11)",
    selection: "oklch(0.922 0.312 22)",
    gutter: "oklch(0.933 0.313 33)",
    keyword: "oklch(0.944 0.314 44)",
    string: "oklch(0.955 0.315 55)",
    number: "oklch(0.966 0.316 66)",
    property: "oklch(0.977 0.317 77)",
    comment: "oklch(0.988 0.318 88)",
    invalid: "oklch(0.999 0.319 99)",
    ...overrides,
  };
}

function injectedCss(): string {
  return Array.from(document.querySelectorAll("style"))
    .map((s) => s.textContent ?? "")
    .join("\n");
}

// Mount a real EditorView (attached to the DOM) from the schema factory's
// extensions, so the async schema linter can resolve against the in-state schema.
function mountWith(doc: string): EditorView {
  const parent = document.createElement("div");
  document.body.appendChild(parent);
  return new EditorView({
    state: EditorState.create({
      doc,
      extensions: makeSchemaExtensions(
        configScopeJsonSchema,
        sentinelEditorColors(),
        true,
      ) as never,
    }),
    parent,
  });
}

// Force a lint pass and collect the resulting diagnostics from the lint field.
async function diagnosticsOf(view: EditorView): Promise<Diagnostic[]> {
  forceLinting(view);
  // The schema linter resolves asynchronously; let the microtask + a macrotask
  // flush so setDiagnostics has landed in the lint field before we read it.
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  const out: Diagnostic[] = [];
  forEachDiagnostic(view.state, (d) => {
    out.push(d);
  });
  return out;
}

describe("makeSchemaExtensions lint severity", () => {
  // AC-003 - behavior: a wrong-typed value surfaces a WARNING (not an error).
  it("should report a warning diagnostic if a field has the wrong type", async () => {
    const view = mountWith('{\n  "timeoutMs": "soon"\n}');

    const diagnostics = await diagnosticsOf(view);
    view.destroy();

    expect(diagnostics.some((d) => d.severity === "warning")).toBe(true);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  // AC-004 - behavior: an unknown key surfaces a WARNING (closed schema).
  it("should report a warning diagnostic if a key is unknown", async () => {
    const view = mountWith('{\n  "aut2h": {}\n}');

    const diagnostics = await diagnosticsOf(view);
    view.destroy();

    expect(diagnostics.some((d) => d.severity === "warning")).toBe(true);
    expect(diagnostics.some((d) => d.severity === "error")).toBe(false);
  });

  // AC-006 - behavior: malformed JSON still yields an ERROR (syntax linter), and a
  // schema-only violation never produces an error severity.
  it("should report an error diagnostic if the JSON is malformed", async () => {
    const view = mountWith('{\n  "variables": {');

    const diagnostics = await diagnosticsOf(view);
    view.destroy();

    expect(diagnostics.some((d) => d.severity === "error")).toBe(true);
  });

  // AC-006 - side-effect-contract: a schema violation alone (valid JSON syntax)
  // produces no error severity, so it can never block the syntax-gated save.
  it("should not report an error diagnostic for a schema-only violation", async () => {
    const view = mountWith('{\n  "timeoutMs": "soon",\n  "aut2h": {}\n}');

    const diagnostics = await diagnosticsOf(view);
    view.destroy();

    expect(diagnostics.length).toBeGreaterThan(0);
    expect(diagnostics.every((d) => d.severity !== "error")).toBe(true);
  });
});

describe("makeSchemaExtensions completion", () => {
  // Build a completion context against a live state carrying the schema factory's
  // extensions, then read the autocomplete source registered on the json language.
  async function completeAt(
    schema: typeof configScopeJsonSchema,
    doc: string,
    pos: number,
  ): Promise<CompletionResult | null> {
    const state = EditorState.create({
      doc,
      extensions: makeSchemaExtensions(
        schema,
        sentinelEditorColors(),
        true,
      ) as never,
    });
    const ctx = new CompletionContext(state, pos, true);
    const sources = state.languageDataAt<
      (c: CompletionContext) => CompletionResult | null | Promise<CompletionResult | null>
    >("autocomplete", pos);
    const results = await Promise.all(sources.map((source) => source(ctx)));
    return results.find((r): r is CompletionResult => r != null) ?? null;
  }

  // AC-001 - behavior: key completion inside a ConfigScope object offers its keys.
  // The json-schema completion (monaco-style) fires on a partial key token, i.e.
  // right after the opening quote - not on bare whitespace.
  it("should offer ConfigScope keys when completing inside the object", async () => {
    const doc = '{\n  "\n}';
    const pos = doc.indexOf('"') + 1;
    const result = await completeAt(configScopeJsonSchema, doc, pos);

    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label.replace(/"/g, ""));
    expect(labels).toEqual(
      expect.arrayContaining(["variables", "headers", "params", "auth", "scripts"]),
    );
  });

  // AC-002 - behavior: enum completion for `method` offers the five HTTP methods.
  it("should offer the HTTP methods when completing an empty method value", async () => {
    const doc = '{\n  "method": ""\n}';
    const pos = doc.indexOf('""') + 1;
    const result = await completeAt(requestSettingsJsonSchema, doc, pos);

    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label.replace(/"/g, ""));
    expect(labels).toEqual(
      expect.arrayContaining(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    );
  });

  // AC-001 - behavior: a union-valued key (`body`, a StoredBody union) must still
  // be offered. The completion lib drops object properties whose value schema is
  // `oneOf`; `body` must serialize as `anyOf` so it isn't silently missing from
  // key autocomplete.
  it("should offer the body key even though its value is a union", async () => {
    const doc = '{\n  "\n}';
    const pos = doc.indexOf('"') + 1;
    const result = await completeAt(requestSettingsJsonSchema, doc, pos);

    expect(result).not.toBeNull();
    const labels = result!.options.map((o) => o.label.replace(/"/g, ""));
    expect(labels).toContain("body");
  });
});

describe("makeSchemaExtensions hover", () => {
  // AC-005 - behavior: hovering a known key returns a tooltip carrying its schema
  // description. The factory mounts the same hover source via hoverTooltip(); we
  // mount a live view (so the schema is in state) and call jsonSchemaHover()
  // directly at the key position, asserting the rendered tooltip carries the
  // schema's `.describe(...)` text.
  it("should return a hover tooltip with the auth key description", async () => {
    const doc = '{\n  "auth": { "type": "none" }\n}';
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc,
        extensions: makeSchemaExtensions(
          configScopeJsonSchema,
          sentinelEditorColors(),
          true,
        ) as never,
      }),
      parent,
    });

    const pos = doc.indexOf('"auth"') + 2;
    const tooltip = await jsonSchemaHover()(view, pos, 1);
    const text = tooltip
      ? (tooltip.create(view).dom.textContent ?? "")
      : "";
    view.destroy();

    expect(tooltip).toBeTruthy();
    expect(text).toContain("Authentication");
  });
});

describe("makeSchemaExtensions themed chrome", () => {
  // AC-008 - side-effect-contract: the factory output still composes the themed
  // highlight (the string-tag color from the colors map lands in injected CSS).
  it("should carry the highlight colors from the colors map", () => {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    const view = new EditorView({
      state: EditorState.create({
        doc: '"x"',
        extensions: makeSchemaExtensions(
          configScopeJsonSchema,
          sentinelEditorColors({ string: "oklch(0.123 0.321 321)" }),
          true,
        ) as never,
      }),
      parent,
    });
    const css = injectedCss();
    view.destroy();

    expect(css).toContain("oklch(0.123 0.321 321)");
  });

  // AC-008 - side-effect-contract: the factory carries a json language layer (so
  // the editor stays a JSON editor with the schema pieces layered on top).
  it("should include the json language extension", () => {
    const withJson = makeSchemaExtensions(
      configScopeJsonSchema,
      sentinelEditorColors(),
      true,
    );
    const plainJsonLength = ([json()] as unknown[]).flat(Infinity).length;

    expect(([withJson] as unknown[]).flat(Infinity).length).toBeGreaterThan(
      plainJsonLength,
    );
  });
});
