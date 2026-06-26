import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { FolderPane } from "@/components/workspace/folder-pane";
import { ContentHeader } from "@/components/workspace/content-header";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import { ToastProvider } from "@/components/ui/toast";
import type { FolderNode, TreeNode } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: { environments: { prod: { baseUrl: "https://old" } } },
    dotenv: "EXISTING=keep",
    children: [
      {
        kind: "request",
        id: "req-1",
        name: "Req",
        method: "GET",
        url: "https://api/get",
        body: "",
        config: {},
      },
    ],
  },
];

function FolderProbe() {
  const { openConfigEditor, saveActiveEditor } = useWorkspace();
  return (
    <div>
      <button type="button" onClick={() => openConfigEditor("folder-1")}>
        open folder config
      </button>
      <button type="button" onClick={() => saveActiveEditor()}>
        fire save
      </button>
    </div>
  );
}

function renderFolder(onTreeChange: OnTreeChange) {
  return render(
    <ToastProvider>
      <WorkspaceProvider tree={tree} onTreeChange={onTreeChange}>
        <ContentHeader />
        <FolderProbe />
        <FolderPane />
        <CloseConfirmDialog />
      </WorkspaceProvider>
    </ToastProvider>,
  );
}

const openFolderConfig = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /open folder config/i }));

const openFolderTab = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const tablist = screen.getByRole("tablist", { name: /folder sections/i });
  await user.click(within(tablist).getByRole("tab", { name }));
};

const openEnvSubView = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const subbar = await screen.findByRole("tablist", { name: /env views/i });
  await user.click(within(subbar).getByRole("tab", { name }));
};

const savedFolder = (onTreeChange: ReturnType<typeof vi.fn>): FolderNode => {
  const calls = onTreeChange.mock.calls;
  const lastTree = calls[calls.length - 1][0] as TreeNode[];
  const folder = lastTree.find((n) => n.id === "folder-1");
  if (!folder || folder.kind !== "folder") {
    throw new Error("folder-1 not found in persisted tree");
  }
  return folder;
};

describe("folder Env tab (AC-005)", () => {
  // AC-005 - behavior: an Env tab appears before Settings in the folder sub-tabs.
  it("should render an Env tab before Settings if a folder is open", async () => {
    const user = userEvent.setup();
    renderFolder(vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }));
    await openFolderConfig(user);

    const tablist = await screen.findByRole("tablist", {
      name: /folder sections/i,
    });
    const tabs = within(tablist)
      .getAllByRole("tab")
      .map((tab) => tab.textContent);
    expect(tabs).toContain("Env");
    expect(tabs.indexOf("Env")).toBeLessThan(tabs.indexOf("Settings"));
  });

  // AC-005 - behavior: the Env tab body has an "Envs"/".env" sub-bar.
  it("should render an Envs and a .env sub-view if the Env tab is open", async () => {
    const user = userEvent.setup();
    renderFolder(vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }));
    await openFolderConfig(user);
    await openFolderTab(user, "Env");

    const subbar = await screen.findByRole("tablist", { name: /env views/i });
    expect(within(subbar).getByRole("tab", { name: "Envs" })).toBeInTheDocument();
    expect(
      within(subbar).getByRole("tab", { name: ".env" }),
    ).toBeInTheDocument();
  });
});

describe("folder Env tab - Envs view (AC-006)", () => {
  // AC-006 - behavior: the env picker lists env names from the tree union.
  it("should list the folder's own env name in the picker if the Envs view is open", async () => {
    const user = userEvent.setup();
    renderFolder(vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }));
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    const picker = await screen.findByRole("combobox", { name: /env/i });
    expect(picker).toBeInTheDocument();
    expect(screen.getByText("prod")).toBeInTheDocument();
  });

  // AC-006, TC-004 - side-effect-contract: editing a picked env's var persists into
  // config.environments[picked] on save.
  it("should persist an edited env variable into config.environments on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    const valueInput = await screen.findByDisplayValue("https://old");
    await user.clear(valueInput);
    await user.type(valueInput, "https://api");
    await user.tab();

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedFolder(onTreeChange).config.environments?.prod).toEqual({
      baseUrl: "https://api",
    });
  });

  // AC-006 - behavior: a new env is added through a modal (a "+" button opens it,
  // a name field + Add creates it), NOT an always-visible inline input.
  it("should add a new env through the add-environment modal", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    // No inline name input in the bar - only the "+" button opens the modal.
    expect(
      screen.queryByLabelText("New environment name"),
    ).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /add environment/i }));
    await user.type(
      await screen.findByRole("textbox", { name: /environment name/i }),
      "qa",
    );
    await user.click(screen.getByRole("button", { name: /^add$/i }));

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedFolder(onTreeChange).config.environments?.qa).toEqual({});
  });

  // AC-006 - side-effect-contract: deleting the picked env asks for confirmation
  // first, then removes it from config.environments on save.
  it("should remove the picked env from config.environments on confirmed delete + save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    await user.click(
      await screen.findByRole("button", { name: /delete environment prod/i }),
    );
    // A confirm dialog appears; the env is not gone until the user confirms.
    await user.click(
      await screen.findByRole("button", { name: /^delete$/i }),
    );
    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedFolder(onTreeChange).config.environments?.prod).toBeUndefined();
  });

  // AC-006 - behavior: cancelling the delete confirm keeps the env.
  it("should keep the env if the delete confirm is cancelled", async () => {
    const user = userEvent.setup();
    renderFolder(vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }));
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    await user.click(
      await screen.findByRole("button", { name: /delete environment prod/i }),
    );
    await user.click(await screen.findByRole("button", { name: /cancel/i }));

    expect(screen.getByText("prod")).toBeInTheDocument();
  });
});

describe("folder Env tab - .env view (AC-007)", () => {
  // AC-007 - behavior: the .env view shows rows parsed from the folder dotenv.
  it("should render a row parsed from the folder dotenv if the .env view is open", async () => {
    const user = userEvent.setup();
    renderFolder(vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }));
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, ".env");

    expect(await screen.findByDisplayValue("EXISTING")).toBeInTheDocument();
    expect(screen.getByDisplayValue("keep")).toBeInTheDocument();
  });

  // AC-007, AC-008, TC-005 - side-effect-contract: adding a .env row and saving
  // persists the rebuilt folder dotenv as KEY=value lines.
  it("should persist a new .env row into the folder dotenv on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, ".env");

    // one real row (EXISTING) + the trailing blank => the blank's inputs are "2".
    await user.type(await screen.findByLabelText("key 2"), "KEY");
    await user.type(screen.getByLabelText("value 2"), "secret");
    await user.tab();

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const dotenv = savedFolder(onTreeChange).dotenv ?? "";
    expect(dotenv).toContain("KEY=secret");
    expect(dotenv).toContain("EXISTING=keep");
  });
});

describe("folder Env tab - single-write save + dirty (AC-008)", () => {
  // AC-008 - side-effect-contract: a .env edit AND a config edit persist in ONE
  // tree write that carries both.
  it("should persist both config and dotenv in a single tree write on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange);
    await openFolderConfig(user);
    await openFolderTab(user, "Env");

    // edit an env var (Envs view)
    await openEnvSubView(user, "Envs");
    const valueInput = await screen.findByDisplayValue("https://old");
    await user.clear(valueInput);
    await user.type(valueInput, "https://api");
    await user.tab();

    // edit the .env (.env view)
    await openEnvSubView(user, ".env");
    await user.type(await screen.findByLabelText("key 2"), "KEY");
    await user.type(screen.getByLabelText("value 2"), "secret");
    await user.tab();

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    const folder = savedFolder(onTreeChange);
    expect(folder.config.environments?.prod).toEqual({ baseUrl: "https://api" });
    expect(folder.dotenv ?? "").toContain("KEY=secret");
  });

  // AC-008 - behavior: editing the .env sub-view marks the folder editor dirty.
  it("should mark the folder editor dirty if a .env row is edited", async () => {
    const user = userEvent.setup();
    renderFolder(vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }));
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, ".env");

    await user.type(await screen.findByLabelText("key 2"), "NEW");
    await user.type(screen.getByLabelText("value 2"), "v");
    await user.tab();

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    await waitFor(() =>
      expect(
        within(tablist).queryByLabelText(/unsaved changes/i),
      ).toBeInTheDocument(),
    );
  });
});
