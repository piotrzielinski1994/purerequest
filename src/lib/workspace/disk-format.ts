import type {
  BodyMode,
  ConfigScope,
  Environment,
  FolderNode,
  HttpMethod,
  HttpVersion,
  KeyValue,
  RequestBody,
  RequestParams,
  TreeNode,
} from "@/lib/workspace/model";
import { bodyToDisk, legacyStoredToBody } from "@/lib/workspace/body-codec";
import { slugify, uniqueSlug } from "@/lib/workspace/slug";

export type FileMap = Record<string, string>;

export type DeserializeResult =
  | { ok: true; tree: TreeNode[]; skipped: string[] }
  | { ok: false; error: string };

const MANIFEST = "requi.workspace.json";

// A folder accent is a `#rrggbb` or `#rrggbbaa` hex; the optional alpha pair is
// the user's border opacity. Anything else on disk is dropped.
const HEX_COLOR = /^#([0-9a-f]{6}|[0-9a-f]{8})$/i;

const BODY_MODES: BodyMode[] = [
  "json",
  "none",
  "form",
  "multipart",
  "graphql",
];

type ParsedRequest = ConfigScope & {
  name?: string;
  method?: HttpMethod;
  url?: string;
  // `body` is the new `{active,types}` object on a v4 doc, or a legacy string /
  // tagged body on a v3 doc; narrowed at runtime by migrateBody.
  body?: unknown;
  bodyMode?: BodyMode;
  bodyForm?: KeyValue[];
  // `params` is the new `{path,query}` object on a v4 doc; absent on a v3 doc
  // (which carried query in config.params + path in pathParams).
  params?: unknown;
  // v5 stores config fields FLAT at the top level (the ConfigScope keys mixed in
  // above); `config` is the legacy (<= v4) nested wrapper, read as a fallback.
  config?: ConfigScope & { params?: unknown };
  httpVersion?: unknown;
  order?: number;
  pathParams?: Record<string, unknown>;
};

// Narrow a parsed value to in-memory KeyValue[] rows, tolerant of the legacy
// shape. A current doc stores an array (like query/headers), whose rows are kept
// when key+value are both strings; a legacy doc stored a `name -> value` record,
// whose string-valued entries become rows (non-strings drop). Used for both path
// params and variables (each stored a record before the array restructure).
// Anything else -> no rows.
function sanitizeRows(value: unknown): KeyValue[] {
  if (Array.isArray(value)) {
    return value.filter(
      (row): row is KeyValue =>
        typeof row === "object" &&
        row !== null &&
        typeof (row as KeyValue).key === "string" &&
        typeof (row as KeyValue).value === "string",
    );
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).flatMap(
    ([key, raw]) => (typeof raw === "string" ? [{ key, value: raw }] : []),
  );
}

function asKeyValueArray(value: unknown): KeyValue[] {
  return Array.isArray(value) ? (value as KeyValue[]) : [];
}

function asBodyMode(value: unknown): BodyMode {
  return typeof value === "string" && (BODY_MODES as string[]).includes(value)
    ? (value as BodyMode)
    : "json";
}

// Narrow a disk `graphql` slot to the in-memory { query, variables } pair. A
// missing slot (legacy doc, or a non-graphql body) is the blank seed; each field
// falls back to "" so a query-only doc loads with blank variables.
function asGraphqlSlot(value: unknown): { query: string; variables: string } {
  if (typeof value !== "object" || value === null) {
    return { query: "", variables: "" };
  }
  const slot = value as { query?: unknown; variables?: unknown };
  return {
    query: typeof slot.query === "string" ? slot.query : "",
    variables: typeof slot.variables === "string" ? slot.variables : "",
  };
}

// The `body` field for disk, minimal-diff: omitted when fully default (json
// active, no payloads). The json slot is written as its natural JSON value (real
// nested JSON) or a raw string; empty slots drop. Exported so the request-settings
// JSON editor emits the identical doc shape.
export function bodyField(body: RequestBody): { body?: unknown } {
  const hasGraphql =
    body.types.graphql.query !== "" || body.types.graphql.variables !== "";
  // json and graphql are the empty-capable defaults: an active mode of either
  // with no payload carries no information, so it drops to a minimal-diff doc
  // (reverts to json on reload). `none`/`form`/`multipart` always persist their
  // mode even when empty (the mode selection itself is meaningful).
  const isDefault =
    (body.active === "json" || body.active === "graphql") &&
    body.types.json === "" &&
    body.types.form.length === 0 &&
    body.types.multipart.length === 0 &&
    !hasGraphql;
  if (isDefault) {
    return {};
  }
  return {
    body: {
      active: body.active,
      types: {
        ...(body.types.json !== ""
          ? { json: bodyToDisk(body.types.json) }
          : {}),
        ...(body.types.form.length > 0 ? { form: body.types.form } : {}),
        ...(body.types.multipart.length > 0
          ? { multipart: body.types.multipart }
          : {}),
        ...(hasGraphql ? { graphql: body.types.graphql } : {}),
      },
    },
  };
}

// The `params` field for disk, minimal-diff: omitted when both path and query
// are empty; each present slot dropped when empty. Exported so the
// request-settings JSON editor emits the identical doc shape.
export function paramsField(params: RequestParams): { params?: unknown } {
  const hasPath = params.path.length > 0;
  const hasQuery = params.query.length > 0;
  if (!hasPath && !hasQuery) {
    return {};
  }
  return {
    params: {
      ...(hasPath ? { path: params.path } : {}),
      ...(hasQuery ? { query: params.query } : {}),
    },
  };
}

// Narrow a parsed `body` to the in-memory RequestBody. A v4 doc carries
// `{active,types}` (json slot a natural JSON value or raw string); a v3 doc
// carries a raw string / retired tagged body plus sibling bodyMode/bodyForm, with
// bodyForm landing in the slot the legacy mode named (form or multipart).
function migrateBody(parsed: ParsedRequest): RequestBody {
  const raw = parsed.body;
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    "active" in raw &&
    "types" in raw
  ) {
    const tagged = raw as { active?: unknown; types?: Record<string, unknown> };
    const types = tagged.types ?? {};
    return {
      active: asBodyMode(tagged.active),
      types: {
        // legacyStoredToBody, not diskToBody: an early v4 doc wrote the json slot
        // as the retired tagged `{type,payload}` shape - decode it so those files
        // still load; a natural value falls through to the same pretty-print.
        json: legacyStoredToBody(types.json),
        form: asKeyValueArray(types.form),
        multipart: asKeyValueArray(types.multipart),
        graphql: asGraphqlSlot(types.graphql),
      },
    };
  }
  const json = legacyStoredToBody(raw);
  const mode = parsed.bodyMode ?? "json";
  const rows = parsed.bodyForm ?? [];
  return {
    active: mode,
    types: {
      json,
      form: mode === "form" ? rows : [],
      multipart: mode === "multipart" ? rows : [],
      graphql: { query: "", variables: "" },
    },
  };
}

// Narrow a parsed `params` to the in-memory RequestParams. A v4 doc carries
// `{path,query}`; a v3 doc has neither - query came from config.params, path from
// pathParams.
function migrateParams(parsed: ParsedRequest): RequestParams {
  const raw = parsed.params;
  if (
    typeof raw === "object" &&
    raw !== null &&
    !Array.isArray(raw) &&
    ("path" in raw || "query" in raw)
  ) {
    const obj = raw as { path?: unknown; query?: unknown };
    return {
      path: sanitizeRows(obj.path),
      query: asKeyValueArray(obj.query),
    };
  }
  return {
    path: sanitizeRows(parsed.pathParams),
    query: asKeyValueArray(parsed.config?.params),
  };
}

// A legacy v3 config may still carry `params` (now request-owned query); strip it
// so it never resurfaces as an unknown ConfigScope key. Returns a raw record whose
// fields readConfig normalizes per-key (environments/variables may still be legacy
// shapes here), so it's typed loosely.
function configWithoutParams(
  config: (Record<string, unknown> & { params?: unknown }) | undefined,
): Record<string, unknown> {
  if (!config) {
    return {};
  }
  const rest = { ...config };
  delete rest.params;
  return rest;
}

// The ConfigScope fields, now stored FLAT at the doc's top level (no `config`
// wrapper) - everything on a node is config, so the wrapper was noise. None of
// these collide with the node's own doc keys (name/method/url/body/params/order/
// environmentColors), so spreading in/out is unambiguous.
const CONFIG_KEYS: (keyof ConfigScope)[] = [
  "variables",
  "environments",
  "headers",
  "auth",
  "scripts",
  "timeoutMs",
];

// Serialize a config to flat top-level fields, omitting empty ones for a minimal
// diff (an all-empty config contributes nothing). Exported so the request-settings
// JSON editor emits the identical doc shape.
export function configField(config: ConfigScope): Record<string, unknown> {
  return CONFIG_KEYS.reduce<Record<string, unknown>>((acc, key) => {
    const value = config[key];
    if (value === undefined) {
      return acc;
    }
    return { ...acc, [key]: value };
  }, {});
}

// Read a config from a parsed doc: the flat top-level fields (new v5 shape) win,
// falling back to the legacy nested `config` object (<= v4) for any field the top
// level doesn't carry. `params` (legacy query) is always dropped. Exported so the
// request-settings JSON editor reads the identical doc shape.
export function readConfig(parsed: {
  config?: (Record<string, unknown> & { params?: unknown }) | undefined;
} & Partial<Record<keyof ConfigScope, unknown>>): ConfigScope {
  const legacy = configWithoutParams(parsed.config);
  // `variables` + each env's vars are now KeyValue[] rows; a legacy doc stored a
  // `name -> value` record. sanitizeRows / normalizeEnvironments tolerate both
  // (and garbage), so old files still load.
  const normalize = (key: keyof ConfigScope, value: unknown): unknown => {
    if (key === "variables") {
      return sanitizeRows(value);
    }
    if (key === "environments") {
      return normalizeEnvironments(value);
    }
    return value;
  };
  return CONFIG_KEYS.reduce<ConfigScope>((acc, key) => {
    const flat = parsed[key];
    if (flat !== undefined) {
      return { ...acc, [key]: normalize(key, flat) };
    }
    if (legacy[key] !== undefined) {
      return { ...acc, [key]: normalize(key, legacy[key]) };
    }
    return acc;
  }, {});
}

type ParsedFolder = Omit<ConfigScope, "environments"> & {
  name?: string;
  // v5 stores config fields FLAT (mixed in above); `config` is the legacy nested
  // wrapper read as a fallback.
  config?: Omit<ConfigScope, "environments"> & { environments?: unknown };
  environments?: unknown;
  order?: number;
  // Legacy (<= the environments-array change): a separate env-name -> hex map.
  // Colors now ride inside each `environments` entry's `color`; read as a fallback.
  environmentColors?: Record<string, unknown>;
};

// Narrow a parsed `environments` to the in-memory Environment[] (name + variable
// rows; `color` is stripped - it's tracked on the folder node, not in config). A
// current doc stores an array of `{name, color?, variables}`; a legacy doc stored
// a `name -> { varName: value }` record. Variables migrate via sanitizeRows.
function normalizeEnvironments(value: unknown): Environment[] {
  if (Array.isArray(value)) {
    return value.flatMap((entry) => {
      if (typeof entry !== "object" || entry === null) {
        return [];
      }
      const env = entry as { name?: unknown; variables?: unknown };
      if (typeof env.name !== "string") {
        return [];
      }
      return [{ name: env.name, variables: sanitizeRows(env.variables) }];
    });
  }
  if (typeof value !== "object" || value === null) {
    return [];
  }
  return Object.entries(value as Record<string, unknown>).map(
    ([name, vars]) => ({ name, variables: sanitizeRows(vars) }),
  );
}

// The folder's env border colors, gathered from BOTH the per-entry `color` on the
// `environments` array (current shape) AND the legacy separate `environmentColors`
// record (fallback). Per-entry wins; only #rrggbb(aa) hex survives (lowercased).
function readEnvironmentColors(
  parsed: ParsedFolder,
): { environmentColors: Record<string, string> } | undefined {
  const clean: Record<string, string> = {};
  const envArray = Array.isArray(parsed.environments)
    ? parsed.environments
    : Array.isArray(parsed.config?.environments)
      ? parsed.config.environments
      : [];
  for (const entry of envArray) {
    if (typeof entry !== "object" || entry === null) {
      continue;
    }
    const env = entry as { name?: unknown; color?: unknown };
    if (
      typeof env.name === "string" &&
      typeof env.color === "string" &&
      HEX_COLOR.test(env.color)
    ) {
      clean[env.name] = env.color.toLowerCase();
    }
  }
  if (typeof parsed.environmentColors === "object" && parsed.environmentColors) {
    for (const [name, color] of Object.entries(parsed.environmentColors)) {
      if (typeof color === "string" && HEX_COLOR.test(color) && !(name in clean)) {
        clean[name] = color.toLowerCase();
      }
    }
  }
  return Object.keys(clean).length > 0
    ? { environmentColors: clean }
    : undefined;
}

// The disk shape for a folder's environments: each in-memory Environment plus its
// border `color` (from the separate environmentColors map) folded in, and an entry
// synthesized for any env colored-but-not-declared (empty variables). Undefined
// when there's nothing to write.
function environmentsToDisk(
  environments: Environment[] | undefined,
  colors: Record<string, string> | undefined,
): unknown[] | undefined {
  const envs = environments ?? [];
  const declared = new Set(envs.map((env) => env.name));
  const coloredOnly = Object.keys(colors ?? {}).filter(
    (name) => !declared.has(name),
  );
  const entries = [
    ...envs.map((env) => ({
      name: env.name,
      ...(colors?.[env.name] ? { color: colors[env.name] } : {}),
      variables: env.variables,
    })),
    ...coloredOnly.map((name) => ({
      name,
      color: colors![name],
      variables: [],
    })),
  ];
  return entries.length > 0 ? entries : undefined;
}

// The folder's config as the request-settings/folder JSON editor shows it: the
// flat config fields with `environments` REPLACED by the disk-merged array (each
// entry carrying its border `color`), so the editor doc matches the on-disk shape
// exactly - the same reason bodyField/paramsField/configField are exported.
export function folderConfigDoc(
  config: ConfigScope,
  colors: Record<string, string> | undefined,
): Record<string, unknown> {
  const envDisk = environmentsToDisk(config.environments, colors);
  const flat = configField(config);
  if (envDisk) {
    return { ...flat, environments: envDisk };
  }
  delete flat.environments;
  return flat;
}

// Read a folder JSON doc back into `{config, environmentColors}`: config via
// readConfig (normalizes env vars to rows, strips per-entry color), colors via
// readEnvironmentColors (per-entry color + legacy fallbacks). The inverse of
// folderConfigDoc, so the Settings editor round-trips the on-disk shape.
export function readFolderConfigDoc(parsed: Record<string, unknown>): {
  config: ConfigScope;
  environmentColors: Record<string, string>;
} {
  return {
    config: readConfig(parsed as Parameters<typeof readConfig>[0]),
    environmentColors:
      readEnvironmentColors(parsed as ParsedFolder)?.environmentColors ?? {},
  };
}

function tryParse<T>(raw: string): T | undefined {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return undefined;
  }
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
      // Fold the folder's env border colors into each `environments` entry (and
      // synthesize an entry for a colored-but-undeclared env), so disk carries ONE
      // environments array - no separate environmentColors field.
      const envDisk = environmentsToDisk(
        node.config.environments,
        node.environmentColors,
      );
      files[`${dir}/folder.json`] = JSON.stringify(
        {
          name: node.name,
          ...configField(node.config),
          ...(envDisk ? { environments: envDisk } : {}),
          order,
        },
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
        ...(node.httpVersion === "h3" ? { httpVersion: node.httpVersion } : {}),
        ...bodyField(node.body),
        ...paramsField(node.params),
        ...configField(node.config),
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
      { schemaVersion: 6, name: workspaceName },
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
      body: migrateBody(parsed),
      params: migrateParams(parsed),
      config: readConfig(parsed),
      ...(parsed.httpVersion === "h3" ? { httpVersion: "h3" as HttpVersion } : {}),
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
      config: readConfig(parsed ?? {}),
      ...(dotenv ? { dotenv } : {}),
      ...(parsed ? readEnvironmentColors(parsed) : {}),
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
