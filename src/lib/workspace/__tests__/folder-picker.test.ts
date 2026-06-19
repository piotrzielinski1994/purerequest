import { describe, it, expect } from "vitest";

import {
  createNoopFolderPicker,
  createTauriFolderPicker,
  type FolderPicker,
} from "@/lib/workspace/folder-picker";

describe("createNoopFolderPicker", () => {
  // AC-008, TC-006 — behavior
  it("should resolve null when picked", async () => {
    const picker: FolderPicker = createNoopFolderPicker();

    await expect(picker.pick()).resolves.toBeNull();
  });

  // AC-008 — behavior
  it("should not throw when picked", async () => {
    const picker = createNoopFolderPicker();

    await expect(picker.pick()).resolves.toBeNull();
  });
});

describe("createTauriFolderPicker", () => {
  // AC-008 — behavior
  it("should resolve null without throwing if Tauri is unavailable", async () => {
    const picker: FolderPicker = createTauriFolderPicker();

    await expect(picker.pick()).resolves.toBeNull();
  });
});
