import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import type { PostmanFileMap } from "@/lib/postman/postman-to-tree";
import type { PostmanExportWriter } from "@/lib/postman/writer";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

function req(id: string, name: string, url: string): RequestNode {
  return {
    kind: "request",
    id,
    name,
    method: "GET",
    url,
    body: emptyBody(),
    params: emptyParams(),
    config: {},
  };
}

function folder(id: string, name: string, children: TreeNode[]): FolderNode {
  return { kind: "folder", id, name, config: {}, children };
}

const usersFolder = folder("f-users", "Users", [
  req("r-get", "Get Users", "https://api.example.com/users"),
]);
const topReq = req("r-top", "Top Req", "https://api.example.com/top");
const baseTree: TreeNode[] = [usersFolder, topReq];

type SaveCall = { files: PostmanFileMap; suggestedName: string };

function fakeWriter(result = true) {
  const calls: SaveCall[] = [];
  const writer: PostmanExportWriter = {
    save: (files, suggestedName) => {
      calls.push({ files, suggestedName });
      return Promise.resolve(result);
    },
  };
  return { calls, writer };
}

function collectionInfoName(files: PostmanFileMap): string {
  const path = Object.keys(files).find((p) =>
    p.endsWith(".postman_collection.json"),
  );
  if (path === undefined) {
    throw new Error("no collection file emitted");
  }
  return JSON.parse(files[path]).info.name as string;
}

function renderShell(
  writer: PostmanExportWriter,
  workspaceName = "My Workspace",
) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={baseTree}
        consoleLines={["[12:00:00] Ready."]}
        postmanWriter={writer}
        workspaceName={workspaceName}
      >
        <WorkspaceLayout />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

describe("Export as Postman - folder context menu (AC-012)", () => {
  // TC-015 - behavior: a folder row's context menu offers Export as Postman; a
  // request row's does not.
  it("should show Export as Postman on a folder row menu but not on a request row menu", async () => {
    const user = userEvent.setup();
    const { writer } = fakeWriter();
    renderShell(writer);
    await screen.findByRole("region", { name: /console/i });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("Users"),
    });
    const folderMenu = await screen.findByRole("menu");
    expect(
      within(folderMenu).getByText(/export as postman/i),
    ).toBeInTheDocument();
    await user.keyboard("{Escape}");

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("Top Req"),
    });
    const requestMenu = await screen.findByRole("menu");
    expect(
      within(requestMenu).queryByText(/export as postman/i),
    ).not.toBeInTheDocument();
  });

  // TC-016 - side-effect-contract: clicking the folder menu item exports THAT
  // folder as the collection root (suggestedName = folder name).
  it("should export the folder subtree when its menu item is clicked", async () => {
    const user = userEvent.setup();
    const { calls, writer } = fakeWriter();
    renderShell(writer);
    await screen.findByRole("region", { name: /console/i });

    await user.pointer({
      keys: "[MouseRight]",
      target: screen.getByText("Users"),
    });
    const menu = await screen.findByRole("menu");
    await user.click(within(menu).getByText(/export as postman/i));

    expect(calls).toHaveLength(1);
    expect(calls[0].suggestedName).toBe("Users");
    expect(collectionInfoName(calls[0].files)).toBe("Users");
  });
});

describe("Export as Postman - command palette (AC-013)", () => {
  async function runPalette(user: ReturnType<typeof userEvent.setup>) {
    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");
    await user.click(within(dialog).getByText(/export as postman collection/i));
  }

  // TC-017 - side-effect-contract: with no folder selected, the palette command
  // exports the whole workspace wrapped in a synthetic root named after the ws.
  it("should export the whole workspace named after the workspace if nothing is selected", async () => {
    const user = userEvent.setup();
    const { calls, writer } = fakeWriter();
    renderShell(writer, "My Workspace");
    await screen.findByRole("region", { name: /console/i });

    await runPalette(user);

    expect(calls).toHaveLength(1);
    expect(calls[0].suggestedName).toBe("My Workspace");
    expect(collectionInfoName(calls[0].files)).toBe("My Workspace");
  });

  // TC-016 - side-effect-contract: with a folder selected, the palette command
  // exports that folder as the collection root.
  it("should export the selected folder when one is selected", async () => {
    const user = userEvent.setup();
    const { calls, writer } = fakeWriter();
    renderShell(writer);
    await screen.findByRole("region", { name: /console/i });

    await user.click(screen.getByText("Users"));
    await runPalette(user);

    expect(calls).toHaveLength(1);
    expect(calls[0].suggestedName).toBe("Users");
  });
});
