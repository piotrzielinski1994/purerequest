import { describe, it, expect, afterEach } from "vitest";
import { render, waitFor, act } from "@testing-library/react";
import { EditorView } from "@codemirror/view";
import {
  startCompletion,
  CompletionContext,
  type CompletionResult,
} from "@codemirror/autocomplete";

// config-editor.tsx / theme-section.tsx / script-editor.tsx already exist; this
// file is RED because the token completion source is NOT yet wired into the
// folder-config and request-Settings editors (TC-009). The theme + script editor
// assertions (TC-010) guard that those surfaces stay token-free.
import {
  ConfigEditorForm,
  RequestSettingsForm,
} from "@/components/workspace/config-editor";
import { ScriptEditor } from "@/components/workspace/script-editor";
import { ThemeSection } from "@/components/settings/theme-section";
import {
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { ToastProvider } from "@/components/ui/toast";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { createFakeHttpClient } from "./fake-http-client";
import {
  emptyBody,
  emptyParams,
  type RequestNode,
  type TreeNode,
} from "@/lib/workspace/model";

function liveView(): EditorView {
  const el = document.querySelector<HTMLElement>(".cm-editor");
  if (!el) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(el);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view;
}

// Replace the whole doc with `{{`, caret after it, and force the popup open. The
// dispatch runs in act so the editor's onChange -> re-render settles first.
async function typeOpenToken(view: EditorView) {
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "{{" },
      selection: { anchor: 2 },
      userEvent: "input.type",
    });
  });
  startCompletion(view);
}

function tokenLabelsInTooltip(): string[] {
  const tooltip = document.querySelector(".cm-tooltip-autocomplete");
  if (!tooltip) {
    return [];
  }
  return Array.from(tooltip.querySelectorAll("li")).map(
    (li) => li.textContent ?? "",
  );
}

// The autocomplete sources CodeMirror collects from the JSON language at a caret
// inside the doc. Composition (schema + token) means at least two sources.
function autocompleteSourceCount(view: EditorView): number {
  const pos = Math.min(2, view.state.doc.length);
  return view.state.languageDataAt<
    (c: CompletionContext) => CompletionResult | null
  >("autocomplete", pos).length;
}

const FOLDER_CONFIG = { variables: [{ key: "API_TOKEN", value: "secret" }] };

const request: RequestNode = {
  kind: "request",
  id: "req-1",
  name: "Req",
  method: "GET",
  url: "https://api",
  body: emptyBody(),
  params: emptyParams(),
  config: {},
};

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: FOLDER_CONFIG,
    children: [request],
  },
];

function stubMatchMedia() {
  window.matchMedia = ((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: () => {},
    removeEventListener: () => {},
    addListener: () => {},
    removeListener: () => {},
    dispatchEvent: () => true,
  })) as unknown as typeof window.matchMedia;
}

afterEach(() => {
  // @ts-expect-error - drop the matchMedia stub between tests.
  delete window.matchMedia;
});

describe("config editors token autocomplete", () => {
  // TC-009, AC-006 - behavior + side-effect-contract: the folder-config editor
  // offers its own scope tokens (the folder var) on `{{`, AND the schema source
  // is still collected (>= 2 autocomplete sources = compose, not replace).
  it("should offer the folder scope tokens and keep the schema source in the folder-config editor", async () => {
    render(
      <ToastProvider>
        <WorkspaceProvider tree={tree}>
          <ConfigEditorForm id="folder-1" config={FOLDER_CONFIG} />
        </WorkspaceProvider>
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const view = liveView();
    await typeOpenToken(view);

    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    });
    expect(tokenLabelsInTooltip().some((t) => t.includes("API_TOKEN"))).toBe(
      true,
    );
    expect(autocompleteSourceCount(view)).toBeGreaterThanOrEqual(2);
  });

  // TC-009, AC-007 - behavior + side-effect-contract: the request-Settings editor
  // offers the request's resolved scope tokens (the inherited folder var) on `{{`,
  // AND still carries the schema source (composed).
  it("should offer the request scope tokens and keep the schema source in the request-Settings editor", async () => {
    render(
      <ToastProvider>
        <WorkspaceProvider
          tree={tree}
          initialActiveRequestId="req-1"
          httpClient={createFakeHttpClient()}
        >
          <RequestSettingsForm request={request} />
        </WorkspaceProvider>
      </ToastProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const view = liveView();
    await typeOpenToken(view);

    await waitFor(() => {
      expect(document.querySelector(".cm-tooltip-autocomplete")).not.toBeNull();
    });
    expect(tokenLabelsInTooltip().some((t) => t.includes("API_TOKEN"))).toBe(
      true,
    );
    expect(autocompleteSourceCount(view)).toBeGreaterThanOrEqual(2);
  });
});

describe("excluded editors stay token-free", () => {
  // TC-010, AC-008 - behavior: the theme-colors JSON editor offers NO `{{var}}`
  // token option (no request scope, no token source wired).
  it("should not offer any token completion in the theme-colors editor", async () => {
    stubMatchMedia();
    const store = createInMemorySettingsStore(DEFAULT_SETTINGS);
    render(
      <SettingsProvider store={store}>
        <ThemeProvider>
          <WorkspaceProvider httpClient={createFakeHttpClient()}>
            <ThemeSection />
          </WorkspaceProvider>
        </ThemeProvider>
      </SettingsProvider>,
    );
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await typeOpenToken(liveView());

    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();

    const labels = tokenLabelsInTooltip();
    expect(labels.some((t) => t.includes("API_TOKEN"))).toBe(false);
    expect(labels.some((t) => t.includes("process.env."))).toBe(false);
  });

  // TC-010, AC-008 - behavior: the script editor offers NO `{{var}}` token option,
  // yet still exposes its req/res/purerequest API completion (unchanged).
  it("should not offer token completion but keep the script API in the script editor", async () => {
    const { container } = render(
      <ScriptEditor
        value=""
        stage="pre"
        onChange={() => {}}
        ariaLabel="Pre-request script"
      />,
    );
    await waitFor(() => {
      expect(container.querySelector(".cm-editor")).not.toBeNull();
    });
    const view = EditorView.findFromDOM(
      container.querySelector<HTMLElement>(".cm-editor")!,
    )!;

    await typeOpenToken(view);
    await new Promise((resolve) => setTimeout(resolve, 0));
    await Promise.resolve();
    expect(
      tokenLabelsInTooltip().some((t) => t.includes("process.env.")),
    ).toBe(false);

    // the script API completion still fires: `req.` offers the request getters.
    await act(async () => {
      view.dispatch({
        changes: { from: 0, to: view.state.doc.length, insert: "req." },
        selection: { anchor: 4 },
        userEvent: "input.type",
      });
    });
    startCompletion(view);
    await waitFor(() => {
      expect(
        document.querySelector(".cm-tooltip-autocomplete")?.textContent ?? "",
      ).toContain("getUrl");
    });
  });
});
