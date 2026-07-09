import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";
import type { PostmanFileMap } from "@/lib/postman/postman-to-tree";

export type PostmanPick = { name: string; files: PostmanFileMap };

export type PostmanCollectionReader = {
  pick: () => Promise<PostmanPick | null>;
};

function baseName(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
}

function dirName(path: string): string {
  const segments = path.replace(/[/\\]+$/, "").split(/[/\\]/);
  return segments.length > 1 ? segments[segments.length - 2] : "Postman";
}

export function createTauriPostmanReader(): PostmanCollectionReader {
  return {
    pick: async (): Promise<PostmanPick | null> => {
      // A Postman collection is a single JSON file, so pick files directly;
      // multi-select lets a `*.postman_environment.json` come along (it folds
      // into config.environments). The map is keyed by file base name.
      const selected = await open({
        multiple: true,
        filters: [{ name: "Postman JSON", extensions: ["json"] }],
      }).catch(() => null);
      const paths = Array.isArray(selected)
        ? selected
        : typeof selected === "string"
          ? [selected]
          : null;
      if (!paths || paths.length === 0) {
        return null;
      }
      const files: PostmanFileMap = {};
      try {
        for (const path of paths) {
          files[baseName(path)] = await readTextFile(path);
        }
      } catch {
        return null;
      }
      return { name: dirName(paths[0]), files };
    },
  };
}

export function createNoopPostmanReader(): PostmanCollectionReader {
  return {
    pick: () => Promise.resolve(null),
  };
}
