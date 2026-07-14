import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { ContentHeader } from "@/components/workspace/content-header";
import { ToastProvider } from "@/components/ui/toast";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { fixtureTree } from "./fixtures";

// Opens the Auth folder's config editor (the editTarget slot) so the editor tab
// renders in the tab bar.
function OpenEditorButton() {
  const { openConfigEditor } = useWorkspace();
  return (
    <button type="button" onClick={() => openConfigEditor("folder-auth")}>
      open folder editor
    </button>
  );
}

async function renderHeader(openIds: string[], activeId = openIds[0]) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  const result = render(
    <SettingsProvider store={store}>
      <ToastProvider>
        <WorkspaceProvider
          tree={fixtureTree}
          initialOpenRequestIds={openIds}
          initialActiveRequestId={activeId}
        >
          <ContentHeader />
          <OpenEditorButton />
        </WorkspaceProvider>
      </ToastProvider>
    </SettingsProvider>,
  );
  await screen.findByRole("tablist", { name: /open requests/i });
  return result;
}

describe("folder editor tab drag", () => {
  // behavior: the folder config-editor tab is a keyboard-draggable sortable, like
  // request tabs (it carries dnd-kit's draggable attributes).
  it("should give the folder editor tab a draggable sortable handle", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile"]);

    await user.click(screen.getByText("open folder editor"));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const editorTab = within(tablist).getByRole("tab", { name: /auth/i });
    const handle = editorTab.closest("[aria-roledescription]");

    expect(handle).not.toBeNull();
    expect(handle).toHaveAttribute("tabindex", expect.stringMatching(/^-?\d+$/));
  });

  // side-effect-contract: the editor tab picks up on Space (KeyboardSensor wired),
  // proving it is part of the same sortable context as the request tabs.
  it("should pick up the folder editor tab if Space is pressed on it", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile"]);

    await user.click(screen.getByText("open folder editor"));

    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    const handle = within(tablist)
      .getByRole("tab", { name: /auth/i })
      .closest("[aria-roledescription]") as HTMLElement;
    handle.focus();
    await user.keyboard(" ");

    expect(handle).toHaveAttribute("aria-pressed", "true");
  });

  // behavior: the editor tab still closes via its close button (parity preserved
  // after the sortable refactor).
  it("should close the folder editor tab via its close button", async () => {
    const user = userEvent.setup();
    await renderHeader(["req-profile"]);

    await user.click(screen.getByText("open folder editor"));
    const tablist = screen.getByRole("tablist", { name: /open requests/i });
    expect(
      within(tablist).queryByRole("tab", { name: /auth/i }),
    ).toBeInTheDocument();

    await user.click(
      within(tablist).getByRole("button", { name: /close config editor/i }),
    );

    expect(
      within(tablist).queryByRole("tab", { name: /auth/i }),
    ).not.toBeInTheDocument();
  });
});
