import { describe, it, expect } from "vitest";
import { waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView, runScopeHandlers } from "@codemirror/view";
import { EditorState, type Extension } from "@codemirror/state";
import { openSearchPanel } from "@codemirror/search";

// Imported before it exists: the suite must fail RED on the missing module, not
// on a typo. editorFind(openKey) is a CodeMirror extension that binds openKey to
// a search panel rendering the shared FindBar.
import { editorFind } from "@/components/workspace/editor-find";

// jsdom reports an empty navigator.platform, so CodeMirror maps "Mod" to Ctrl
// (not Cmd). The open key is threaded in already-bridged CM form ("Mod-f"), and
// a Ctrl+F keydown routed through the editor scope must trigger it.
const OPEN_KEY = "Mod-f";

function mountEditor(extension: Extension): {
  view: EditorView;
  container: HTMLElement;
} {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const view = new EditorView({
    state: EditorState.create({
      doc: "ada lovelace, ada byron, augusta ada",
      extensions: [extension],
    }),
    parent: container,
  });
  return { view, container };
}

function pressOpenKey(view: EditorView) {
  view.focus();
  runScopeHandlers(
    view,
    new KeyboardEvent("keydown", { key: "f", code: "KeyF", ctrlKey: true }),
    "editor",
  );
}

describe("editorFind", () => {
  // TC-006 (AC-002/AC-005) — behavior: pressing the open key opens a panel whose
  // DOM renders the shared FindBar input (aria-label "Find").
  it("should open a panel rendering the FindBar input if the open key is pressed", async () => {
    const { view, container } = mountEditor(editorFind(OPEN_KEY));

    expect(
      container.querySelector('input[aria-label="Find"]'),
      "no find panel before the key is pressed",
    ).toBeNull();

    pressOpenKey(view);

    await waitFor(() => {
      expect(container.querySelector('input[aria-label="Find"]')).not.toBeNull();
    });

    view.destroy();
  });

  // TC-006 (AC-002) — side-effect-contract: the panel mounts at the top of the
  // editor (not CodeMirror's default bottom panel).
  it("should mount the find panel at the top of the editor", async () => {
    const { view, container } = mountEditor(editorFind(OPEN_KEY));

    pressOpenKey(view);

    await waitFor(() => {
      expect(container.querySelector('input[aria-label="Find"]')).not.toBeNull();
    });

    const topPanels = container.querySelector(".cm-panels-top");
    expect(topPanels).not.toBeNull();
    expect(
      topPanels?.querySelector('input[aria-label="Find"]'),
      "find input is not inside the top panel container",
    ).not.toBeNull();

    view.destroy();
  });

  // TC-006 — side-effect-contract: editorFind is a single-argument factory that
  // yields a non-empty extension (structural contract, resilient to jsdom quirks).
  it("should return a non-empty extension from a single-argument factory", () => {
    expect(editorFind).toHaveLength(1);

    const extension = editorFind(OPEN_KEY);
    const flat = Array.isArray(extension) ? extension.flat(Infinity) : [extension];
    expect(flat.length).toBeGreaterThan(0);
  });

  // AC-003 — behavior: typing a query reports the real TOTAL match count scanned
  // from the doc (matchStats), not a hard-coded value. The doc has 3 "ada"
  // occurrences, so the FindBar count reads "N/3". (The active index is exercised
  // by the FindBar unit test; here we pin the total that matchStats computes.)
  it("should report the total match count for the typed query", async () => {
    const user = userEvent.setup();
    const { view, container } = mountEditor(editorFind(OPEN_KEY));

    pressOpenKey(view);

    const findBar = () => container.querySelector(".cm-requi-find");
    await waitFor(() => expect(findBar()).not.toBeNull());

    const input = container.querySelector<HTMLInputElement>(
      '.cm-requi-find input[aria-label="Find"]',
    );
    await user.type(input as HTMLInputElement, "ada");

    await waitFor(() => {
      expect(findBar()?.textContent).toMatch(/\/\s*3(?!\d)/);
    });

    view.destroy();
  });

  // AC-006 — behavior: the palette re-opens find by calling openSearchPanel on the
  // snapshotted view directly (not by re-firing a synthetic key, which CM ignores).
  // This proves the command path the palette uses actually surfaces the FindBar.
  it("should open the FindBar if openSearchPanel is called on the view", async () => {
    const { view, container } = mountEditor(editorFind(OPEN_KEY));

    expect(container.querySelector('input[aria-label="Find"]')).toBeNull();

    openSearchPanel(view);

    await waitFor(() => {
      expect(container.querySelector('input[aria-label="Find"]')).not.toBeNull();
    });

    view.destroy();
  });
});
