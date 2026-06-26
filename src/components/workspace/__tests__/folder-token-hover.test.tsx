import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { FolderPane } from "@/components/workspace/folder-pane";
import { ToastProvider } from "@/components/ui/toast";
import type { TreeNode } from "@/lib/workspace/model";

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: { variables: { apiBase: "{{process.env.HOST}}/v1" } },
    dotenv: "HOST=https://folder.example.com",
    children: [],
  },
];

function Probe() {
  const { openConfigEditor } = useWorkspace();
  return (
    <button type="button" onClick={() => openConfigEditor("folder-1")}>
      open folder config
    </button>
  );
}

// Regression: a folder pane previously passed `effective: null` to its panels,
// so a {{token}} chip rendered as a bare span with NO hover card. The folder now
// resolves its own scope chain, so its chips hover/preview like a request's.
describe("folder pane {{token}} hover", () => {
  it("should show the resolved value if a folder Vars token is hovered", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <WorkspaceProvider tree={tree}>
          <Probe />
          <FolderPane />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    await user.click(
      screen.getByRole("button", { name: /open folder config/i }),
    );

    // The Vars tab is the folder pane default; the value cell shows the token.
    await user.hover(await screen.findByText("{{process.env.HOST}}"));

    // The hover card resolves the folder `.env` value (folded over the chain).
    expect(
      await screen.findByDisplayValue("https://folder.example.com"),
    ).toBeInTheDocument();
  });
});
