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

  // AC-009 - behavior: the panel env picker is scoped to the OPEN folder's chain,
  // matching the sidebar combobox. A folder with no own env, whose only tree-mate is
  // a SIBLING defining `staging`, must show "No environment" (not the sibling's env)
  // on the picker trigger. Guards the panel/sidebar divergence where the panel used
  // the whole-tree union and offered a sibling-only env the sidebar never listed.
  // (Radix Select items aren't in the DOM while closed under jsdom, per
  // docs/learnings.md, so this asserts the trigger's shown value, not menu items.)
  it("should show No environment if the open folder's chain defines no env, even when a sibling has one", async () => {
    const user = userEvent.setup();
    const siblingTree: TreeNode[] = [
      {
        kind: "folder",
        id: "folder-1",
        name: "Folder",
        config: {},
        children: [],
      },
      {
        kind: "folder",
        id: "folder-2",
        name: "Sibling",
        config: { environments: { staging: {} } },
        children: [],
      },
    ];
    render(
      <ToastProvider>
        <WorkspaceProvider
          tree={siblingTree}
          onTreeChange={vi.fn<OnTreeChange>().mockResolvedValue({ ok: true })}
        >
          <ContentHeader />
          <FolderProbe />
          <FolderPane />
          <CloseConfirmDialog />
        </WorkspaceProvider>
      </ToastProvider>,
    );
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    const picker = await screen.findByRole("combobox", { name: /env/i });
    expect(picker).toHaveTextContent(/no environment/i);
    expect(picker).not.toHaveTextContent(/staging/i);
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

const ACCENT_RED = "#dc262680";

// The trash + inherited marker render only for the ACTIVE picked env, which
// defaults to the sorted-first available name (radix Select open is unreliable
// under jsdom, per docs/learnings.md). So each tree is shaped so the env under
// test sorts first.

function NestedProbe({ open }: { open: string }) {
  const { openConfigEditor, saveActiveEditor } = useWorkspace();
  return (
    <div>
      <button type="button" onClick={() => openConfigEditor(open)}>
        open folder config
      </button>
      <button type="button" onClick={() => saveActiveEditor()}>
        fire save
      </button>
    </div>
  );
}

function renderTree(tree: TreeNode[], open: string, onTreeChange: OnTreeChange) {
  return render(
    <ToastProvider>
      <WorkspaceProvider
        tree={tree}
        initialExpandedIds={["asd1", "asd2", "solo"]}
        onTreeChange={onTreeChange}
      >
        <ContentHeader />
        <NestedProbe open={open} />
        <FolderPane />
        <CloseConfirmDialog />
      </WorkspaceProvider>
    </ToastProvider>,
  );
}

const findFolder = (
  onTreeChange: ReturnType<typeof vi.fn>,
  id: string,
): FolderNode => {
  const calls = onTreeChange.mock.calls;
  const lastTree = calls[calls.length - 1][0] as TreeNode[];
  const find = (nodes: TreeNode[]): FolderNode | null => {
    for (const n of nodes) {
      if (n.id === id && n.kind === "folder") return n;
      if (n.kind === "folder") {
        const f = find(n.children);
        if (f) return f;
      }
    }
    return null;
  };
  const folder = find(lastTree);
  if (!folder) throw new Error(`${id} not found in persisted tree`);
  return folder;
};

describe("folder Env tab - delete env (AC-006)", () => {
  // "solo" colors only "aaa" (sorted first, default-picked) and never declares it
  // in config.environments.
  const coloredOnlyTree: TreeNode[] = [
    {
      kind: "folder",
      id: "solo",
      name: "solo",
      config: {},
      environmentColors: { aaa: ACCENT_RED },
      children: [],
    },
  ];

  // AC-006 - behavior: an env this folder only COLORED (not declared in
  // config.environments) still gets a trash button - to clear its color.
  it("should show a trash button for a colored-only env", async () => {
    const user = userEvent.setup();
    renderTree(
      coloredOnlyTree,
      "solo",
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
    );
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    expect(
      await screen.findByRole("button", { name: /delete environment aaa/i }),
    ).toBeInTheDocument();
  });

  // AC-006 - side-effect-contract: deleting a colored-only env clears its color
  // live (no Cmd+S).
  it("should clear a colored-only env's color on confirmed delete", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderTree(coloredOnlyTree, "solo", onTreeChange);
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    await user.click(
      await screen.findByRole("button", { name: /delete environment aaa/i }),
    );
    await user.click(await screen.findByRole("button", { name: /^delete$/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(findFolder(onTreeChange, "solo").environmentColors).toBeUndefined();
  });

  // parent asd1 owns env-11; child asd2 inherits it (asd2 declares nothing). env-11
  // is the only available name in asd2 -> default-picked.
  const inheritOnlyTree: TreeNode[] = [
    {
      kind: "folder",
      id: "asd1",
      name: "asd1",
      config: { environments: { "env-11": {} } },
      children: [
        {
          kind: "folder",
          id: "asd2",
          name: "asd2",
          config: {},
          children: [],
        },
      ],
    },
  ];

  // AC-006 - behavior: an env inherited from the parent shows NO trash in the child.
  it("should not show a trash button for an env inherited from the parent", async () => {
    const user = userEvent.setup();
    renderTree(
      inheritOnlyTree,
      "asd2",
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
    );
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    expect(await screen.findByText("env-11")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /delete environment env-11/i }),
    ).not.toBeInTheDocument();
  });
});

describe("folder Env tab - inherited env marker (AC-011)", () => {
  // parent asd1 owns env-11; child asd2 inherits it (declares nothing) so env-11 is
  // the default pick when asd2 is open.
  const inheritTree: TreeNode[] = [
    {
      kind: "folder",
      id: "asd1",
      name: "asd1",
      config: { environments: { "env-11": {} } },
      children: [
        { kind: "folder", id: "asd2", name: "asd2", config: {}, children: [] },
      ],
    },
  ];

  // AC-011 - behavior: when the picked env is inherited from a parent, the picker
  // shows a marker naming the defining folder (so the user knows a change touches
  // the parent's env, not this folder's).
  it("should mark the picked env as inherited from the parent folder", async () => {
    const user = userEvent.setup();
    renderTree(
      inheritTree,
      "asd2",
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
    );
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    expect(
      await screen.findByLabelText(/inherited from asd1/i),
    ).toBeInTheDocument();
  });

  // AC-011 - behavior: an env defined in a parent ALWAYS shows the inherited marker,
  // even when THIS folder also colors it (coloring doesn't make it owned).
  it("should mark an inherited env even when this folder colors it", async () => {
    const user = userEvent.setup();
    // asd1 defines env-11; asd2 declares nothing but COLORS env-11 -> still inherited.
    const coloredInheritTree: TreeNode[] = [
      {
        kind: "folder",
        id: "asd1",
        name: "asd1",
        config: { environments: { "env-11": {} } },
        children: [
          {
            kind: "folder",
            id: "asd2",
            name: "asd2",
            config: {},
            environmentColors: { "env-11": ACCENT_RED },
            children: [],
          },
        ],
      },
    ];
    renderTree(
      coloredInheritTree,
      "asd2",
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
    );
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    expect(
      await screen.findByLabelText(/inherited from asd1/i),
    ).toBeInTheDocument();
  });

  // AC-011 - behavior: an env the folder OWNS shows no inherited marker.
  it("should not mark an owned env as inherited", async () => {
    const user = userEvent.setup();
    renderTree(
      inheritTree,
      "asd1",
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
    );
    await openFolderConfig(user);
    await openFolderTab(user, "Env");
    await openEnvSubView(user, "Envs");

    expect(await screen.findByText("env-11")).toBeInTheDocument();
    expect(screen.queryByLabelText(/inherited from/i)).not.toBeInTheDocument();
  });
});
