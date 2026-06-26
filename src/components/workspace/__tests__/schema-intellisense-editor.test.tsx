import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import {
  forceLinting,
  forEachDiagnostic,
  type Diagnostic,
} from "@codemirror/lint";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import { ToastProvider } from "@/components/ui/toast";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";
import { createFakeHttpClient } from "./fake-http-client";
// Importing the schema factory anchors this render-level suite to the feature:
// until the feature ships, the file fails to resolve (RED), and the warning
// assertions below pin the wired-in schema lint (absent today).
import { makeSchemaExtensions } from "@/components/workspace/schema-intellisense";

void makeSchemaExtensions;

// Mod+S routes through saveActiveEditor; this probe fires that path directly.
function EditorProbe() {
  const { saveActiveEditor } = useWorkspace();
  return (
    <button type="button" onClick={saveActiveEditor}>
      fire shortcut
    </button>
  );
}

const REQ_CONFIG: ConfigScope = {
  headers: [{ key: "Accept", value: "application/json" }],
};

const tree: TreeNode[] = [
  {
    kind: "request",
    id: "req-1",
    name: "Req",
    method: "GET",
    url: "https://api/get",
    body: "",
    config: REQ_CONFIG,
  },
];

const fullRequestDoc = (overrides: Record<string, unknown> = {}) =>
  JSON.stringify({
    name: "Req",
    method: "GET",
    url: "https://api/get",
    body: { type: "text", payload: "" },
    config: REQ_CONFIG,
    ...overrides,
  });

function renderPane(onTreeChange = vi.fn().mockResolvedValue({ ok: true })) {
  return render(
    <ToastProvider>
      <WorkspaceProvider
        tree={tree}
        initialActiveRequestId="req-1"
        httpClient={createFakeHttpClient()}
        onTreeChange={onTreeChange}
      >
        <EditorProbe />
        <RequestPane />
      </WorkspaceProvider>
    </ToastProvider>,
  );
}

async function openSettings(user: ReturnType<typeof userEvent.setup>) {
  const tablist = screen.getByRole("tablist", { name: /request sections/i });
  await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
  await waitFor(() => {
    expect(document.querySelector(".cm-editor")).not.toBeNull();
  });
}

function liveView(): EditorView {
  return EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  )!;
}

async function setDoc(text: string) {
  const view = liveView();
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
}

async function diagnostics(): Promise<Diagnostic[]> {
  const view = liveView();
  forceLinting(view);
  await new Promise((resolve) => setTimeout(resolve, 0));
  await Promise.resolve();
  const out: Diagnostic[] = [];
  forEachDiagnostic(view.state, (d) => {
    out.push(d);
  });
  return out;
}

describe("schema warnings do not block save", () => {
  // AC-004, AC-006 - side-effect-contract: an unknown config key produces a
  // WARNING diagnostic in the live editor, yet save still fires through
  // onTreeChange (the structural parse accepts it; schema lint is advisory).
  it("should warn but still fire onTreeChange if the Settings JSON has an unknown config key", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSettings(user);

    await setDoc(fullRequestDoc({ config: { variables: {}, aut2h: {} } }));

    const diags = await diagnostics();
    expect(diags.some((d) => d.severity === "warning")).toBe(true);
    expect(diags.some((d) => d.severity === "error")).toBe(false);

    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));
    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
  });

  // AC-003, AC-006 - side-effect-contract: a wrong-typed config field produces a
  // WARNING diagnostic yet still saves (valid JSON syntax, advisory schema lint).
  it("should warn but still fire onTreeChange if the Settings JSON has a wrong-typed config field", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSettings(user);

    await setDoc(fullRequestDoc({ config: { timeoutMs: "soon" } }));

    const diags = await diagnostics();
    expect(diags.some((d) => d.severity === "warning")).toBe(true);
    expect(diags.some((d) => d.severity === "error")).toBe(false);

    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));
    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
  });

  // AC-006 - side-effect-contract: malformed JSON (syntax error) blocks save - the
  // existing structural gate makes canSave false, so onTreeChange never fires.
  it("should NOT fire onTreeChange if the Settings JSON is malformed", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSettings(user);

    await setDoc("{ not json");
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTreeChange).not.toHaveBeenCalled();
  });
});
