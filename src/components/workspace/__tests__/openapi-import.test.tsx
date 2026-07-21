import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import type { OpenapiReader } from "@/lib/openapi/reader";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const mockToast = vi.mocked(toast);

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

// A small doc the fake reader hands back: one operation under the root.
const OPENAPI_TEXT = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Imported API", version: "1.0.0" },
  servers: [{ url: "https://imported.test" }],
  paths: {
    "/ping": { get: { summary: "Ping" } },
  },
});

const NO_OPS_TEXT = JSON.stringify({
  openapi: "3.0.3",
  info: { title: "Empty API", version: "1.0.0" },
  paths: {},
});

function fakeReader(
  result: { name: string; text: string } | null,
): OpenapiReader {
  return { pick: () => Promise.resolve(result) };
}

function renderShell(
  opts: { onTreeChange?: OnTreeChange; openapiReader?: OpenapiReader } = {},
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
        onTreeChange={opts.onTreeChange}
      >
        <WorkspaceLayout openapiReader={opts.openapiReader} />
      </WorkspaceProvider>
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

describe("Import OpenAPI document (AC-012, AC-013)", () => {
  // AC-013, TC-011 - behavior: the palette lists the import command.
  it("should list Import OpenAPI document in the command palette", async () => {
    const user = userEvent.setup();
    renderShell({ openapiReader: fakeReader(null) });
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(
      within(dialog).getByText(/import openapi document/i),
    ).toBeInTheDocument();
  });

  // AC-012, TC-011 - side-effect-contract: running the import with a reader that
  // returns a doc inserts a new top-level folder, visible in the tree and
  // persisted via onTreeChange.
  it("should insert a new top-level folder and persist if the reader returns a doc", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({
      onTreeChange,
      openapiReader: fakeReader({ name: "picked-file", text: OPENAPI_TEXT }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import openapi document/i);

    // the tree is persisted with a new top-level folder named from info.title.
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
      (node) => node.kind === "request" && node.url === "{{baseUrl}}/ping",
    );
    expect(importedRequest).toBeDefined();

    // the new folder is visible in the sidebar tree.
    expect(await screen.findByText("Imported API")).toBeInTheDocument();
  });

  // AC-012, TC-011 - side-effect-contract: a reader that returns null (cancelled)
  // inserts nothing and never persists.
  it("should insert nothing and not persist if the reader returns null", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({ onTreeChange, openapiReader: fakeReader(null) });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import openapi document/i);

    // give the async pick path a chance to settle, then assert it stayed silent.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Imported API")).not.toBeInTheDocument();
  });

  // AC-012, edge §7 - side-effect-contract: a doc with no operations adds no
  // folder and never persists.
  it("should insert nothing and not persist if the doc has no operations", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({
      onTreeChange,
      openapiReader: fakeReader({ name: "picked-file", text: NO_OPS_TEXT }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import openapi document/i);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(onTreeChange).not.toHaveBeenCalled();
    expect(screen.queryByText("Empty API")).not.toBeInTheDocument();
  });

  // AC-012, edge §7 - behavior: a doc with no importable operations surfaces a
  // toast instead of silently doing nothing (so the user gets feedback).
  it("should toast when the doc has no importable operations", async () => {
    const user = userEvent.setup();
    renderShell({
      openapiReader: fakeReader({ name: "picked-file", text: NO_OPS_TEXT }),
    });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import openapi document/i);

    await waitFor(() => {
      expect(
        mockToast.mock.calls.some((c) =>
          /no importable operations/i.test(String(c[0])),
        ),
      ).toBe(true);
    });
  });
});
