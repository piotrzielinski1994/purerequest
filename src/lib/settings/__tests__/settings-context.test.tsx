import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import {
  DEFAULT_SETTINGS,
  type PanelLayout,
  type Settings,
  type SettingsStore,
} from "@/lib/settings/settings";
import { SettingsProvider, useSettings } from "@/lib/settings/settings-context";

// Consumer that exercises the shortcut/console additions to the context.
function ShortcutProbe() {
  const {
    settings,
    addShortcut,
    removeShortcut,
    replaceShortcut,
    resetShortcut,
    saveConsoleHidden,
  } = useSettings();
  const bindings = settings.shortcuts["toggle-console"];

  return (
    <div>
      <span data-testid="console-hidden">{String(settings.consoleHidden)}</span>
      <span data-testid="toggle-console-binding">
        {bindings === undefined ? "none" : JSON.stringify(bindings)}
      </span>
      <button
        type="button"
        onClick={() => addShortcut("toggle-console", "Mod+K")}
      >
        add shortcut
      </button>
      <button
        type="button"
        onClick={() => addShortcut("toggle-console", "Mod+G")}
      >
        add second shortcut
      </button>
      <button
        type="button"
        onClick={() => removeShortcut("toggle-console", "Mod+K")}
      >
        remove shortcut
      </button>
      <button
        type="button"
        onClick={() => removeShortcut("toggle-console", "Mod+J")}
      >
        remove default shortcut
      </button>
      <button
        type="button"
        onClick={() => replaceShortcut("toggle-console", "Mod+J", "Mod+Y")}
      >
        replace default shortcut
      </button>
      <button
        type="button"
        onClick={() => replaceShortcut("toggle-console", "Mod+J", "Mod+G")}
      >
        replace default with second
      </button>
      <button
        type="button"
        onClick={() => replaceShortcut("toggle-console", "Mod+X", "Mod+Y")}
      >
        replace absent shortcut
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
  // AC-002 — behavior
  it("should append the binding to settings.shortcuts[id] if addShortcut is called", async () => {
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

    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
      );
    });
  });

  // AC-002 — behavior: a second add keeps the first binding and appends the new one.
  it("should keep existing bindings if a second addShortcut is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));
    await user.click(
      screen.getByRole("button", { name: /add second shortcut/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K", "Mod+G"]),
      );
    });
  });

  // E-1 — behavior: adding a hotkey already present is a no-op (no duplicate).
  it("should not add a duplicate binding if the hotkey is already present", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));
    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
      );
    });
  });

  // AC-002 — side-effect-contract
  it("should persist the override array via store.save if addShortcut is called", async () => {
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

    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalledTimes(1);
    });
    const persisted = saveSpy.mock.calls[0][0];
    expect(persisted.shortcuts["toggle-console"]).toEqual(["Mod+J", "Mod+K"]);
  });

  // AC-004 — behavior: removing the last binding leaves an empty (disabled) list.
  it("should disable the action with an empty list if the last binding is removed", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    // The only effective binding is the default Mod+J; removing it disables the
    // action, leaving an explicit empty list (distinct from "no override").
    await user.click(
      screen.getByRole("button", { name: /remove default shortcut/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify([]),
      );
    });
  });

  // AC-004 — behavior
  it("should remove one binding but keep the rest if removeShortcut is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
      );
    });

    await user.click(
      screen.getByRole("button", { name: /^remove shortcut$/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J"]),
      );
    });
  });

  // behavior: replace maps the old binding to the new one, preserving position.
  it("should swap one binding in place if replaceShortcut is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    // Seed a second binding so we can assert the replaced one keeps its slot.
    await user.click(
      screen.getByRole("button", { name: /add second shortcut/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+G"]),
      );
    });

    await user.click(
      screen.getByRole("button", { name: /^replace default shortcut$/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+Y", "Mod+G"]),
      );
    });
  });

  // side-effect-contract: the replaced list is persisted.
  it("should persist the swapped list via store.save if replaceShortcut is called", async () => {
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

    await user.click(
      screen.getByRole("button", { name: /^replace default shortcut$/i }),
    );

    await waitFor(() => {
      expect(saveSpy).toHaveBeenCalled();
    });
    const persisted = saveSpy.mock.calls.at(-1)![0];
    expect(persisted.shortcuts["toggle-console"]).toEqual(["Mod+Y"]);
  });

  // E-2 — behavior: replacing with a combo the action already has de-dups (no twin).
  it("should de-dupe if replaceShortcut targets a combo the action already holds", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(
      screen.getByRole("button", { name: /add second shortcut/i }),
    );
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+G"]),
      );
    });

    // Replace Mod+J with Mod+G, which is already bound -> collapse to one entry.
    await user.click(
      screen.getByRole("button", { name: /replace default with second/i }),
    );

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+G"]),
      );
    });
  });

  // E-3 — behavior: replacing a binding the action does not hold is a no-op.
  it("should leave bindings untouched if replaceShortcut targets an absent binding", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(
      screen.getByRole("button", { name: /replace absent shortcut/i }),
    );

    // The absent Mod+X replace is a no-op: no override is written at all.
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        "none",
      );
    });
  });

  // AC-005 — behavior
  it("should remove the override entirely if resetShortcut is called", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");

    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
      );
    });

    await user.click(screen.getByRole("button", { name: /reset shortcut/i }));

    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        "none",
      );
    });
  });

  // AC-005 — side-effect-contract
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

    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));
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

  // TC-002, AC-002 — side-effect-contract
  it("should round-trip a saved shortcut through the store to a fresh provider", async () => {
    const user = userEvent.setup();
    const store = createInMemorySettingsStore();

    const first = render(
      <SettingsProvider store={store}>
        <ShortcutProbe />
      </SettingsProvider>,
    );

    await screen.findByTestId("toggle-console-binding");
    await user.click(screen.getByRole("button", { name: /^add shortcut$/i }));
    await waitFor(() => {
      expect(screen.getByTestId("toggle-console-binding")).toHaveTextContent(
        JSON.stringify(["Mod+J", "Mod+K"]),
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
    ).toHaveTextContent(JSON.stringify(["Mod+J", "Mod+K"]));
  });
});
