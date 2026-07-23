import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TC-012 (R15 Task 3). purerequest must CONSUME the hoisted useActionHotkeys hook
// from @pziel/pureui and delete its local copy. STATIC guard - reads the actual
// source tree off disk (readFileSync, NOT shell grep - some source files carry
// stray non-text bytes that make plain grep skip them as "binary"). Asserts
// observable facts: the local hook file is gone, no src file imports it by its @/
// alias, the call site resolves useActionHotkeys from @pziel/pureui, and the
// app-side registry.ts + resolve.ts stay untouched.

const testDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(testDir, "../../.."); // .../purerequest/src

const DELETED_MODULE_FILE = "lib/shortcuts/use-action-hotkeys.ts";
const FORBIDDEN_SPECIFIER = "@/lib/shortcuts/use-action-hotkeys";
const CALL_SITE = "components/workspace/main.tsx";
const APP_KEPT_FILES = [
  "lib/shortcuts/registry.ts",
  "lib/shortcuts/resolve.ts",
];

function collectSourceFiles(dir: string, acc: string[] = []): string[] {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      collectSourceFiles(full, acc);
      continue;
    }
    if (!/\.(ts|tsx)$/.test(entry.name)) continue;
    acc.push(full);
  }
  return acc;
}

function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g,
    /\bimport\s*["']([^"']+)["']/g,
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g,
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g,
  ];
  for (const pattern of patterns) {
    let match: RegExpExecArray | null = pattern.exec(source);
    while (match !== null) {
      specifiers.push(match[1]);
      match = pattern.exec(source);
    }
  }
  return specifiers;
}

describe("purerequest consumes the pureui useActionHotkeys hook (TC-012)", () => {
  // TC-012(a) - behavior: the local hook module is deleted from disk.
  it("should not ship src/lib/shortcuts/use-action-hotkeys.ts", () => {
    expect(existsSync(resolve(srcDir, DELETED_MODULE_FILE))).toBe(false);
  });

  // TC-012(b) - behavior: no src file imports the deleted local module.
  it("should have no src file importing @/lib/shortcuts/use-action-hotkeys", () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(srcDir)) {
      const specifiers = importedSpecifiers(readFileSync(file, "utf8"));
      if (specifiers.includes(FORBIDDEN_SPECIFIER)) {
        offenders.push(relative(srcDir, file));
      }
    }

    expect(offenders).toEqual([]);
  });

  // TC-012(c) - behavior: the call site resolves useActionHotkeys from @pziel/pureui.
  it("should import useActionHotkeys from @pziel/pureui at the call site", () => {
    const source = readFileSync(resolve(srcDir, CALL_SITE), "utf8");
    const pureuiImports = source.match(
      /import\s*\{[^}]*\}\s*from\s*["']@pziel\/pureui["']/s,
    );

    expect(pureuiImports?.[0]).toContain("useActionHotkeys");
  });

  // TC-012(d) - behavior: the app-side registry + resolve wrappers stay local.
  it("should keep registry.ts and resolve.ts app-side", () => {
    const present = APP_KEPT_FILES.filter((rel) =>
      existsSync(resolve(srcDir, rel)),
    );

    expect(present).toEqual(APP_KEPT_FILES);
  });
});
