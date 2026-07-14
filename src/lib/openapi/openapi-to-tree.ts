import type {
  Auth,
  ConfigScope,
  Environment,
  FolderNode,
  HttpMethod,
  KeyValue,
  RequestBody,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";
import {
  isRecord,
  parseOpenapiDocument,
  resolveRef,
} from "@/lib/openapi/parse-openapi";

// An OpenAPI 3.x document -> a ReqUI subtree: one request per operation, grouped
// into per-tag folders (untagged operations sit directly under the root), servers
// folded into a `baseUrl` variable + environments, and the global security scheme
// seeded onto the root's auth. Total: parse failures / no-operation docs yield [].
// A Swagger 2.0 document is normalized to this same 3.x shape upstream
// (parseOpenapiDocument -> normalizeSwagger2), so this mapper stays single-format.

const METHODS: Record<string, HttpMethod> = {
  get: "GET",
  post: "POST",
  put: "PUT",
  patch: "PATCH",
  delete: "DELETE",
};

const JSON_MEDIA_TYPE = "application/json";

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return value === undefined || value === null ? "" : String(value);
}

type IdGen = () => string;

function makeIdGen(): IdGen {
  let counter = 0;
  return () => {
    counter += 1;
    return `openapi-${counter}`;
  };
}

// A server url with its `{x}` template vars filled from `variables.<x>.default` and
// any trailing slash stripped (so `{{baseUrl}}` + `/path` never doubles the slash).
function serverUrl(server: unknown): string {
  if (!isRecord(server) || typeof server.url !== "string") {
    return "";
  }
  const variables = isRecord(server.variables) ? server.variables : {};
  const filled = server.url.replace(/\{([^}]+)\}/g, (literal, name: string) => {
    const variable = variables[name];
    const fallback = isRecord(variable) ? asString(variable.default) : "";
    return fallback === "" ? literal : fallback;
  });
  return filled.replace(/\/+$/, "");
}

function serverName(server: unknown, index: number): string {
  const description = isRecord(server) ? asString(server.description).trim() : "";
  return description !== "" ? description : `Server ${index + 1}`;
}

function serversOf(doc: Record<string, unknown>): {
  baseUrl: string | undefined;
  environments: Environment[];
} {
  const servers = Array.isArray(doc.servers) ? doc.servers : [];
  // Pair each server with its (original) index BEFORE filtering, so a dropped
  // invalid entry never shifts the "Server N" numbering of the ones that remain.
  const valid = servers
    .map((server, index) => ({ url: serverUrl(server), name: serverName(server, index) }))
    .filter((entry) => entry.url !== "");
  if (valid.length === 0) {
    return { baseUrl: undefined, environments: [] };
  }
  if (valid.length === 1) {
    return { baseUrl: valid[0].url, environments: [] };
  }
  const environments = valid.map<Environment>((entry) => ({
    name: entry.name,
    variables: [{ key: "baseUrl", value: entry.url }],
  }));
  return { baseUrl: valid[0].url, environments };
}

// Seed the root auth from the global `security` requirement + `securitySchemes`: an
// http+bearer scheme -> bearer, http+basic -> basic, any other type -> no auth.
function securityAuthOf(doc: Record<string, unknown>): Auth | undefined {
  const security = Array.isArray(doc.security) ? doc.security : [];
  const requirement = security[0];
  if (!isRecord(requirement)) {
    return undefined;
  }
  const schemeName = Object.keys(requirement)[0];
  if (schemeName === undefined) {
    return undefined;
  }
  const components = isRecord(doc.components) ? doc.components : {};
  const schemes = isRecord(components.securitySchemes)
    ? components.securitySchemes
    : {};
  const scheme = resolveRef(doc, schemes[schemeName]);
  if (!isRecord(scheme) || scheme.type !== "http") {
    return undefined;
  }
  if (scheme.scheme === "bearer") {
    return authOf({ active: "bearer", token: "" });
  }
  if (scheme.scheme === "basic") {
    return authOf({ active: "basic", username: "", password: "" });
  }
  return undefined;
}

type ParamRow = { key: string; value: string; place: string };

// Seed a parameter's value from `example`, else a top-level `default` (Swagger 2.0
// puts a non-body param's default there, not under `schema`), else the schema's
// `example`/`default` (OpenAPI 3.x).
function paramValue(root: Record<string, unknown>, param: Record<string, unknown>): string {
  if (param.example !== undefined) {
    return asString(param.example);
  }
  if (param.default !== undefined) {
    return asString(param.default);
  }
  const schema = resolveRef(root, param.schema);
  if (isRecord(schema)) {
    if (schema.example !== undefined) {
      return asString(schema.example);
    }
    if (schema.default !== undefined) {
      return asString(schema.default);
    }
  }
  return "";
}

// Resolve + merge the path-level and operation-level parameters, keyed by `in:name`
// so the operation wins on a clash, in first-appearance order.
function paramRows(
  root: Record<string, unknown>,
  pathParams: unknown,
  opParams: unknown,
): ParamRow[] {
  const raw = [
    ...(Array.isArray(pathParams) ? pathParams : []),
    ...(Array.isArray(opParams) ? opParams : []),
  ];
  const byKey = new Map<string, ParamRow>();
  for (const entry of raw) {
    const param = resolveRef(root, entry);
    if (!isRecord(param) || typeof param.name !== "string" || typeof param.in !== "string") {
      continue;
    }
    const key = `${param.in}:${param.name}`;
    byKey.set(key, {
      key: param.name,
      value: paramValue(root, param),
      place: param.in,
    });
  }
  return [...byKey.values()];
}

function toGrid(rows: ParamRow[], place: string): KeyValue[] {
  return rows
    .filter((row) => row.place === place)
    .map((row) => ({ key: row.key, value: row.value }));
}

// The first `application/json` example value: media-type `example`, else the first
// `examples[*].value`, else the (`$ref`-resolved) media-type `schema.example`.
// undefined when none. The schema is resolved against the doc root so a
// `#/definitions/X` (Swagger 2.0) or `#/components/schemas/X` (3.x) body ref whose
// definition carries an `example` is honored, not just an inline schema.
function jsonExample(
  root: Record<string, unknown>,
  mediaType: Record<string, unknown>,
): unknown {
  if (mediaType.example !== undefined) {
    return mediaType.example;
  }
  if (isRecord(mediaType.examples)) {
    const first = Object.values(mediaType.examples)[0];
    if (isRecord(first) && first.value !== undefined) {
      return first.value;
    }
  }
  const schema = resolveRef(root, mediaType.schema);
  if (isRecord(schema) && schema.example !== undefined) {
    return schema.example;
  }
  return undefined;
}

function bodyOf(root: Record<string, unknown>, requestBody: unknown): RequestBody {
  const body = emptyBody();
  const resolved = resolveRef(root, requestBody);
  const content = isRecord(resolved) ? resolved.content : undefined;
  const mediaType = isRecord(content) ? content[JSON_MEDIA_TYPE] : undefined;
  if (!isRecord(mediaType)) {
    body.active = "none";
    return body;
  }
  const example = jsonExample(root, mediaType);
  if (example === undefined) {
    body.active = "none";
    return body;
  }
  body.active = "json";
  body.types.json = JSON.stringify(example, null, 2);
  return body;
}

// OpenAPI path templating `/users/{id}` -> ReqUI `/users/:id`. `{{token}}` in a
// server-derived prefix is added separately, so only the path is rewritten here.
function toReqUiPath(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ":$1");
}

function operationName(method: HttpMethod, path: string, op: Record<string, unknown>): string {
  if (typeof op.summary === "string" && op.summary !== "") {
    return op.summary;
  }
  if (typeof op.operationId === "string" && op.operationId !== "") {
    return op.operationId;
  }
  return `${method} ${path}`;
}

function toRequestNode(
  root: Record<string, unknown>,
  path: string,
  method: HttpMethod,
  pathParams: unknown,
  op: Record<string, unknown>,
  baseUrl: string | undefined,
  nextId: IdGen,
): RequestNode {
  const rows = paramRows(root, pathParams, op.parameters);
  const headers = toGrid(rows, "header");
  const reqUiPath = toReqUiPath(path);
  const url = baseUrl === undefined ? reqUiPath : `{{baseUrl}}${reqUiPath}`;
  return {
    kind: "request",
    id: nextId(),
    name: operationName(method, path, op),
    method,
    url,
    body: bodyOf(root, op.requestBody),
    params: {
      ...emptyParams(),
      path: toGrid(rows, "path"),
      query: toGrid(rows, "query"),
    },
    config: headers.length > 0 ? { headers } : {},
  };
}

function firstTag(op: Record<string, unknown>): string | undefined {
  if (!Array.isArray(op.tags)) {
    return undefined;
  }
  const tag = op.tags[0];
  return typeof tag === "string" && tag !== "" ? tag : undefined;
}

type OpEntry = { request: RequestNode; tag: string | undefined };

// Every supported operation across all paths, in document order, tagged with its
// first tag (undefined = untagged). $ref path items are resolved.
function collectOperations(
  doc: Record<string, unknown>,
  baseUrl: string | undefined,
  nextId: IdGen,
): OpEntry[] {
  const paths = isRecord(doc.paths) ? doc.paths : {};
  return Object.entries(paths).flatMap<OpEntry>(([path, pathItemRaw]) => {
    const pathItem = resolveRef(doc, pathItemRaw);
    if (!isRecord(pathItem)) {
      return [];
    }
    return Object.entries(METHODS).flatMap<OpEntry>(([key, method]) => {
      const op = pathItem[key];
      if (!isRecord(op)) {
        return [];
      }
      const request = toRequestNode(
        doc,
        path,
        method,
        pathItem.parameters,
        op,
        baseUrl,
        nextId,
      );
      return [{ request, tag: firstTag(op) }];
    });
  });
}

// Assemble the root children: an untagged operation is a loose request, a tagged one
// goes into its (first-appearance) tag folder, both preserving encounter order.
function groupByTag(entries: OpEntry[], nextId: IdGen): TreeNode[] {
  const buckets = new Map<string, RequestNode[]>();
  const slots: Array<{ tag: string } | { request: RequestNode }> = [];
  for (const entry of entries) {
    if (entry.tag === undefined) {
      slots.push({ request: entry.request });
      continue;
    }
    if (!buckets.has(entry.tag)) {
      buckets.set(entry.tag, []);
      slots.push({ tag: entry.tag });
    }
    buckets.get(entry.tag)!.push(entry.request);
  }
  return slots.map<TreeNode>((slot) => {
    if ("request" in slot) {
      return slot.request;
    }
    const folder: FolderNode = {
      kind: "folder",
      id: nextId(),
      name: slot.tag,
      config: {},
      children: buckets.get(slot.tag) ?? [],
    };
    return folder;
  });
}

function rootConfig(
  baseUrl: string | undefined,
  environments: Environment[],
  auth: Auth | undefined,
): ConfigScope {
  return {
    ...(baseUrl !== undefined ? { variables: [{ key: "baseUrl", value: baseUrl }] } : {}),
    ...(environments.length > 0 ? { environments } : {}),
    ...(auth ? { auth } : {}),
  };
}

export function openapiToTree(text: string, fallbackName: string): TreeNode[] {
  const doc = parseOpenapiDocument(text);
  if (doc === null) {
    return [];
  }
  const nextId = makeIdGen();
  const { baseUrl, environments } = serversOf(doc);
  const entries = collectOperations(doc, baseUrl, nextId);
  if (entries.length === 0) {
    return [];
  }
  const children = groupByTag(entries, nextId);
  const info = isRecord(doc.info) ? doc.info : {};
  const title = typeof info.title === "string" ? info.title : "";
  const root: FolderNode = {
    kind: "folder",
    id: nextId(),
    name: title !== "" ? title : fallbackName,
    config: rootConfig(baseUrl, environments, securityAuthOf(doc)),
    children,
  };
  return [root];
}
