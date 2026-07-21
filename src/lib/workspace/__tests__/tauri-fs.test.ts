import { beforeEach, describe, expect, it, vi } from "vitest";

// Fake the @tauri-apps/plugin-fs surface tauri-fs.ts uses. The fake models a real
// filesystem closely enough to reproduce the "parent dir must exist before write"
// failure: writeTextFile into a dir that was never mkdir-ed throws ENOENT.

const dirs = new Set<string>();
const fileContents = new Map<string, string>();

class Enoent extends Error {
  constructor(path: string) {
    super(`No such file or directory (os error 2): ${path}`);
  }
}

function dirOf(path: string): string {
  const slash = path.lastIndexOf("/");
  return slash === -1 ? "" : path.slice(0, slash);
}

vi.mock("@tauri-apps/plugin-fs", () => ({
  mkdir: vi.fn((path: string) => {
    // recursive: register the dir + every ancestor.
    const parts = path.split("/");
    for (let i = parts.length; i > 0; i -= 1) {
      dirs.add(parts.slice(0, i).join("/"));
    }
    return Promise.resolve();
  }),
  writeTextFile: vi.fn((path: string, content: string) => {
    if (!dirs.has(dirOf(path))) {
      return Promise.reject(new Enoent(path));
    }
    fileContents.set(path, content);
    return Promise.resolve();
  }),
  readTextFile: vi.fn((path: string) => {
    const content = fileContents.get(path);
    return content === undefined
      ? Promise.reject(new Enoent(path))
      : Promise.resolve(content);
  }),
  readDir: vi.fn(() => Promise.resolve([])),
  remove: vi.fn(() => Promise.resolve()),
}));

import { createTauriWorkspaceFs } from "@/lib/workspace/tauri-fs";

const ROOT = "/app/data/collection";

beforeEach(() => {
  dirs.clear();
  fileContents.clear();
  // The app data dir itself exists; the `collection` subfolder does NOT yet.
  dirs.add("");
  dirs.add("/app");
  dirs.add("/app/data");
});

describe("createTauriWorkspaceFs writeWorkspace", () => {
  it("should create the root dir before writing the root manifest into a fresh path", async () => {
    const fs = createTauriWorkspaceFs();

    const result = await fs.writeWorkspace(ROOT, {
      "purerequest.workspace.json": "{}",
      "dir1/folder.json": "{}",
    });

    expect(result.ok).toBe(true);
    expect(fileContents.get(`${ROOT}/purerequest.workspace.json`)).toBe("{}");
    expect(fileContents.get(`${ROOT}/dir1/folder.json`)).toBe("{}");
  });
});
