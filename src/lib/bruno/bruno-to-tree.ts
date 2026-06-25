import type {
  ConfigScope,
  FolderNode,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { parseBru, type ParsedBru } from "@/lib/bruno/parse-bru";
import { parseOpenCollection } from "@/lib/bruno/parse-opencollection";
import { mergeDotenv } from "@/lib/workspace/environment";

// A Bruno collection captured as collection-relative path -> file text.
export type BrunoFileMap = Record<string, string>;

// Concatenate every `.env` in the file map (at any depth, sorted by path for a
// stable order) into one dotenv text. Picking a single collection yields one
// root `.env`; picking a parent of several collections yields one per child -
// all merged so their `{{process.env.X}}` keys resolve after import.
export function collectDotenv(files: BrunoFileMap): string {
  return Object.keys(files)
    .filter((path) => path === ".env" || path.endsWith("/.env"))
    .sort()
    .map((path) => files[path])
    .reduce((acc, env) => mergeDotenv(acc, env), "");
}

const ENV_DIR = "environments";

// Files that carry folder/collection config (not a request), in either format.
const FOLDER_FILES = new Set(["folder.bru", "folder.yml", "folder.yaml"]);
const COLLECTION_FILES = new Set([
  "bruno.json",
  "collection.bru",
  "opencollection.yml",
  "opencollection.yaml",
]);

function isRequestFile(name: string): boolean {
  if (FOLDER_FILES.has(name) || COLLECTION_FILES.has(name)) {
    return false;
  }
  return name.endsWith(".bru") || name.endsWith(".yml") || name.endsWith(".yaml");
}

// Dispatch the per-file parser by extension: .bru -> bru markup, .yml/.yaml ->
// OpenCollection YAML.
function parseFile(text: string, path: string): ParsedBru {
  if (path.endsWith(".bru")) {
    return parseBru(text);
  }
  return parseOpenCollection(text);
}

function tryParseJson(raw: string | undefined): { name?: string } {
  if (raw === undefined) {
    return {};
  }
  try {
    return JSON.parse(raw) as { name?: string };
  } catch {
    return {};
  }
}

function configFrom(parsed: ParsedBru): ConfigScope {
  return {
    ...(Object.keys(parsed.variables).length > 0
      ? { variables: parsed.variables }
      : {}),
    ...(parsed.headers.length > 0 ? { headers: parsed.headers } : {}),
    ...(parsed.params.length > 0 ? { params: parsed.params } : {}),
    ...(parsed.auth ? { auth: parsed.auth } : {}),
    ...(parsed.scripts ? { scripts: parsed.scripts } : {}),
  };
}

function fileBaseName(path: string): string {
  return path.split("/").pop()?.replace(/\.(bru|ya?ml)$/, "") ?? path;
}

type IdGen = () => string;

function makeIdGen(): IdGen {
  let counter = 0;
  return () => {
    counter += 1;
    return `bruno-${counter}`;
  };
}

function toRequestNode(
  files: BrunoFileMap,
  path: string,
  nextId: IdGen,
): RequestNode {
  const parsed = parseFile(files[path], path);
  return {
    kind: "request",
    id: nextId(),
    name: parsed.name ?? fileBaseName(path),
    method: parsed.method ?? "GET",
    url: parsed.url ?? "",
    body: parsed.body,
    ...(parsed.bodyMode ? { bodyMode: parsed.bodyMode } : {}),
    ...(parsed.bodyForm.length > 0 ? { bodyForm: parsed.bodyForm } : {}),
    config: configFrom(parsed),
  };
}

// The folder-config file for a directory: folder.bru / folder.yml, else a nested
// opencollection.yml (Postman-converted sub-collections carry one per dir).
function folderConfigFor(
  files: BrunoFileMap,
  dir: string,
): ParsedBru | undefined {
  const candidate =
    files[`${dir}/folder.bru`] ??
    files[`${dir}/folder.yml`] ??
    files[`${dir}/folder.yaml`] ??
    files[`${dir}/opencollection.yml`] ??
    files[`${dir}/opencollection.yaml`];
  if (candidate === undefined) {
    return undefined;
  }
  const path = files[`${dir}/folder.bru`] !== undefined ? "folder.bru" : "x.yml";
  return parseFile(candidate, path);
}

function buildLevel(
  files: BrunoFileMap,
  prefix: string,
  nextId: IdGen,
): TreeNode[] {
  const requestPaths: string[] = [];
  const subdirs = new Set<string>();

  for (const path of Object.keys(files)) {
    if (!path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex === -1) {
      if (isRequestFile(rest)) {
        requestPaths.push(path);
      }
      continue;
    }
    const segment = rest.slice(0, slashIndex);
    if (!(prefix === "" && segment === ENV_DIR)) {
      subdirs.add(segment);
    }
  }

  const requests: TreeNode[] = requestPaths.map((path) =>
    toRequestNode(files, path, nextId),
  );

  const folders: TreeNode[] = [...subdirs].map((segment) => {
    const dir = `${prefix}${segment}`;
    const parsed = folderConfigFor(files, dir);
    const folder: FolderNode = {
      kind: "folder",
      id: nextId(),
      name: parsed?.name ?? segment,
      config: parsed ? configFrom(parsed) : {},
      children: buildLevel(files, `${dir}/`, nextId),
    };
    return folder;
  });

  return [...folders, ...requests];
}

function collectEnvironments(
  files: BrunoFileMap,
): Record<string, Record<string, string>> {
  const prefix = `${ENV_DIR}/`;
  return Object.keys(files)
    .filter(
      (path) =>
        path.startsWith(prefix) &&
        (path.endsWith(".bru") ||
          path.endsWith(".yml") ||
          path.endsWith(".yaml")),
    )
    .reduce<Record<string, Record<string, string>>>((acc, path) => {
      const envName = fileBaseName(path);
      return { ...acc, [envName]: parseFile(files[path], path).variables };
    }, {});
}

// Map a Bruno collection file-map into a single ReqUI root folder wrapping the
// whole collection. Mirrors `disk-format.deserialize`'s level build, dispatching
// the per-file parser by extension (.bru markup vs OpenCollection YAML).
export function brunoToTree(
  files: BrunoFileMap,
  fallbackName: string,
): TreeNode[] {
  const nextId = makeIdGen();
  const collectionMeta = tryParseJson(files["bruno.json"]);
  const rootConfigText =
    files["collection.bru"] ??
    files["opencollection.yml"] ??
    files["opencollection.yaml"];
  const rootPath = files["collection.bru"] !== undefined ? "collection.bru" : "x.yml";
  const rootParsed =
    rootConfigText !== undefined ? parseFile(rootConfigText, rootPath) : undefined;

  const environments = collectEnvironments(files);
  const baseConfig = rootParsed ? configFrom(rootParsed) : {};
  const config: ConfigScope = {
    ...baseConfig,
    ...(Object.keys(environments).length > 0 ? { environments } : {}),
  };

  const root: FolderNode = {
    kind: "folder",
    id: nextId(),
    name: collectionMeta.name ?? rootParsed?.name ?? fallbackName,
    config,
    children: buildLevel(files, "", nextId),
  };
  return [root];
}
