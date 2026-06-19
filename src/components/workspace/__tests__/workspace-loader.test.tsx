import { describe, it, expect } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import { serialize } from "@/lib/workspace/disk-format";
import type { TreeNode } from "@/lib/workspace/model";

const sampleTree: TreeNode[] = [
  {
    kind: "folder",
    id: "pending",
    name: "Billing",
    config: {},
    children: [
      {
        kind: "request",
        id: "pending",
        name: "List Invoices",
        method: "GET",
        url: "https://api/invoices",
        body: "",
        config: {},
      },
    ],
  },
];

function renderLoader(workspacePath: string | undefined, workspaces = {}) {
  const settingsStore = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    workspacePath,
  });
  const fs = createInMemoryWorkspaceFs(workspaces);
  return render(
    <SettingsProvider store={settingsStore}>
      <WorkspaceLoader fs={fs} />
    </SettingsProvider>,
  );
}

describe("WorkspaceLoader", () => {
  // AC-011, TC-007 - behavior
  it("should render the loaded workspace tree if workspacePath points to a workspace", async () => {
    const files = serialize(sampleTree, "Demo");

    renderLoader("/ws/demo", { "/ws/demo": files });

    expect(await screen.findByText("Billing")).toBeInTheDocument();
  });

  // AC-004, TC-004 - behavior: empty workspace still mounts the shell (sidebar + console).
  it("should mount the shell with a No workspace hint if no workspacePath is set", async () => {
    renderLoader(undefined);

    expect(await screen.findByText(/no workspace/i)).toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(screen.getByRole("tree", { name: /collection/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /console/i })).toBeInTheDocument();
  });

  // AC-004 - behavior
  it("should mount the shell with a No workspace hint if the workspacePath cannot be read", async () => {
    renderLoader("/ws/missing", {});

    expect(await screen.findByText(/no workspace/i)).toBeInTheDocument();
    expect(screen.getByRole("tree", { name: /collection/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /console/i })).toBeInTheDocument();
  });

  // AC-004, E-6 - behavior
  it("should mount the shell with a No workspace hint if the folder is not a workspace", async () => {
    renderLoader("/ws/bad", { "/ws/bad": { "stray.txt": "hello" } });

    expect(await screen.findByText(/no workspace/i)).toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(screen.getByRole("tree", { name: /collection/i })).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /console/i })).toBeInTheDocument();
  });

  // AC-004, TC-004 - behavior: settings opens as content in the empty shell, then closes.
  it("should open settings as content and close back to the empty shell on the hotkeys", async () => {
    const user = userEvent.setup();
    renderLoader(undefined);

    await screen.findByText(/no workspace/i);

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(
      await screen.findByRole("heading", { name: /keyboard shortcuts/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("region", { name: /console/i })).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("heading", { name: /keyboard shortcuts/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
  });

  // AC-009, E-7 - behavior: partial load surfaces skipped files in the console
  it("should load the good nodes and surface a skipped malformed file", async () => {
    const files = {
      "requi.workspace.json": JSON.stringify({
        schemaVersion: 1,
        name: "Partial",
      }),
      "good.req.json": JSON.stringify({
        name: "Good Request",
        method: "GET",
        url: "https://api/good",
        body: "",
        config: {},
      }),
      "broken.req.json": "{ not valid json",
    };

    renderLoader("/ws/partial", { "/ws/partial": files });

    expect(await screen.findByText("Good Request")).toBeInTheDocument();
    expect(screen.getByText(/skipped malformed file/i)).toBeInTheDocument();
    expect(screen.getByText(/broken\.req\.json/)).toBeInTheDocument();
  });
});
