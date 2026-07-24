import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// R6b consume guard (TC-015): purerequest deleted its local shortcut-row.tsx +
// shortcuts-section.tsx and resolves ShortcutsSection from @pziel/pureui, while
// keeping its own registry.ts + resolve.ts untouched. Reads the source tree off
// disk, never trusting a mock.

const testDir = dirname(fileURLToPath(import.meta.url));
const settingsDir = resolve(testDir, "..");
const shortcutsLibDir = resolve(testDir, "../../../lib/shortcuts");
const settingsViewPath = resolve(testDir, "../../workspace/settings-view.tsx");

describe("purerequest consumes the pureui shortcuts UI (TC-015)", () => {
  it("should have deleted the local shortcut-row.tsx and shortcuts-section.tsx", () => {
    expect(existsSync(resolve(settingsDir, "shortcut-row.tsx"))).toBe(false);
    expect(existsSync(resolve(settingsDir, "shortcuts-section.tsx"))).toBe(
      false,
    );
  });

  it("should resolve ShortcutsSection from @pziel/pureui at the render site", () => {
    const source = readFileSync(settingsViewPath, "utf8");

    expect(source).toMatch(
      /import\s*\{[^}]*ShortcutsSection[^}]*\}\s*from\s*["']@pziel\/pureui["']/,
    );
    expect(source).not.toMatch(
      /from\s*["']@\/components\/settings\/shortcuts-section["']/,
    );
  });

  it("should keep its own registry.ts and resolve.ts", () => {
    expect(existsSync(resolve(shortcutsLibDir, "registry.ts"))).toBe(true);
    expect(existsSync(resolve(shortcutsLibDir, "resolve.ts"))).toBe(true);
  });
});
