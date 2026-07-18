import type { Environment, TreeNode } from "@/lib/workspace/model";
import {
  parsePostmanCollection,
  parsePostmanEnvironment,
} from "@/lib/postman/parse-postman";

// A Postman collection captured as pick-relative path -> file text. The collection
// itself is one nested-JSON file; sibling `*.postman_environment.json` files fold
// into the root folder's `config.environments`, and a `.env` (captured by the
// reader) is merged into the workspace `.env` separately via `collectDotenv`.
export type PostmanFileMap = Record<string, string>;

function isJson(path: string): boolean {
  return path.endsWith(".json");
}

function isEnvironmentFile(path: string): boolean {
  return path.endsWith(".postman_environment.json");
}

// The collection file: the first path-sorted `*.postman_collection.json` whose parse
// yields a folder; else the first path-sorted `.json` (not an environment file) that
// parses to a collection. Returns the parsed root folder, or null when none is found.
function pickCollection(
  files: PostmanFileMap,
  fallbackName: string,
): TreeNode | null {
  const jsonPaths = Object.keys(files).filter(isJson).sort();
  const named = jsonPaths.filter((path) =>
    path.endsWith(".postman_collection.json"),
  );
  const fallback = jsonPaths.filter(
    (path) => !isEnvironmentFile(path) && !path.endsWith(".postman_collection.json"),
  );
  for (const path of [...named, ...fallback]) {
    const parsed = parsePostmanCollection(files[path], fallbackName);
    if (parsed) {
      return parsed;
    }
  }
  return null;
}

// Every parseable environment file in the map, path-sorted for a stable order.
function collectEnvironments(files: PostmanFileMap): Environment[] {
  return Object.keys(files)
    .filter(isEnvironmentFile)
    .sort()
    .flatMap((path) => {
      const env = parsePostmanEnvironment(files[path]);
      return env ? [env] : [];
    });
}

// Map a Postman collection file-map into a single purerequest root folder. Picks the
// collection file, folds every environment file into its `config.environments`, and
// returns the root wrapped in an array (or [] when no collection file is present).
export function postmanToTree(
  files: PostmanFileMap,
  fallbackName: string,
): TreeNode[] {
  const root = pickCollection(files, fallbackName);
  if (!root || root.kind !== "folder") {
    return [];
  }
  const environments = collectEnvironments(files);
  if (environments.length === 0) {
    return [root];
  }
  return [
    {
      ...root,
      config: { ...root.config, environments },
    },
  ];
}
