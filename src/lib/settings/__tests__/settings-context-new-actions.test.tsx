import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type SettingsStore,
} from "@/lib/settings/settings";

function SidebarProbe() {
  const { settings, saveSidebarHidden } = useSettings();

  return (
    <div>
      <span data-testid="sidebar-hidden">{String(settings.sidebarHidden)}</span>
      <button
        type="button"
        onClick={() => saveSidebarHidden(!settings.sidebarHidden)}
      >
        toggle sidebar hidden
      </button>
    </div>
  );
}

function WorkspacePathProbe() {
  const { settings, saveWorkspacePath } = useSettings();

  return (
    <div>
      <span data-testid="workspace-path">
        {settings.workspacePath ?? "none"}
      </span>
      <button type="button" onClick={() => saveWorkspacePath("/ws/picked")}>
        save workspace path
      </button>
    </div>
  );
}

describe("SettingsProvider saveSidebarHidden", () => {
  // AC-003, TC-003 — behavior
  it("should flip settings.sidebarHidden if saveSidebarHidden is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SidebarProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("sidebar-hidden")).toHaveTextContent(
      "false",
    );

    await user.click(
      screen.getByRole("button", { name: /toggle sidebar hidden/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("sidebar-hidden")).toHaveTextContent("true");
    });
  });

  // AC-003, TC-003 — side-effect-contract
  it("should persist via store.save if saveSidebarHidden is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <SidebarProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("sidebar-hidden");

    await user.click(
      screen.getByRole("button", { name: /toggle sidebar hidden/i }),
    );

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0].sidebarHidden).toBe(true);
  });
});

describe("SettingsProvider saveWorkspacePath", () => {
  // AC-006, TC-006 — behavior
  it("should set settings.workspacePath if saveWorkspacePath is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <WorkspacePathProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("workspace-path")).toHaveTextContent(
      "none",
    );

    await user.click(
      screen.getByRole("button", { name: /save workspace path/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("workspace-path")).toHaveTextContent(
        "/ws/picked",
      );
    });
  });

  // AC-006, TC-006 — side-effect-contract
  it("should persist workspacePath via store.save if saveWorkspacePath is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      sidebarHidden: false,
    });
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <WorkspacePathProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("workspace-path");

    await user.click(
      screen.getByRole("button", { name: /save workspace path/i }),
    );

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0].workspacePath).toBe("/ws/picked");
  });
});
