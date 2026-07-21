import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type SettingsStore } from "@/lib/settings/settings";
import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";

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

function FullscreenProbe() {
  const { settings, saveWindowFullscreen } = useSettings();

  return (
    <div>
      <span data-testid="window-fullscreen">
        {String(settings.windowFullscreen)}
      </span>
      <button
        type="button"
        onClick={() => saveWindowFullscreen(!settings.windowFullscreen)}
      >
        toggle window fullscreen
      </button>
    </div>
  );
}

describe("SettingsProvider saveWindowFullscreen", () => {
  // behavior: the context exposes the persisted fullscreen flag and flips it
  it("should flip settings.windowFullscreen if saveWindowFullscreen is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <FullscreenProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("window-fullscreen")).toHaveTextContent(
      "false",
    );

    await user.click(
      screen.getByRole("button", { name: /toggle window fullscreen/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("window-fullscreen")).toHaveTextContent("true");
    });
  });

  // side-effect-contract: the flip is persisted via store.save
  it("should persist windowFullscreen via store.save if saveWindowFullscreen is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <FullscreenProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("window-fullscreen");

    await user.click(
      screen.getByRole("button", { name: /toggle window fullscreen/i }),
    );

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0].windowFullscreen).toBe(true);
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
