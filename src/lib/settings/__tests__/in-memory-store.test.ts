import { describe, it, expect } from "vitest";

import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS, type Settings } from "@/lib/settings/settings";

describe("createInMemorySettingsStore", () => {
  // AC-004, AC-006 — behavior
  it("should return DEFAULT_SETTINGS if the store was created empty", async () => {
    const store = createInMemorySettingsStore();

    expect(await store.load()).toEqual(DEFAULT_SETTINGS);
  });

  // AC-004, AC-006 — behavior
  it("should return the seeded initial settings if one was provided", async () => {
    const initial: Settings = {
      version: 1,
      layouts: { workspace: { sidebar: 25, content: 75 } },
      consoleHidden: true,
      sidebarHidden: false,
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: DEFAULT_SETTINGS.theme,
    };
    const store = createInMemorySettingsStore(initial);

    expect(await store.load()).toEqual(initial);
  });

  // TC-005, AC-002 — behavior
  it("should return the last-saved settings on a subsequent load", async () => {
    const store = createInMemorySettingsStore();
    const saved: Settings = {
      version: 1,
      layouts: { workspace: { sidebar: 40, content: 60 } },
      consoleHidden: false,
      sidebarHidden: false,
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: DEFAULT_SETTINGS.theme,
    };

    await store.save(saved);

    expect(await store.load()).toEqual(saved);
  });

  // TC-005, AC-002 — behavior
  it("should overwrite the previous settings if save is called again", async () => {
    const store = createInMemorySettingsStore();

    await store.save({
      version: 1,
      layouts: { workspace: { sidebar: 40, content: 60 } },
      consoleHidden: false,
      sidebarHidden: false,
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: DEFAULT_SETTINGS.theme,
    });
    await store.save({
      version: 1,
      layouts: { main: { content: 70, console: 30 } },
      consoleHidden: true,
      sidebarHidden: false,
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: DEFAULT_SETTINGS.theme,
    });

    expect(await store.load()).toEqual({
      version: 1,
      layouts: { main: { content: 70, console: 30 } },
      consoleHidden: true,
      sidebarHidden: false,
      windowFullscreen: false,
      shortcuts: {},
      openRequestIds: [],
      activeRequestId: null,
      draftTabs: [],
      theme: DEFAULT_SETTINGS.theme,
    });
  });
});
