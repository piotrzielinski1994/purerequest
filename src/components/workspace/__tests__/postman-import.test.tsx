import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { ToastProvider } from "@/components/ui/toast";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import type { PostmanCollectionReader } from "@/lib/postman/reader";
import type { PostmanFileMap } from "@/lib/postman/postman-to-tree";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const SCHEMA =
  "https://schema.getpostman.com/json/collection/v2.1.0/collection.json";

const seedRequest: RequestNode = {
  kind: "request",
  id: "req-seed",
  name: "seed",
  method: "GET",
  url: "https://api.example.com/seed",
  body: emptyBody(),
  params: emptyParams(),
  config: { auth: authOf({ active: "none" }) },
};

const baseTree: TreeNode[] = [seedRequest];

const collect = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) =>
    node.kind === "folder" ? [node, ...collect(node.children)] : [node],
  );

// A small collection the fake reader hands back: one request under the root.
const COLLECTION_FILES: PostmanFileMap = {
  "Imported API.postman_collection.json": JSON.stringify({
    info: { name: "Imported API", schema: SCHEMA },
    item: [
      {
        name: "Ping",
        request: { method: "GET", url: { raw: "https://imported.test/ping" } },
      },
    ],
  }),
};

function fakeReader(
  result: { name: string; files: PostmanFileMap } | null,
): PostmanCollectionReader {
  return { pick: () => Promise.resolve(result) };
}

function renderShell(
  opts: {
    onTreeChange?: OnTreeChange;
    postmanReader?: PostmanCollectionReader;
  } = {},
) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <ToastProvider>
        <WorkspaceProvider
          tree={baseTree}
          consoleLines={["[12:00:00] Ready."]}
          onTreeChange={opts.onTreeChange}
        >
          <WorkspaceLayout postmanReader={opts.postmanReader} />
        </WorkspaceProvider>
      </ToastProvider>
    </SettingsProvider>,
  );
}

async function runPaletteCommand(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByText(name));
}

describe("Import Postman collection (AC-010, AC-011)", () => {
  // AC-011, TC-009 - behavior: the palette lists the import command.
  it("should list Import Postman collection in the command palette", async () => {
    const user = userEvent.setup();
    renderShell({ postmanReader: fakeReader(null) });
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(/import postman collection/i),
    ).toBeInTheDocument();
  });

  // AC-010, TC-009 - side-effect-contract: running the import with a reader that
  // returns a collection inserts a new top-level folder, visible in the tree and
  // persisted via onTreeChange.
  it("should insert a new top-level folder and persist if the reader returns a collection", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({
      onTreeChange,
      postmanReader: fakeReader({
        name: "picked-dir",
        files: COLLECTION_FILES,
      }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import postman collection/i);

    // the tree is persisted with a new top-level folder named from info.name.
    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
    const persisted = onTreeChange.mock.calls.at(-1)![0];
    const importedFolder = persisted.find(
      (node) => node.kind === "folder" && node.name === "Imported API",
    );
    expect(importedFolder).toBeDefined();
    // the seed request still sits at the root - the import is additive.
    expect(
      persisted.some(
        (node) => node.kind === "request" && node.id === "req-seed",
      ),
    ).toBe(true);
    // the imported request lives inside the new folder.
    const importedRequest = collect(persisted).find(
      (node) =>
        node.kind === "request" && node.url === "https://imported.test/ping",
    );
    expect(importedRequest).toBeDefined();

    // the new folder is visible in the sidebar tree.
    expect(await screen.findByText("Imported API")).toBeInTheDocument();
  });

  // AC-010, TC-009 - side-effect-contract: a reader that returns null (cancelled)
  // inserts nothing and never persists.
  it("should insert nothing and not persist if the reader returns null", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({ onTreeChange, postmanReader: fakeReader(null) });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import postman collection/i);

    // give the async pick path a chance to settle, then assert it stayed silent.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Imported API")).not.toBeInTheDocument();
  });

  // AC-010, edge §8 - side-effect-contract: an empty collection (no requests and
  // no child folders) adds no folder and never persists.
  it("should insert nothing and not persist if the collection is empty", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({
      onTreeChange,
      postmanReader: fakeReader({
        name: "picked-dir",
        files: {
          "Empty API.postman_collection.json": JSON.stringify({
            info: { name: "Empty API", schema: SCHEMA },
            item: [],
          }),
        },
      }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import postman collection/i);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Empty API")).not.toBeInTheDocument();
  });
});
