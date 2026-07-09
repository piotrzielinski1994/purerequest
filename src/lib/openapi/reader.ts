import { open } from "@tauri-apps/plugin-dialog";
import { readTextFile } from "@tauri-apps/plugin-fs";

export type OpenapiPick = { name: string; text: string };

export type OpenapiReader = {
  pick: () => Promise<OpenapiPick | null>;
};

function baseName(path: string): string {
  return path.replace(/[/\\]+$/, "").split(/[/\\]/).pop() ?? path;
}

export function createTauriOpenapiReader(): OpenapiReader {
  return {
    pick: async (): Promise<OpenapiPick | null> => {
      // An OpenAPI document is a single self-contained file (servers/envs live
      // inside it), so a single-file picker is the natural surface - no file map,
      // no `.env` sidecar (unlike Postman/Bruno).
      const selected = await open({
        multiple: false,
        filters: [{ name: "OpenAPI", extensions: ["json", "yaml", "yml"] }],
      }).catch(() => null);
      if (typeof selected !== "string") {
        return null;
      }
      const text = await readTextFile(selected).catch(() => null);
      if (text === null) {
        return null;
      }
      return { name: baseName(selected), text };
    },
  };
}

export function createNoopOpenapiReader(): OpenapiReader {
  return {
    pick: () => Promise.resolve(null),
  };
}
