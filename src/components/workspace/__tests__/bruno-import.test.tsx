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
import type {
  BrunoCollectionReader,
} from "@/lib/bruno/reader";
import type { BrunoFileMap } from "@/lib/bruno/bruno-to-tree";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

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
const COLLECTION_FILES: BrunoFileMap = {
  "bruno.json": '{ "name": "Imported API", "version": "1" }',
  "ping.bru":
    "meta {\n  name: Ping\n}\nget {\n  url: https://imported.test/ping\n}",
};

function fakeReader(
  result: { name: string; files: BrunoFileMap } | null,
): BrunoCollectionReader {
  return { pick: () => Promise.resolve(result) };
}

function renderShell(
  opts: {
    onTreeChange?: OnTreeChange;
    reader?: BrunoCollectionReader;
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
          <WorkspaceLayout reader={opts.reader} />
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

describe("Import Bruno collection (AC-009, AC-010)", () => {
  // AC-010, TC-008 - behavior: the palette lists the import command.
  it("should list Import Bruno collection in the command palette", async () => {
    const user = userEvent.setup();
    renderShell({ reader: fakeReader(null) });
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(/import bruno collection/i),
    ).toBeInTheDocument();
  });

  // AC-009/010, TC-008 - side-effect-contract: running the import with a reader
  // that returns a collection inserts a new top-level folder, visible in the
  // tree and persisted via onTreeChange.
  it("should insert a new top-level folder and persist if the reader returns a collection", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({
      onTreeChange,
      reader: fakeReader({ name: "picked-dir", files: COLLECTION_FILES }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import bruno collection/i);

    // the tree is persisted with a new top-level folder named from bruno.json.
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
    expect(
      await screen.findByText("Imported API"),
    ).toBeInTheDocument();
  });

  // AC-009/010, TC-008 - side-effect-contract: a reader that returns null
  // (cancelled / empty) inserts nothing and never persists.
  it("should insert nothing and not persist if the reader returns null", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({ onTreeChange, reader: fakeReader(null) });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import bruno collection/i);

    // give the async pick path a chance to settle, then assert it stayed silent.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Imported API")).not.toBeInTheDocument();
  });

  // AC-012, TC-008 - side-effect-contract: an OpenCollection YAML collection
  // (opencollection.yml + .yml requests) imports the same way as a .bru one.
  it("should import an OpenCollection YAML collection and persist a new top-level folder", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const yamlFiles: BrunoFileMap = {
      "opencollection.yml": "opencollection: 1.0.0\ninfo:\n  name: YAML API",
      "get-thing.yml":
        "info:\n  name: Get Thing\nhttp:\n  method: GET\n  url: https://yaml.test/thing\n  auth:\n    type: bearer\n    token: t",
    };
    renderShell({
      onTreeChange,
      reader: fakeReader({ name: "picked-dir", files: yamlFiles }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import bruno collection/i);

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
    const persisted = onTreeChange.mock.calls.at(-1)![0];
    expect(
      persisted.some(
        (node) => node.kind === "folder" && node.name === "YAML API",
      ),
    ).toBe(true);
    const importedRequest = collect(persisted).find(
      (node) =>
        node.kind === "request" && node.url === "https://yaml.test/thing",
    );
    expect(importedRequest).toBeDefined();
    expect(await screen.findByText("YAML API")).toBeInTheDocument();
  });

  // side-effect-contract: a collection's own .env attaches to the imported
  // folder node's dotenv (serializes to <folder>/.env), NOT the workspace root
  // .env - and the root .env is left untouched.
  it("should attach the collection .env to the imported folder, not the workspace env", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const onEnvChange = vi.fn<(text: string) => void>();
    const filesWithEnv: BrunoFileMap = {
      "bruno.json": '{ "name": "Env API" }',
      "ping.yml": "info:\n  name: ping\nhttp:\n  method: GET\n  url: https://x.test",
      ".env": "CULTURE=en-CA\nBEARER_TOKEN=abc",
    };
    render(
      <SettingsProvider
        store={createInMemorySettingsStore({
          ...DEFAULT_SETTINGS,
          shortcuts: {},
        })}
      >
        <ToastProvider>
          <WorkspaceProvider
            tree={baseTree}
            consoleLines={["[12:00:00] Ready."]}
            onTreeChange={onTreeChange}
            envText="HOST=local"
            onEnvChange={onEnvChange}
          >
            <WorkspaceLayout
              reader={fakeReader({ name: "picked-dir", files: filesWithEnv })}
            />
          </WorkspaceProvider>
        </ToastProvider>
      </SettingsProvider>,
    );
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import bruno collection/i);

    await waitFor(() => {
      expect(onTreeChange).toHaveBeenCalled();
    });
    const persisted = onTreeChange.mock.calls.at(-1)![0];
    const importedFolder = persisted.find(
      (node) => node.kind === "folder" && node.name === "Env API",
    );
    expect(importedFolder).toBeDefined();
    // the imported folder carries the collection .env on its own dotenv.
    const dotenv = (importedFolder as { dotenv?: string }).dotenv ?? "";
    expect(dotenv).toContain("CULTURE=en-CA");
    expect(dotenv).toContain("BEARER_TOKEN=abc");
    // the workspace root .env is never touched by the import.
    expect(onEnvChange).not.toHaveBeenCalled();
  });

  // AC-009, edge §8 - side-effect-contract: a collection with no requests and no
  // child folders (only bruno.json) adds no folder and never persists.
  it("should insert nothing and not persist if the collection is empty", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({
      onTreeChange,
      reader: fakeReader({
        name: "picked-dir",
        files: { "bruno.json": '{ "name": "Empty API" }' },
      }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import bruno collection/i);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Empty API")).not.toBeInTheDocument();
  });
});
