import { createNoopFolderPicker, type FolderPicker } from "@pziel/pureui";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";

import { WorkspaceLoader } from "@/components/workspace/workspace-loader";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { serialize } from "@/lib/workspace/disk-format";
import { createInMemoryWorkspaceFs } from "@/lib/workspace/in-memory-fs";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

const pickedTree: TreeNode[] = [
  {
    kind: "folder",
    id: "picked-folder",
    name: "PickedCollection",
    config: {},
    children: [
      {
        kind: "request",
        id: "picked-req",
        name: "Picked Request",
        method: "GET",
        url: "https://api/picked",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

// SEAM: WorkspaceLoader accepts a `picker: FolderPicker` prop (mirroring its
// existing `fs` prop) and threads it to Main, which registers open-workspace.
function renderLoader(picker: FolderPicker) {
  const settingsStore = createInMemorySettingsStore({ ...DEFAULT_SETTINGS });
  const fs = createInMemoryWorkspaceFs({
    "/ws/picked": serialize(pickedTree, "Picked"),
  });
  return render(
    <SettingsProvider store={settingsStore}>
      <WorkspaceLoader fs={fs} picker={picker} />
    </SettingsProvider>,
  );
}

describe("open-workspace (Mod+O)", () => {
  // AC-006, TC-006 — behavior
  it("should save the picked path and load that workspace if Mod+O resolves a folder", async () => {
    const user = userEvent.setup();
    const picker: FolderPicker = { pick: () => Promise.resolve("/ws/picked") };
    renderLoader(picker);

    // Empty shell first.
    await screen.findByText(/no workspace/i);

    await user.keyboard("{Control>}o{/Control}");

    expect(await screen.findByText("PickedCollection")).toBeInTheDocument();
  });

  // AC-006, TC-006 — behavior
  it("should not change the workspace if Mod+O is cancelled (picker resolves null)", async () => {
    const user = userEvent.setup();
    const picker: FolderPicker = { pick: () => Promise.resolve(null) };
    renderLoader(picker);

    await screen.findByText(/no workspace/i);

    await user.keyboard("{Control>}o{/Control}");

    // Give the (rejected) pick a tick; nothing should have loaded.
    await waitFor(() => {
      expect(screen.queryByText("PickedCollection")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
  });

  // AC-008, TC-006 — behavior
  it("should be a safe no-op if Mod+O fires with a noop picker (Tauri absent)", async () => {
    const user = userEvent.setup();
    renderLoader(createNoopFolderPicker());

    await screen.findByText(/no workspace/i);

    await user.keyboard("{Control>}o{/Control}");

    await waitFor(() => {
      expect(screen.queryByText("PickedCollection")).not.toBeInTheDocument();
    });
    expect(screen.getByText(/no workspace/i)).toBeInTheDocument();
  });
});
