import { beforeEach, describe, expect, it, vi } from "vitest";

// The Tauri settings store defaults `workspacePath` to a collection dir under the
// app data dir (appDataDir/collection) when nothing is persisted yet, so a fresh
// install has a writable workspace without the user hand-editing settings.json. A
// persisted workspacePath always wins. We fake the plugin-store LazyStore surface
// (mirroring tauri-store-theme.test.ts) AND @tauri-apps/api/path's appDataDir/join.

type FakeStore = {
  path: string;
  data: Map<string, unknown>;
  get: ReturnType<typeof vi.fn>;
  set: ReturnType<typeof vi.fn>;
  save: ReturnType<typeof vi.fn>;
  delete: ReturnType<typeof vi.fn>;
};

const stores = new Map<string, FakeStore>();

function makeFakeStore(path: string): FakeStore {
  const data = new Map<string, unknown>();
  return {
    path,
    data,
    get: vi.fn((key: string) => Promise.resolve(data.get(key))),
    set: vi.fn((key: string, value: unknown) => {
      data.set(key, value);
      return Promise.resolve();
    }),
    save: vi.fn(() => Promise.resolve()),
    delete: vi.fn((key: string) => Promise.resolve(data.delete(key))),
  };
}

vi.mock("@tauri-apps/plugin-store", () => ({
  LazyStore: class {
    constructor(path: string) {
      const fake = stores.get(path) ?? makeFakeStore(path);
      stores.set(path, fake);
      return fake as unknown as object;
    }
  },
}));

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: () => Promise.resolve("/app/data"),
  join: (...parts: string[]) => Promise.resolve(parts.join("/")),
}));

import { createTauriSettingsStore } from "@/lib/settings/tauri-store";

const SETTINGS_FILE = "settings.json";

function ensureStore(path: string): FakeStore {
  const existing = stores.get(path);
  if (existing) {
    return existing;
  }
  const created = makeFakeStore(path);
  stores.set(path, created);
  return created;
}

beforeEach(() => {
  stores.clear();
});

describe("createTauriSettingsStore default workspacePath", () => {
  it("should default workspacePath to appDataDir/collection if none is persisted", async () => {
    const store = createTauriSettingsStore();

    const loaded = await store.load();

    expect(loaded.workspacePath).toBe("/app/data/collection");
  });

  it("should keep a persisted workspacePath over the default", async () => {
    ensureStore(SETTINGS_FILE).data.set("settings", {
      version: 1,
      workspacePath: "/my/own/collection",
    });
    const store = createTauriSettingsStore();

    const loaded = await store.load();

    expect(loaded.workspacePath).toBe("/my/own/collection");
  });
});
