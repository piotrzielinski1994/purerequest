import { open } from "@tauri-apps/plugin-dialog";
import { mkdir, writeTextFile } from "@tauri-apps/plugin-fs";
import { slugify } from "@/lib/workspace/slug";

export type CollectionFileMap = Record<string, string>;

export type CollectionWriter = {
  save: (files: CollectionFileMap, suggestedName: string) => Promise<boolean>;
};

type CollectionWriterDeps = {
  pickDir: () => Promise<string | null>;
  writeFile: (path: string, content: string) => Promise<void>;
};

export function createCollectionWriter(
  deps: CollectionWriterDeps,
): CollectionWriter {
  return {
    save: async (files, suggestedName): Promise<boolean> => {
      const parent = await deps.pickDir();
      if (parent === null) {
        return false;
      }
      const root = `${parent}/${slugify(suggestedName)}`;
      await Promise.all(
        Object.entries(files).map(([relPath, content]) =>
          deps.writeFile(`${root}/${relPath}`, content),
        ),
      );
      return true;
    },
  };
}

function parentDir(path: string): string | null {
  const index = path.lastIndexOf("/");
  return index === -1 ? null : path.slice(0, index);
}

export function createTauriCollectionWriter(): CollectionWriter {
  return createCollectionWriter({
    pickDir: () =>
      open({ directory: true, multiple: false })
        .then((selected) => (typeof selected === "string" ? selected : null))
        .catch(() => null),
    writeFile: async (path, content): Promise<void> => {
      const dir = parentDir(path);
      if (dir !== null) {
        await mkdir(dir, { recursive: true });
      }
      await writeTextFile(path, content);
    },
  });
}

export function createNoopCollectionWriter(): CollectionWriter {
  return {
    save: () => Promise.resolve(false),
  };
}
