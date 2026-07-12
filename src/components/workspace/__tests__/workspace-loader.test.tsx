import { describe, it, expect } from "vitest";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import { serialize, type FileMap } from "@/lib/workspace/disk-format";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type { OpenapiReader } from "@/lib/openapi/reader";

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
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

function renderLoader(
  workspacePath: string | undefined,
  workspaces = {},
  extraSettings: Partial<typeof DEFAULT_SETTINGS> = {},
) {
  const settingsStore = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    workspacePath,
    ...extraSettings,
  });
  const fs = createInMemoryWorkspaceFs(workspaces);
  return render(
    <SettingsProvider store={settingsStore}>
      <WorkspaceLoader fs={fs} />
    </SettingsProvider>,
  );
}

const envTree: TreeNode[] = [
  {
    kind: "folder",
    id: "pending",
    name: "API",
    config: {
      environments: [
        { name: "prod", variables: [{ key: "baseUrl", value: "https://api.example.com" }] },
      ],
    },
    children: [
      {
        kind: "request",
        id: "pending",
        name: "Get",
        method: "GET",
        url: "{{baseUrl}}/get",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

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
    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // behavior: a configured path that cannot be read mounts a WRITABLE empty
  // workspace (it bootstraps on the first create), NOT the read-only hint.
  it("should mount a writable empty workspace if the workspacePath cannot be read", async () => {
    renderLoader("/ws/missing", {});

    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(screen.queryByText(/set "workspacePath"/i)).not.toBeInTheDocument();
    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // behavior: a configured path whose folder is not a workspace mounts a WRITABLE
  // empty workspace (the first create bootstraps the manifest; reconcile only adds
  // managed files, leaving stray files untouched).
  it("should mount a writable empty workspace if the folder is not a workspace", async () => {
    renderLoader("/ws/bad", { "/ws/bad": { "stray.txt": "hello" } });

    expect(await screen.findByText(/no requests yet/i)).toBeInTheDocument();
    expect(screen.queryByText("Billing")).not.toBeInTheDocument();
    expect(
      screen.getByRole("tree", { name: /collection/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();
  });

  // behavior: a workspacePath pointing at a fresh (unreadable/empty) dir mounts a
  // WRITABLE empty workspace - a created folder persists to that path, so the next
  // load reads it back. (Regression: an unset/fresh path used to be read-only.)
  it("should persist a created folder to a fresh workspacePath dir", async () => {
    const user = userEvent.setup();
    const workspaces: Record<string, FileMap> = {};
    const settingsStore = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      workspacePath: "/ws/fresh",
    });
    const fs = createInMemoryWorkspaceFs(workspaces);
    render(
      <SettingsProvider store={settingsStore}>
        <WorkspaceLoader fs={fs} />
      </SettingsProvider>,
    );

    const tree = await screen.findByRole("tree", { name: /collection/i });
    await user.pointer({ keys: "[MouseRight>]", target: tree });
    await user.click(
      await screen.findByRole("menuitem", { name: /new folder/i }),
    );

    await waitFor(() =>
      expect(workspaces["/ws/fresh"]?.["requi.workspace.json"]).toBeDefined(),
    );
    const written = Object.keys(workspaces["/ws/fresh"] ?? {});
    expect(written.some((path) => path.endsWith("folder.json"))).toBe(true);
  });

  // AC-004, TC-004 - behavior: settings opens as content in the empty shell, then closes.
  it("should open settings as content and close back to the empty shell on the hotkeys", async () => {
    const user = userEvent.setup();
    renderLoader(undefined);

    await screen.findByText(/no workspace/i);

    await user.keyboard("{Control>}{Shift>}s{/Shift}{/Control}");
    expect(
      await screen.findByRole("tablist", { name: /settings sections/i }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("region", { name: /console/i }),
    ).toBeInTheDocument();

    await user.keyboard("{Escape}");
    await waitFor(() => {
      expect(
        screen.queryByRole("tablist", { name: /settings sections/i }),
      ).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
  });

  // AC-003 - behavior: a persisted active env present in the tree stays active
  it("should keep the persisted active environment if it exists in the tree", async () => {
    renderLoader(
      "/ws/env",
      { "/ws/env": serialize(envTree, "Env") },
      { activeEnvironment: "prod" },
    );

    const trigger = await screen.findByRole("combobox", {
      name: /environment/i,
    });
    expect(trigger).toHaveTextContent("prod");
  });

  // AC-003, TC-002 - behavior: a persisted active env absent from the tree falls back
  it("should fall back to No Environment if the persisted active env is not in the tree", async () => {
    renderLoader(
      "/ws/env",
      { "/ws/env": serialize(envTree, "Env") },
      { activeEnvironment: "ghost" },
    );

    await screen.findByText("API");
    const trigger = screen.getByRole("combobox", { name: /environment/i });
    expect(trigger).toHaveTextContent(/no environment/i);
  });

  // regression: the loaded-workspace branch must thread the openapiReader through
  // to the layout (an earlier miss left it wired only in the empty branch, so the
  // import action silently no-op'd on a real workspace). Running the import command
  // with a reader that returns a doc must reach the reader + insert the folder.
  it("should thread the openapiReader to the loaded workspace so the import runs", async () => {
    const user = userEvent.setup();
    const openapiText = JSON.stringify({
      openapi: "3.0.3",
      info: { title: "Threaded API", version: "1.0.0" },
      paths: { "/ping": { get: { summary: "Ping" } } },
    });
    const openapiReader: OpenapiReader = {
      pick: () => Promise.resolve({ name: "picked", text: openapiText }),
    };
    const settingsStore = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      workspacePath: "/ws/demo",
    });
    const fs = createInMemoryWorkspaceFs({
      "/ws/demo": serialize(sampleTree, "Demo"),
    });
    render(
      <SettingsProvider store={settingsStore}>
        <WorkspaceLoader fs={fs} openapiReader={openapiReader} />
      </SettingsProvider>,
    );
    await screen.findByText("Billing");

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText(/import openapi document/i));

    expect(await screen.findByText("Threaded API")).toBeInTheDocument();
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
