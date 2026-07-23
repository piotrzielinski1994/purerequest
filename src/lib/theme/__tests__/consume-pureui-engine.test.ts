import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// TC-012 (R13 Task 5). purerequest must CONSUME the hoisted theme engine from
// @pziel/pureui and delete its two local copies (apply-vars.ts + overrides.ts).
// This is a STATIC guard - it reads the actual source tree off disk rather than
// trusting a mock. We assert observable facts: the local module files are gone,
// no src file still imports them by their @/ alias (scanned off disk with
// readFileSync, NOT shell grep - some source files carry stray non-text bytes
// that make plain grep skip them as "binary"), and the app-side catalog
// (theme-defaults.ts) is untouched (the token arrays + defaults stay app-side,
// pureui carries no catalog).

const testDir = dirname(fileURLToPath(import.meta.url));
const srcDir = resolve(testDir, "../../.."); // .../purerequest/src

// The two local theme-engine modules whose behavior moved into @pziel/pureui.
const DELETED_MODULE_FILES = [
  "lib/theme/apply-vars.ts",
  "lib/theme/overrides.ts",
];

// The @/ import specifiers that must no longer appear anywhere under src.
const FORBIDDEN_SPECIFIERS = [
  "@/lib/theme/apply-vars",
  "@/lib/theme/overrides",
];

// The app-side catalog that STAYS local (untouched by this migration).
const APP_CATALOG_FILE = "lib/theme/theme-defaults.ts";

// Recursively collect every .ts/.tsx source module under src (including tests -
// requirement (b) is "no file under src/**", so orphan/retargeted tests count).
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

// Extract every module specifier used in a static/dynamic import, re-export, or
// require call, so we can test each against the forbidden-module list.
function importedSpecifiers(source: string): string[] {
  const specifiers: string[] = [];
  const patterns = [
    /\bfrom\s*["']([^"']+)["']/g, // import ... from "x" / export ... from "x"
    /\bimport\s*["']([^"']+)["']/g, // side-effect import "x"
    /\bimport\s*\(\s*["']([^"']+)["']\s*\)/g, // dynamic import("x")
    /\brequire\s*\(\s*["']([^"']+)["']\s*\)/g, // require("x")
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

describe("purerequest consumes the pureui theme engine (TC-012)", () => {
  // TC-012(a) - behavior: the two local engine modules are deleted from disk.
  it("should not ship src/lib/theme/apply-vars.ts or overrides.ts", () => {
    const present = DELETED_MODULE_FILES.filter((rel) =>
      existsSync(resolve(srcDir, rel)),
    );

    expect(present).toEqual([]);
  });

  // TC-012(b) - behavior: no src file imports the deleted local modules.
  it("should have no src file importing @/lib/theme/apply-vars or overrides", () => {
    const offenders: string[] = [];

    for (const file of collectSourceFiles(srcDir)) {
      const specifiers = importedSpecifiers(readFileSync(file, "utf8"));
      for (const spec of specifiers) {
        if (FORBIDDEN_SPECIFIERS.includes(spec)) {
          offenders.push(`${relative(srcDir, file)} imports ${spec}`);
        }
      }
    }

    expect(offenders).toEqual([]);
  });

  // TC-012(c) - behavior: the app-side catalog stays local (untouched).
  it("should keep src/lib/theme/theme-defaults.ts app-side", () => {
    expect(existsSync(resolve(srcDir, APP_CATALOG_FILE))).toBe(true);
  });
});
