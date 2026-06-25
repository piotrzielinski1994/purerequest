import { open } from "@tauri-apps/plugin-dialog";
import { readDir, readTextFile } from "@tauri-apps/plugin-fs";
import type { BrunoFileMap } from "@/lib/bruno/bruno-to-tree";

export type BrunoPick = { name: string; files: BrunoFileMap };

export type BrunoCollectionReader = {
  pick: () => Promise<BrunoPick | null>;
};

const BRUNO_FILE = /\.(bru|ya?ml)$/;

async function collect(
  absDir: string,
  relPrefix: string,
  files: BrunoFileMap,
): Promise<void> {
  const entries = await readDir(absDir);
  for (const entry of entries) {
    const relPath = `${relPrefix}${entry.name}`;
    const absPath = `${absDir}/${entry.name}`;
    if (entry.isDirectory) {
      await collect(absPath, `${relPath}/`, files);
      continue;
    }
    // A collection's .env feeds {{process.env.X}}; capture it at ANY depth
    // (picking a parent dir of several collections yields nested `<col>/.env`s),
    // alongside the request/config files (and bruno.json).
    if (
      entry.isFile &&
      (BRUNO_FILE.test(relPath) ||
        entry.name === "bruno.json" ||
        entry.name === ".env")
    ) {
      files[relPath] = await readTextFile(absPath);
    }
  }
}

function baseName(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
}

export function createTauriBrunoReader(): BrunoCollectionReader {
  return {
    pick: async (): Promise<BrunoPick | null> => {
      const selected = await open({ directory: true, multiple: false }).catch(
        () => null,
      );
      if (typeof selected !== "string") {
        return null;
      }
      const files: BrunoFileMap = {};
      try {
        await collect(selected, "", files);
      } catch {
        return null;
      }
      return { name: baseName(selected), files };
    },
  };
}

export function createNoopBrunoReader(): BrunoCollectionReader {
  return {
    pick: () => Promise.resolve(null),
  };
}
