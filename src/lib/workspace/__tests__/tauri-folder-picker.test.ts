import type { FolderPicker } from "@pziel/pureui";
import { describe, expect, it } from "vitest";

import { createTauriFolderPicker } from "../tauri-folder-picker";

describe("createTauriFolderPicker", () => {
  // AC-008 — behavior
  it("should resolve null without throwing if Tauri is unavailable", async () => {
    const picker: FolderPicker = createTauriFolderPicker();

    await expect(picker.pick()).resolves.toBeNull();
  });
});
