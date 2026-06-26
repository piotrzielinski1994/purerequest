import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { Content } from "@/components/workspace/content";
import { Sidebar } from "@/components/workspace/sidebar";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { ToastProvider } from "@/components/ui/toast";
import type { TreeNode } from "@/lib/workspace/model";

const tree: TreeNode[] = [
  {
    kind: "request",
    id: "req-1",
    name: "Req",
    method: "GET",
    url: "https://api/get",
    body: "",
    config: {},
  },
];

function OpenSettings() {
  const { openSettings, saveActiveEditor } = useWorkspace();
  return (
    <>
      <button type="button" onClick={openSettings}>
        open settings
      </button>
      <button type="button" onClick={() => saveActiveEditor()}>
        fire save
      </button>
    </>
  );
}

function renderShell(props: {
  envText?: string;
  onEnvChange?: (text: string) => void;
}) {
  const store = createInMemorySettingsStore({ ...DEFAULT_SETTINGS });
  return render(
    <ToastProvider>
      <SettingsProvider store={store}>
        <WorkspaceProvider tree={tree} {...props}>
          <OpenSettings />
          <Content />
        </WorkspaceProvider>
      </SettingsProvider>
    </ToastProvider>,
  );
}

function allDocs(): string[] {
  return [...document.querySelectorAll<HTMLElement>(".cm-editor")]
    .map((el) => EditorView.findFromDOM(el)?.state.doc.toString())
    .filter((doc): doc is string => doc !== undefined);
}

function envView(): EditorView {
  const view = [...document.querySelectorAll<HTMLElement>(".cm-editor")]
    .map((el) => EditorView.findFromDOM(el))
    .find((v) => v?.state.doc.toString().includes("TOKEN="));
  if (!view) throw new Error("root .env editor not found");
  return view;
}

describe("root .env in the Settings Env section (AC-009)", () => {
  // AC-009, TC-006 - behavior: the Settings view renders an editor seeded with the
  // root .env content.
  it("should render an editor for the root .env if Settings is open", async () => {
    const user = userEvent.setup();
    renderShell({ envText: "TOKEN=root" });

    await user.click(
      await screen.findByRole("button", { name: /open settings/i }),
    );

    expect(
      await screen.findByRole("heading", { name: /^env$/i }),
    ).toBeInTheDocument();
    await waitFor(() => {
      expect(allDocs()).toContain("TOKEN=root");
    });
  });

  // AC-009, TC-006 - side-effect-contract: editing the root .env in Settings and
  // saving persists it via onEnvChange.
  it("should persist the edited root .env via onEnvChange if saved from Settings", async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn();
    renderShell({ envText: "TOKEN=root", onEnvChange });

    await user.click(
      await screen.findByRole("button", { name: /open settings/i }),
    );
    await waitFor(() => {
      expect(allDocs()).toContain("TOKEN=root");
    });
    const view = envView();
    await act(async () => {
      view.dispatch({
        changes: {
          from: 0,
          to: view.state.doc.length,
          insert: "TOKEN=changed",
        },
      });
    });

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onEnvChange).toHaveBeenCalledWith("TOKEN=changed"));
  });
});

describe("sidebar no longer hosts the .env editor (AC-009)", () => {
  // AC-009, TC-006 - behavior: the sidebar has no ".env" edit button.
  it("should not render an Edit .env button in the sidebar", () => {
    render(
      <ToastProvider>
        <WorkspaceProvider tree={tree}>
          <Sidebar />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    expect(
      screen.queryByRole("button", { name: /edit \.env/i }),
    ).not.toBeInTheDocument();
  });
});
