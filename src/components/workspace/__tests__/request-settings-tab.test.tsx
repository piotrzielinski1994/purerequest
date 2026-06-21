import { describe, it, expect, vi } from "vitest";
import {
  render,
  screen,
  within,
  waitFor,
  fireEvent,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";
import { forceLinting, diagnosticCount } from "@codemirror/lint";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { ToastProvider } from "@/components/ui/toast";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";
import { createFakeHttpClient } from "./fake-http-client";

// Saving is via Mod+S (saveActiveEditor) or the close popup - the per-editor
// Save bar was removed. This probe drives the Mod+S path and surfaces
// popupCanSave (false when the editor JSON is invalid -> popup Save disabled).
function EditorProbe() {
  const { saveActiveEditor, popupCanSave, editorDirty } = useWorkspace();
  return (
    <div>
      <button type="button" onClick={saveActiveEditor}>
        fire shortcut
      </button>
      <span data-testid="popup-can-save">{String(popupCanSave)}</span>
      <span data-testid="editor-dirty">{String(editorDirty)}</span>
    </div>
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

function liveDoc(): string {
  const el = document.querySelector<HTMLElement>(".cm-editor");
  if (!el) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(el);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view.state.doc.toString();
}

function setDoc(text: string) {
  const view = EditorView.findFromDOM(
    document.querySelector<HTMLElement>(".cm-editor")!,
  )!;
  view.dispatch({
    changes: { from: 0, to: view.state.doc.length, insert: text },
  });
}

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

describe("RequestPane Settings sub-tab", () => {
  // behavior: a Settings sub-tab exists alongside the other request sections
  it("should expose a Settings sub-tab in the request sections", () => {
    renderPane();

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    expect(
      within(tablist).getByRole("tab", { name: "Settings" }),
    ).toBeInTheDocument();
  });

  // body is a tagged StoredBody on disk + in the Settings JSON (json -> parsed
  // payload, text -> raw string); default here is an empty text body.
  const fullRequestDoc = (overrides: Record<string, unknown> = {}) =>
    JSON.stringify({
      name: "Req",
      method: "GET",
      url: "https://api/get",
      body: { type: "text", payload: "" },
      config: REQ_CONFIG,
      ...overrides,
    });

  // behavior: the Settings sub-tab shows the WHOLE request (name/method/url/body/config) as JSON
  it("should show the full request as raw JSON in the Settings sub-tab", async () => {
    const user = userEvent.setup();
    renderPane();

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));

    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
    expect(liveDoc()).toBe(
      JSON.stringify(
        {
          name: "Req",
          method: "GET",
          url: "https://api/get",
          body: { type: "text", payload: "" },
          config: REQ_CONFIG,
        },
        null,
        2,
      ),
    );
  });

  // behavior: a JSON body shows as a parsed {type:"json", payload} block in the
  // Settings JSON (the readability win - no escaped "{\n ...}" string).
  it("should show a JSON body as a structured json StoredBody in the Settings JSON", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <WorkspaceProvider
          tree={[
            {
              kind: "request",
              id: "req-1",
              name: "Req",
              method: "POST",
              url: "https://api/get",
              body: '{\n  "grant_type": "client_credentials"\n}',
              config: REQ_CONFIG,
            },
          ]}
          initialActiveRequestId="req-1"
          httpClient={createFakeHttpClient()}
          onTreeChange={vi.fn().mockResolvedValue({ ok: true })}
        >
          <RequestPane />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const doc = JSON.parse(liveDoc()) as { body: unknown };
    expect(doc.body).toEqual({
      type: "json",
      payload: { grant_type: "client_credentials" },
    });
  });

  // behavior: editing the full request (incl. config + body) + Mod+S persists via onTreeChange
  it("should persist the edited full request when the save shortcut fires", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    setDoc(
      fullRequestDoc({
        method: "POST",
        body: { type: "json", payload: { a: 1 } },
        config: { variables: { token: "abc" } },
      }),
    );
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
    const next = onTreeChange.mock.calls[0][0] as TreeNode[];
    const saved = next.find((n) => n.id === "req-1");
    expect(saved?.kind === "request" && saved.method).toBe("POST");
    // a json StoredBody is stored in-memory as the pretty-printed string.
    expect(saved?.kind === "request" && saved.body).toBe(
      JSON.stringify({ a: 1 }, null, 2),
    );
    expect(saved?.config).toEqual({ variables: { token: "abc" } });
  });

  // behavior: saving a new body via the Settings JSON re-syncs the Body tab
  // (the url/method/body override is cleared so the Body tab shows the saved value).
  it("should re-sync the Body tab if the body is edited via the Settings JSON", async () => {
    const user = userEvent.setup();
    renderPane(vi.fn().mockResolvedValue({ ok: true }));

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    setDoc(
      fullRequestDoc({ body: { type: "json", payload: { from: "settings" } } }),
    );
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    // switch to the Body tab; its CM doc reflects the saved body (pretty-printed).
    await user.click(within(tablist).getByRole("tab", { name: "Body" }));
    await waitFor(() => {
      expect(liveDoc()).toBe(JSON.stringify({ from: "settings" }, null, 2));
    });
  });

  // behavior: invalid full-request JSON makes the editor non-saveable (popupCanSave
  // false -> the close popup disables its Save; parseRequest rejects the content).
  const goodBody = { type: "text", payload: "" };
  it.each([
    [
      "a bare old-shape config object",
      JSON.stringify({ variables: { a: "b" } }),
    ],
    ["an array", "[1,2,3]"],
    [
      "a non-string url",
      JSON.stringify({
        name: "R",
        method: "GET",
        url: 5,
        body: goodBody,
        config: {},
      }),
    ],
    [
      "an invalid method",
      JSON.stringify({
        name: "R",
        method: "FETCH",
        url: "u",
        body: goodBody,
        config: {},
      }),
    ],
    [
      "a non-object config",
      JSON.stringify({
        name: "R",
        method: "GET",
        url: "u",
        body: goodBody,
        config: 7,
      }),
    ],
    [
      "a bare-string body (not a StoredBody)",
      JSON.stringify({
        name: "R",
        method: "GET",
        url: "u",
        body: "raw",
        config: {},
      }),
    ],
    [
      "a body with an unknown type",
      JSON.stringify({
        name: "R",
        method: "GET",
        url: "u",
        body: { type: "xml", payload: "" },
        config: {},
      }),
    ],
    ["malformed JSON", "{ not json"],
  ])("should block saving if the Settings JSON is %s", async (_label, doc) => {
    const user = userEvent.setup();
    renderPane();

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    setDoc(doc);
    await waitFor(() => {
      expect(screen.getByTestId("popup-can-save")).toHaveTextContent("false");
    });
  });

  // behavior: malformed Settings JSON shows a red lint diagnostic (the cue that
  // replaced the disabled Save bar).
  it("should flag malformed Settings JSON with a lint diagnostic", async () => {
    const user = userEvent.setup();
    renderPane();

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const view = EditorView.findFromDOM(
      document.querySelector<HTMLElement>(".cm-editor")!,
    )!;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: "{ not json" },
    });
    forceLinting(view);
    await Promise.resolve();

    expect(diagnosticCount(view.state)).toBeGreaterThan(0);
  });

  // behavior: valid Settings JSON keeps the editor saveable.
  it("should keep saving enabled if the Settings JSON is valid", async () => {
    const user = userEvent.setup();
    renderPane();

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    setDoc(fullRequestDoc({ url: "https://edited.test" }));
    await waitFor(() => {
      expect(screen.getByTestId("editor-dirty")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("popup-can-save")).toHaveTextContent("true");
  });

  // AC-009, spec §5 - behavior: editing bodyMode + bodyForm via the Settings JSON
  // and saving persists them onto the request through onTreeChange.
  it("should persist bodyMode and bodyForm edited via the Settings JSON", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    setDoc(
      fullRequestDoc({
        method: "POST",
        bodyMode: "form",
        bodyForm: [{ key: "a", value: "1" }],
      }),
    );
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
    const next = onTreeChange.mock.calls[0][0] as TreeNode[];
    const saved = next.find((n) => n.id === "req-1");
    expect(saved?.kind === "request" && saved.bodyMode).toBe("form");
    expect(saved?.kind === "request" && saved.bodyForm).toEqual([
      { key: "a", value: "1" },
    ]);
  });

  // AC-009 - behavior: a default json request omits bodyMode/bodyForm from the
  // Settings JSON document (minimal, matches the on-disk omission).
  it("should omit bodyMode and bodyForm from the Settings JSON for a default json request", async () => {
    const user = userEvent.setup();
    renderPane();

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const doc = JSON.parse(liveDoc()) as Record<string, unknown>;
    expect("bodyMode" in doc).toBe(false);
    expect("bodyForm" in doc).toBe(false);
  });

  // behavior: a successful save shows a confirmation toast
  it("should show a saved toast when the request persists successfully", async () => {
    const user = userEvent.setup();
    renderPane(vi.fn().mockResolvedValue({ ok: true }));

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    setDoc(fullRequestDoc({ config: { variables: { token: "abc" } } }));
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    expect(await screen.findByText(/saved/i)).toBeInTheDocument();
  });

  // behavior: the save shortcut persists the active request editor without
  // clicking Save (the Mod+S handler routes through saveActiveEditor).
  it("should persist the edited request when the save shortcut fires", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn().mockResolvedValue({ ok: true });
    render(
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

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    const editedConfig = { variables: { token: "via-hotkey" } };
    setDoc(fullRequestDoc({ config: editedConfig }));
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalledTimes(1);
    });
    const next = onTreeChange.mock.calls[0][0] as TreeNode[];
    expect(next.find((n) => n.id === "req-1")?.config).toEqual(editedConfig);
  });

  // behavior: a failed save surfaces an error toast
  it("should show an error toast when the request fails to persist", async () => {
    const user = userEvent.setup();
    renderPane(vi.fn().mockResolvedValue({ ok: false, error: "disk full" }));

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Settings" }));
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    setDoc(fullRequestDoc({ config: { variables: { token: "abc" } } }));
    await user.click(screen.getByRole("button", { name: /fire shortcut/i }));

    expect(await screen.findByText(/disk full/i)).toBeInTheDocument();
  });
});

describe("Request context-menu Edit config opens the Settings sub-tab", () => {
  // behavior: the request row's "Edit config" context-menu item opens the request
  // and activates its Settings sub-tab (NO separate top-level editor tab).
  it("should activate the request Settings sub-tab when Edit config is chosen from the row menu", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider tree={tree} httpClient={createFakeHttpClient()}>
        <SidebarTree />
        <RequestPane />
      </WorkspaceProvider>,
    );

    const treeEl = screen.getByRole("tree", { name: /collection/i });
    const row = within(treeEl).getByRole("treeitem", { name: /Req/i });
    fireEvent.contextMenu(row);
    await user.click(
      await screen.findByRole("menuitem", { name: /^edit$/i }),
    );

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    expect(
      within(tablist).getByRole("tab", { name: "Settings" }),
    ).toHaveAttribute("aria-selected", "true");
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });
  });
});
