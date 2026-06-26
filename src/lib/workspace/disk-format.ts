import type {
  BodyMode,
  ConfigScope,
  FolderNode,
  HttpMethod,
  KeyValue,
  TreeNode,
} from "@/lib/workspace/model";
import {
  bodyToStored,
  storedToBody,
  type StoredBody,
} from "@/lib/workspace/body-codec";

export type FileMap = Record<string, string>;

export type DeserializeResult =
  | { ok: true; tree: TreeNode[]; skipped: string[] }
  | { ok: false; error: string };

const MANIFEST = "requi.workspace.json";

type ParsedRequest = {
  name?: string;
  method?: HttpMethod;
  url?: string;
  body?: string | StoredBody;
  bodyMode?: BodyMode;
  bodyForm?: KeyValue[];
  config?: ConfigScope;
  order?: number;
};

// bodyMode/bodyForm only land on disk when non-default (mode !== json or rows
// present), so a plain JSON request keeps a minimal *.req.json diff.
function bodyModeFields(node: {
  bodyMode?: BodyMode;
  bodyForm?: KeyValue[];
}): { bodyMode?: BodyMode; bodyForm?: KeyValue[] } {
  const isDefault =
    (node.bodyMode ?? "json") === "json" && (node.bodyForm ?? []).length === 0;
  if (isDefault) {
    return {};
  }
  return {
    ...(node.bodyMode ? { bodyMode: node.bodyMode } : {}),
    ...(node.bodyForm && node.bodyForm.length > 0
      ? { bodyForm: node.bodyForm }
      : {}),
  };
}

type ParsedFolder = { name?: string; config?: ConfigScope; order?: number };

function tryParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
}

function slugify(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "untitled";
}

function uniqueSlug(base: string, used: Set<string>): string {
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let suffix = 2;
  while (used.has(`${base}-${suffix}`)) {
    suffix += 1;
  }
  const slug = `${base}-${suffix}`;
  used.add(slug);
  return slug;
}

type Ordered = { node: TreeNode; order?: number };

function sortNodes(nodes: TreeNode[]): TreeNode[] {
  return [...nodes].sort((a, b) => {
    if (a.kind !== b.kind) {
      return a.kind === "folder" ? -1 : 1;
    }
    return a.name.localeCompare(b.name);
  });
}

function sortOrdered(entries: Ordered[]): TreeNode[] {
  const ordered = entries
    .filter(
      (entry): entry is Ordered & { order: number } =>
        entry.order !== undefined,
    )
    .sort((a, b) => a.order - b.order)
    .map((entry) => entry.node);
  const unordered = sortNodes(
    entries.filter((entry) => entry.order === undefined).map((e) => e.node),
  );
  return [...ordered, ...unordered];
}

function serializeInto(
  files: FileMap,
  nodes: TreeNode[],
  prefix: string,
): void {
  const used = new Set<string>();
  nodes.forEach((node, order) => {
    const slug = uniqueSlug(slugify(node.name), used);
    if (node.kind === "folder") {
      const dir = `${prefix}${slug}`;
      files[`${dir}/folder.json`] = JSON.stringify(
        { name: node.name, config: node.config, order },
        null,
        2,
      );
      if (node.dotenv) {
        files[`${dir}/.env`] = node.dotenv;
      }
      serializeInto(files, node.children, `${dir}/`);
      return;
    }
    files[`${prefix}${slug}.req.json`] = JSON.stringify(
      {
        name: node.name,
        method: node.method,
        url: node.url,
        body: bodyToStored(node.body),
        ...bodyModeFields(node),
        config: node.config,
        order,
      },
      null,
      2,
    );
  });
}

export function serialize(
  tree: TreeNode[],
  workspaceName = "Workspace",
): FileMap {
  const files: FileMap = {
    [MANIFEST]: JSON.stringify(
      { schemaVersion: 3, name: workspaceName },
      null,
      2,
    ),
  };
  serializeInto(files, tree, "");
  return files;
}

function parseRequest(
  files: FileMap,
  path: string,
  prefix: string,
): Ordered | null {
  const parsed = tryParse<ParsedRequest>(files[path]);
  if (!parsed) {
    return null;
  }
  const slug = path.slice(prefix.length).replace(/\.req\.json$/, "");
  return {
    order: parsed.order,
    node: {
      kind: "request",
      id: path.replace(/\.req\.json$/, ""),
      name: parsed.name ?? slug,
      method: parsed.method ?? "GET",
      url: parsed.url ?? "",
      body: storedToBody(parsed.body),
      ...(parsed.bodyMode ? { bodyMode: parsed.bodyMode } : {}),
      ...(parsed.bodyForm ? { bodyForm: parsed.bodyForm } : {}),
      config: parsed.config ?? {},
    },
  };
}

function buildLevel(
  files: FileMap,
  prefix: string,
  skipped: string[],
): TreeNode[] {
  const requestPaths: string[] = [];
  const subdirs = new Set<string>();

  for (const path of Object.keys(files)) {
    if (path === MANIFEST || !path.startsWith(prefix)) {
      continue;
    }
    const rest = path.slice(prefix.length);
    const slashIndex = rest.indexOf("/");
    if (slashIndex === -1) {
      if (rest.endsWith(".req.json")) {
        requestPaths.push(path);
      }
      continue;
    }
    subdirs.add(rest.slice(0, slashIndex));
  }

  const requests = requestPaths.flatMap((path) => {
    const entry = parseRequest(files, path, prefix);
    if (!entry) {
      skipped.push(path);
      return [];
    }
    return [entry];
  });

  const folders = [...subdirs].flatMap<Ordered>((segment) => {
    const dir = `${prefix}${segment}`;
    const folderJsonPath = `${dir}/folder.json`;
    const raw = files[folderJsonPath];
    const parsed = raw === undefined ? undefined : tryParse<ParsedFolder>(raw);
    if (raw !== undefined && parsed === undefined) {
      skipped.push(folderJsonPath);
      return [];
    }
    const dotenv = files[`${dir}/.env`];
    const folder: FolderNode = {
      kind: "folder",
      id: dir,
      name: parsed?.name ?? segment,
      config: parsed?.config ?? {},
      ...(dotenv ? { dotenv } : {}),
      children: buildLevel(files, `${dir}/`, skipped),
    };
    return [{ order: parsed?.order, node: folder }];
  });

  return sortOrdered([...requests, ...folders]);
}

export function deserialize(files: FileMap): DeserializeResult {
  if (files[MANIFEST] === undefined) {
    return { ok: false, error: `Not a workspace: missing ${MANIFEST}` };
  }
  const skipped: string[] = [];
  const tree = buildLevel(files, "", skipped);
  return { ok: true, tree, skipped };
}
