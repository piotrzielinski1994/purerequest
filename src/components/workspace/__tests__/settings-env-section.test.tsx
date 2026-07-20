import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { Content } from "@/components/workspace/content";
import { Sidebar } from "@/components/workspace/sidebar";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

const tree: TreeNode[] = [
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
];

function OpenSettings() {
  const { openSettings, saveActiveEditor } = useWorkspace();
  return (
    <>
      <button type="button" onClick={openSettings}>
        open settings
      </button>
      <button type="button" onClick={() => saveActiveEditor()}>
        fire save
      </button>
    </>
  );
}

function renderShell(props: {
  envText?: string;
  onEnvChange?: (text: string) => void;
}) {
  const store = createInMemorySettingsStore({ ...DEFAULT_SETTINGS });
  return render(
    <SettingsProvider store={store}>
      <WorkspaceProvider tree={tree} {...props}>
        <OpenSettings />
        <Content />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
}

async function openEnvSection(user: ReturnType<typeof userEvent.setup>) {
  await user.click(
    await screen.findByRole("button", { name: /open settings/i }),
  );
  // Env now lives behind its own sub-tab (Theme is the default section). The
  // section is a full-bleed key/value grid - no heading/description, like the
  // folder Env views.
  await user.click(await screen.findByRole("tab", { name: /^env$/i }));
  await screen.findByLabelText("key 1");
}

describe("root .env in the Settings Env section (AC-009)", () => {
  // AC-009, TC-006 - behavior: the Settings Env view is a key/value grid, seeded
  // from the root .env, matching the folder Env grid (not a raw-text editor).
  it("should render a key/value grid seeded from the root .env if Settings is open", async () => {
    const user = userEvent.setup();
    renderShell({ envText: "TOKEN=root" });

    await openEnvSection(user);

    expect(screen.getByLabelText("key 1")).toHaveValue("TOKEN");
    expect(screen.getByLabelText("value 1")).toHaveValue("root");
  });

  // AC-009, TC-006 - side-effect-contract: editing a value in the grid and saving
  // persists the serialized .env via onEnvChange.
  it("should persist the edited root .env via onEnvChange if saved from Settings", async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn();
    renderShell({ envText: "TOKEN=root", onEnvChange });

    await openEnvSection(user);

    const value = screen.getByLabelText("value 1");
    await user.clear(value);
    await user.type(value, "changed");

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() =>
      expect(onEnvChange).toHaveBeenLastCalledWith("TOKEN=changed"),
    );
  });

  // AC-009 - behavior: typing into the trailing blank row adds a new dotenv key.
  it("should add a new dotenv key if the trailing blank row is filled and saved", async () => {
    const user = userEvent.setup();
    const onEnvChange = vi.fn();
    renderShell({ envText: "TOKEN=root", onEnvChange });

    await openEnvSection(user);

    await user.type(screen.getByLabelText("key 2"), "NEXT");
    await user.type(screen.getByLabelText("value 2"), "v");

    await user.click(screen.getByRole("button", { name: /fire save/i }));

    await waitFor(() =>
      expect(onEnvChange).toHaveBeenLastCalledWith("TOKEN=root\nNEXT=v"),
    );
  });
});

describe("sidebar no longer hosts the .env editor (AC-009)", () => {
  // AC-009, TC-006 - behavior: the sidebar has no ".env" edit button.
  it("should not render an Edit .env button in the sidebar", () => {
    render(
      <WorkspaceProvider tree={tree}>
        <Sidebar />
      </WorkspaceProvider>,
    );

    expect(
      screen.queryByRole("button", { name: /edit \.env/i }),
    ).not.toBeInTheDocument();
  });
});
