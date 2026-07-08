import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type PanelLayout,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";

// Consumer that exercises the shortcut/console additions to the context.
function ShortcutProbe() {
  const { settings, saveShortcut, resetShortcut, saveConsoleHidden } =
    useSettings();

  return (
    <div>
      <span data-testid="console-hidden">{String(settings.consoleHidden)}</span>
      <span data-testid="toggle-console-binding">
        {settings.shortcuts["toggle-console"] ?? "none"}
      </span>
      <button
        type="button"
        onClick={() => saveShortcut("toggle-console", "Mod+K")}
      >
        save shortcut
      </button>
      <button type="button" onClick={() => resetShortcut("toggle-console")}>
        reset shortcut
      </button>
      <button
        type="button"
        onClick={() => saveConsoleHidden(!settings.consoleHidden)}
      >
        toggle console hidden
      </button>
    </div>
  );
}

// Tiny consumer that renders settings values into the DOM so we assert on
// observable behavior, not on the context object shape directly.
function SettingsProbe({ saveOnClick }: { saveOnClick?: PanelLayout }) {
  const { settings, saveLayout } = useSettings();

  return (
    <div>
      <span data-testid="console-hidden">{String(settings.consoleHidden)}</span>
      <span data-testid="workspace-layout">
        {JSON.stringify(settings.layouts.workspace ?? null)}
      </span>
      <button
        type="button"
        onClick={() =>
          saveLayout("workspace", saveOnClick ?? { sidebar: 35, content: 65 })
        }
      >
        save layout
      </button>
    </div>
  );
}

describe("SettingsProvider", () => {
  // AC-004 — behavior
  it("should expose DEFAULT_SETTINGS to children if the store is empty", async () => {
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("console-hidden")).toHaveTextContent(
      String(DEFAULT_SETTINGS.consoleHidden),
    );
    expect(screen.getByTestId("workspace-layout")).toHaveTextContent("null");
  });

  // AC-004 — behavior
  it("should expose seeded settings to children if the store has them", async () => {
    const seeded: Settings = {
      version: 1,
      layouts: { workspace: { sidebar: 22, content: 78 } },
      consoleHidden: true,
      sidebarHidden: false,
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: DEFAULT_SETTINGS.theme,
    };
    const store = createInMemorySettingsStore(seeded);

    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("console-hidden")).toHaveTextContent(
      "true",
    );
    expect(screen.getByTestId("workspace-layout")).toHaveTextContent(
      JSON.stringify({ sidebar: 22, content: 78 }),
    );
  });

  // AC-002 — behavior
  it("should update settings.layouts.workspace if saveLayout is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <SettingsProbe saveOnClick={{ sidebar: 45, content: 55 }} />
      </SettingsProvider>,
    );

    // Wait for the async load to render children before interacting.
    await screen.findByTestId("workspace-layout");

    await user.click(screen.getByRole("button", { name: /save layout/i }));

    await waitFor(() => {
      expect(screen.getByTestId("workspace-layout")).toHaveTextContent(
        JSON.stringify({ sidebar: 45, content: 55 }),
      );
    });
  });

  // AC-002, AC-006 — side-effect-contract
  it("should persist via store.save if saveLayout is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <SettingsProbe saveOnClick={{ sidebar: 45, content: 55 }} />
      </SettingsProvider>,
    );

    await screen.findByTestId("workspace-layout");

    await user.click(screen.getByRole("button", { name: /save layout/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    const persisted = saveSpy.mock.calls[0][0];
    expect(persisted.layouts.workspace).toEqual({ sidebar: 45, content: 55 });
  });

  // TC-005, AC-002, AC-006 — side-effect-contract
  it("should round-trip a saved layout through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    const first = render(
      <SettingsProvider store={store}>
        <SettingsProbe saveOnClick={{ sidebar: 33, content: 67 }} />
      </SettingsProvider>,
    );

    await screen.findByTestId("workspace-layout");
    await user.click(screen.getByRole("button", { name: /save layout/i }));
    await waitFor(() => {
      expect(screen.getByTestId("workspace-layout")).toHaveTextContent(
        JSON.stringify({ sidebar: 33, content: 67 }),
      );
    });

    first.unmount();

    // A fresh provider over the same store must see the persisted layout.
    render(
      <SettingsProvider store={store}>
        <SettingsProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("workspace-layout")).toHaveTextContent(
      JSON.stringify({ sidebar: 33, content: 67 }),
    );
  });
});

// Two saves in the SAME event tick must COMPOSE (not clobber): both read the ref
// mirror, not the pre-render `settings` value. Mirrors the draft-create path where
// saveOpenTabs + saveDraftTabs fire together.
function TwoSaveProbe() {
  const { settings, saveConsoleHidden, saveSidebarHidden } = useSettings();
  return (
    <div>
      <span data-testid="console-hidden">{String(settings.consoleHidden)}</span>
      <span data-testid="sidebar-hidden">{String(settings.sidebarHidden)}</span>
      <button
        type="button"
        onClick={() => {
          saveConsoleHidden(true);
          saveSidebarHidden(true);
        }}
      >
        save both
      </button>
    </div>
  );
}

describe("SettingsProvider concurrent saves", () => {
  // regression: two saves in one tick both persist (neither clobbers the other).
  it("should compose two saves fired in the same tick", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <TwoSaveProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("console-hidden");
    await user.click(screen.getByRole("button", { name: /save both/i }));

    await waitFor(() => {
      expect(screen.getByTestId("console-hidden")).toHaveTextContent("true");
    });
    expect(screen.getByTestId("sidebar-hidden")).toHaveTextContent("true");
    // the LAST persisted settings carry BOTH flags (not just the second save).
    const last = saveSpy.mock.calls.at(-1)![0];
    expect(last.consoleHidden).toBe(true);
    expect(last.sidebarHidden).toBe(true);
  });
});

describe("SettingsProvider shortcut actions", () => {
  // AC-003 — behavior
  it("should set settings.shortcuts[id] if saveShortcut is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");
    expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
      "none",
    );

    await user.click(screen.getByRole("button", { name: /save shortcut/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        "Mod+K",
      );
    });
  });

  // AC-003 — side-effect-contract
  it("should persist the override via store.save if saveShortcut is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(screen.getByRole("button", { name: /save shortcut/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    const persisted = saveSpy.mock.calls[0][0];
    expect(persisted.shortcuts["toggle-console"]).toBe("Mod+K");
  });

  // AC-004 — behavior
  it("should remove the override if resetShortcut is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(screen.getByRole("button", { name: /save shortcut/i }));
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        "Mod+K",
      );
    });

    await user.click(screen.getByRole("button", { name: /reset shortcut/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        "none",
      );
    });
  });

  // AC-004 — side-effect-contract
  it("should persist the removal via store.save if resetShortcut is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(screen.getByRole("button", { name: /save shortcut/i }));
    await user.click(screen.getByRole("button", { name: /reset shortcut/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(2);
    });
    const lastPersisted = saveSpy.mock.calls[1][0];
    expect(lastPersisted.shortcuts).not.toHaveProperty("toggle-console");
  });

  // AC-002 — behavior
  it("should flip settings.consoleHidden if saveConsoleHidden is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    expect(await screen.findByTestId("console-hidden")).toHaveTextContent(
      "false",
    );

    await user.click(
      screen.getByRole("button", { name: /toggle console hidden/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("console-hidden")).toHaveTextContent("true");
    });
  });

  // AC-002 — side-effect-contract
  it("should persist via store.save if saveConsoleHidden is called", async () => {
    const user = userEvent.setup();
    const inner = createInMemorySettingsStore();
    const saveSpy = vi.fn(inner.save);
    const store: SettingsStore = { load: inner.load, save: saveSpy };

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("console-hidden");

    await user.click(
      screen.getByRole("button", { name: /toggle console hidden/i }),
    );

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    expect(saveSpy.mock.calls[0][0].consoleHidden).toBe(true);
  });

  // TC-002, AC-003 — side-effect-contract
  it("should round-trip a saved shortcut through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    const first = render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");
    await user.click(screen.getByRole("button", { name: /save shortcut/i }));
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        "Mod+K",
      );
    });

    first.unmount();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    expect(
      await screen.findByTestId("toggle-console-binding"),
    ).toHaveTextContent("Mod+K");
  });
});
