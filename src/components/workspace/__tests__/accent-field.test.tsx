import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import { ContentHeader } from "@/components/workspace/content-header";
import { FolderPane } from "@/components/workspace/folder-pane";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { FolderNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const RED = "#dc262680";
const GREEN = "#16a34a80";

// A folder whose env picker defaults (sorted-first) to `local`; `prod` is
// pre-colored red so per-env independence can be proven without switching the
// radix dropdown (unreliable under jsdom, per docs/learnings.md).
const makeTree = (environmentColors?: Record<string, string>): TreeNode[] => [
  {
    kind: "folder",
    id: "folder-1",
    name: "Folder",
    config: {
      environments: [
        { name: "local", variables: [] },
        { name: "prod", variables: [] },
      ],
    },
    ...(environmentColors ? { environmentColors } : {}),
    children: [
      {
        kind: "request",
        id: "req-1",
        name: "Req",
        method: "GET",
        url: "https://api/get",
        body: emptyBody(),
        params: emptyParams(),
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

function renderFolder(onTreeChange: OnTreeChange, initialTree: TreeNode[]) {
  return render(
    <WorkspaceProvider tree={initialTree} onTreeChange={onTreeChange}>
      <ContentHeader />
      <FolderProbe />
      <FolderPane />
      <CloseConfirmDialog />
    </WorkspaceProvider>,
  );
}

const openEnvTab = async (user: ReturnType<typeof userEvent.setup>) => {
  await user.click(screen.getByRole("button", { name: /open folder config/i }));
  const tablist = await screen.findByRole("tablist", {
    name: /folder sections/i,
  });
  await user.click(within(tablist).getByRole("tab", { name: "Env" }));
};

const fireSave = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /fire save/i }));

const dirtyDot = () => {
  const tablist = screen.getByRole("tablist", { name: /open requests/i });
  return within(tablist).queryByLabelText(/unsaved changes/i);
};

const savedFolder = (onTreeChange: ReturnType<typeof vi.fn>): FolderNode => {
  const calls = onTreeChange.mock.calls;
  const lastTree = calls[calls.length - 1][0] as TreeNode[];
  const folder = lastTree.find((n) => n.id === "folder-1");
  if (folder?.kind !== "folder") {
    throw new Error("folder-1 not found in persisted tree");
  }
  return folder;
};

describe("folder Env tab accent control (AC-001)", () => {
  // AC-001 - behavior: the Envs toolbar shows the accent control - four preset
  // swatches, the native picker, and the hex input.
  it("should render the accent preset swatches, native picker and hex input on the Env toolbar", async () => {
    const user = userEvent.setup();
    renderFolder(
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
      makeTree(),
    );
    await openEnvTab(user);

    expect(
      await screen.findByRole("button", { name: /none/i }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /green/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /blue/i })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /red/i })).toBeInTheDocument();
    expect(screen.getByLabelText(/accent color picker/i)).toBeInTheDocument();
    expect(screen.getByLabelText("Hex")).toBeInTheDocument();
  });

  // AC-001 - behavior: the control reflects the SELECTED env's color. The picker
  // defaults to `local` (sorted first); a folder colored green for local shows that
  // green in the hex field (proving the control is keyed to the selected env).
  it("should show the selected env's saved color in the hex field", async () => {
    const user = userEvent.setup();
    renderFolder(
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
      makeTree({ local: GREEN, prod: RED }),
    );
    await openEnvTab(user);

    expect(await screen.findByLabelText("Hex")).toHaveValue(GREEN);
  });
});

describe("folder Env tab accent live persist (AC-002)", () => {
  // AC-002, TC-001 - side-effect-contract: clicking a preset persists the SELECTED
  // env's color LIVE (onTreeChange fires) without firing Cmd+S, and adds no dirty dot.
  it("should persist the selected env's color live without a Cmd+S and without marking dirty", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange, makeTree());
    await openEnvTab(user);

    await user.click(await screen.findByRole("button", { name: /green/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedFolder(onTreeChange).environmentColors).toEqual({
      local: GREEN,
    });
    expect(dirtyDot()).not.toBeInTheDocument();
  });

  // AC-002, TC-002 - side-effect-contract: setting the selected env's (local) color
  // leaves a DIFFERENT env's (prod) color untouched - per-env independence.
  it("should leave other envs' colors untouched when one env's color is set", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange, makeTree({ prod: RED }));
    await openEnvTab(user);

    // picker defaults to `local` (uncolored); colouring it must keep prod red.
    await user.click(await screen.findByRole("button", { name: /green/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedFolder(onTreeChange).environmentColors).toEqual({
      prod: RED,
      local: GREEN,
    });
  });

  // AC-002, TC-003, E-3 - side-effect-contract: clicking None removes the selected
  // env's color entry. local is pre-colored, so None empties the map for local.
  it("should remove the selected env's color if None is clicked", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange, makeTree({ local: GREEN }));
    await openEnvTab(user);

    await user.click(await screen.findByRole("button", { name: /none/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedFolder(onTreeChange).environmentColors).toBeUndefined();
  });

  // AC-002, TC-001 - behavior: clicking a preset reflects its hex in the field.
  it("should show the preset's hex in the hex field if a preset is clicked", async () => {
    const user = userEvent.setup();
    renderFolder(
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
      makeTree(),
    );
    await openEnvTab(user);

    await user.click(await screen.findByRole("button", { name: /red/i }));

    expect(screen.getByLabelText("Hex")).toHaveValue(RED);
  });

  // AC-002, E-4 - side-effect-contract: a custom hex persists lowercased for the
  // selected env.
  it("should persist a custom hex lowercased for the selected env", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange, makeTree());
    await openEnvTab(user);

    const hexInput = await screen.findByLabelText("Hex");
    await user.clear(hexInput);
    await user.type(hexInput, "#AABBCC");

    await waitFor(() =>
      expect(savedFolder(onTreeChange).environmentColors).toEqual({
        local: "#aabbcc",
      }),
    );

    // fire a Cmd+S to prove the live write already persisted (no draft needed).
    await fireSave(user);
    expect(savedFolder(onTreeChange).environmentColors).toEqual({
      local: "#aabbcc",
    });
  });
});

describe("folder Raw JSON shows env colors folded in", () => {
  const openSettingsTab = async (user: ReturnType<typeof userEvent.setup>) => {
    await user.click(
      screen.getByRole("button", { name: /open folder config/i }),
    );
    const tablist = await screen.findByRole("tablist", {
      name: /folder sections/i,
    });
    await user.click(within(tablist).getByRole("tab", { name: "Raw" }));
    await waitFor(() =>
      expect(document.querySelector(".cm-editor")).not.toBeNull(),
    );
  };
  const editorText = () =>
    document.querySelector(".cm-editor")?.textContent ?? "";

  // the reported bug: a folder colored for prod showed no color in the Settings
  // JSON. The doc is the on-disk shape, so the color must fold into the prod entry.
  it("should render the env's color inside its environments entry in the Raw JSON", async () => {
    const user = userEvent.setup();
    renderFolder(
      vi.fn<OnTreeChange>().mockResolvedValue({ ok: true }),
      makeTree({ prod: RED }),
    );

    await openSettingsTab(user);

    const text = editorText();
    expect(text).toContain('"name": "prod"');
    expect(text).toContain(`"color": "${RED}"`);
  });

  // saving the Raw JSON persists the folded color back onto the folder's
  // environmentColors (the doc round-trips config + colors together).
  it("should persist an env color edited via the Raw JSON", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderFolder(onTreeChange, makeTree({ prod: RED }));

    await openSettingsTab(user);
    // retype the whole doc with prod's color changed to GREEN.
    const doc = JSON.stringify(
      {
        environments: [
          { name: "local", variables: [] },
          { name: "prod", color: GREEN, variables: [] },
        ],
      },
      null,
      2,
    );
    const editor = document.querySelector<HTMLElement>(".cm-content");
    editor?.focus();
    await user.keyboard(`{Control>}a{/Control}`);
    await user.paste(doc);
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedFolder(onTreeChange).environmentColors).toEqual({
      prod: GREEN,
    });
  });
});
