import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

// A POST request with a JSON body so Copy as cURL produces a --data-raw arg.
const postWithBody: RequestNode = {
  kind: "request",
  id: "req-post",
  name: "create-widget",
  method: "POST",
  url: "https://api.example.com/widgets",
  body: {
    active: "json",
    types: {
      json: '{"name":"foo"}',
      form: [],
      multipart: [],
      graphql: { query: "", variables: "" },
    },
  },
  params: emptyParams(),
  config: {
    headers: [{ key: "X-Trace", value: "abc" }],
    auth: authOf({ active: "none" }),
  },
};

const sessionRequest: RequestNode = {
  kind: "request",
  id: "req-session",
  name: "session",
  method: "DELETE",
  url: "https://api.example.com/session",
  body: emptyBody(),
  params: emptyParams(),
  config: { auth: authOf({ active: "none" }) },
};

const exportTree: TreeNode[] = [postWithBody, sessionRequest];

const collect = (nodes: TreeNode[]): TreeNode[] =>
  nodes.flatMap((node) =>
    node.kind === "folder" ? [node, ...collect(node.children)] : [node],
  );

function renderShell(
  opts: { initialActiveRequestId?: string; onTreeChange?: OnTreeChange } = {},
) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={exportTree}
        consoleLines={["[12:00:00] Ready."]}
        initialActiveRequestId={opts.initialActiveRequestId}
        onTreeChange={opts.onTreeChange}
      >
        <WorkspaceLayout />
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

const VALID_CURL =
  "curl -X POST 'https://api.example.com/imported' -H 'A: 1' -d 'x=1'";

describe("Import cURL dialog (AC-010)", () => {
  // AC-010, TC-008 - behavior: the import action opens a dialog with a textarea
  // and a disabled Import button while empty.
  it("should open an import dialog with a disabled Import button while empty", async () => {
    const user = userEvent.setup();
    renderShell({ initialActiveRequestId: "req-post" });
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /import curl/i);

    const dialog = await screen.findByRole("dialog");
    expect(within(dialog).getByRole("textbox")).toBeInTheDocument();
    expect(
      within(dialog).getByRole("button", { name: /^import$/i }),
    ).toBeDisabled();
  });

  // AC-010, TC-008 - side-effect-contract: confirming a valid curl creates a new
  // request node (opened tab) and persists via onTreeChange.
  it("should create a new request tab and persist if a valid curl is imported", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({ initialActiveRequestId: "req-post", onTreeChange });
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(1);

    await runPaletteCommand(user, /import curl/i);
    const dialog = await screen.findByRole("dialog");

    await user.type(within(dialog).getByRole("textbox"), VALID_CURL);
    await user.click(within(dialog).getByRole("button", { name: /^import$/i }));

    // the dialog closes, a second tab opens, and the tree is persisted.
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(2);
    expect(onTreeChange).toHaveBeenCalled();

    // the persisted tree gained a request whose url is the imported one.
    const persisted = onTreeChange.mock.calls.at(-1)![0];
    const imported = collect(persisted).find(
      (node) =>
        node.kind === "request" &&
        node.url === "https://api.example.com/imported",
    );
    expect(imported).toBeDefined();
    expect(imported?.kind === "request" && imported.method).toBe("POST");
    // the request name is the full imported url (with domain), not a derived path.
    expect(imported?.name).toBe("https://api.example.com/imported");
  });

  // AC-010, TC-008 - side-effect-contract: Cancel makes nothing (no new tab, no
  // persist).
  it("should make nothing if the import dialog is cancelled", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({ initialActiveRequestId: "req-post", onTreeChange });
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });

    await runPaletteCommand(user, /import curl/i);
    const dialog = await screen.findByRole("dialog");
    await user.type(within(dialog).getByRole("textbox"), VALID_CURL);
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(within(tablist).getAllByRole("tab")).toHaveLength(1);
    expect(onTreeChange).not.toHaveBeenCalled();
  });

  // AC-010 - behavior: an invalid paste shows an inline error, keeps the dialog
  // open, and creates no node.
  it("should show an inline error and keep the dialog open if the curl is invalid", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderShell({ initialActiveRequestId: "req-post", onTreeChange });
    await screen.findByRole("region", { name: /console/i });

    const tablist = screen.getByRole("tablist", { name: /open requests/i });

    await runPaletteCommand(user, /import curl/i);
    const dialog = await screen.findByRole("dialog");

    // a bare 'curl' with no url is invalid (AC-009).
    await user.type(within(dialog).getByRole("textbox"), "curl");
    await user.click(within(dialog).getByRole("button", { name: /^import$/i }));

    // the dialog stays open, no tab was added, nothing persisted. The open modal
    // inerts the background, so the lone existing tab is queried with hidden:true.
    expect(screen.getByRole("dialog")).toBeInTheDocument();
    expect(within(tablist).getAllByRole("tab", { hidden: true })).toHaveLength(
      1,
    );
    expect(onTreeChange).not.toHaveBeenCalled();
    // an inline error is surfaced inside the dialog.
    expect(within(dialog).getByText(/no url found/i)).toBeInTheDocument();
  });
});
