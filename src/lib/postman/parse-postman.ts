import type {
  Auth,
  ConfigScope,
  Environment,
  FolderNode,
  HttpMethod,
  KeyValue,
  RequestBody,
  RequestNode,
  ScriptConfig,
  TreeNode,
} from "@/lib/workspace/model";
import { authOf, emptyBody } from "@/lib/workspace/model";

// A Postman v2.1 collection is a single nested-JSON file: the `item` array holds
// folders (which own their own `item`) and requests (which own a `request`). This
// module parses that document into a purerequest subtree, total (never throws): invalid
// JSON or a doc missing `info`+`item` yields null; unknown fields are skipped.

type PostmanRow = {
  key?: unknown;
  value?: unknown;
  disabled?: unknown;
  enabled?: unknown;
  type?: unknown;
};

type PostmanAuth = { type?: unknown } & Record<string, unknown>;

type PostmanBody = {
  mode?: unknown;
  raw?: unknown;
  urlencoded?: unknown;
  formdata?: unknown;
  graphql?: unknown;
};

type PostmanUrl = {
  raw?: unknown;
  protocol?: unknown;
  host?: unknown;
  path?: unknown;
  query?: unknown;
  variable?: unknown;
};

type PostmanScript = { exec?: unknown };

type PostmanEvent = { listen?: unknown; script?: unknown };

type PostmanRequest = {
  method?: unknown;
  url?: unknown;
  header?: unknown;
  body?: unknown;
  auth?: unknown;
};

type PostmanItem = {
  name?: unknown;
  item?: unknown;
  request?: unknown;
  event?: unknown;
  variable?: unknown;
  auth?: unknown;
};

type PostmanDoc = {
  info?: { name?: unknown };
  item?: unknown;
  variable?: unknown;
  auth?: unknown;
  event?: unknown;
};

type PostmanEnvDoc = { name?: unknown; values?: unknown };

const METHODS = new Set<HttpMethod>([
  "GET",
  "POST",
  "PUT",
  "PATCH",
  "DELETE",
  "QUERY",
]);

function asString(value: unknown): string {
  if (typeof value === "string") {
    return value;
  }
  return value === undefined || value === null ? "" : String(value);
}

function isRowArray(value: unknown): value is PostmanRow[] {
  return Array.isArray(value);
}

// Enabled/disabled rows for headers/query/form/multipart: `disabled:true` maps to
// `enabled:false`, everything else to `enabled:true` (always present, like purerequest's
// own grids). Rows with a blank key are dropped.
function toRows(value: unknown): KeyValue[] {
  if (!isRowArray(value)) {
    return [];
  }
  return value.flatMap<KeyValue>((row) => {
    const key = asString(row?.key);
    if (key === "") {
      return [];
    }
    return [{ key, value: asString(row?.value), enabled: row?.disabled !== true }];
  });
}

// Fold a Postman `[{key,value}]` auth array into a record for keyed lookups.
function authRecord(value: unknown): Record<string, string> {
  if (!isRowArray(value)) {
    return {};
  }
  return value.reduce<Record<string, string>>((acc, row) => {
    const key = asString(row?.key);
    return key === "" ? acc : { ...acc, [key]: asString(row?.value) };
  }, {});
}

const METHOD_FROM = (value: unknown): HttpMethod => {
  const upper = asString(value).toUpperCase();
  return METHODS.has(upper as HttpMethod) ? (upper as HttpMethod) : "GET";
};

// The set of query-param keys already written into a url's `?a=&b=` string. Postman
// mirrors query in both `url.raw` and `url.query`, so a key already in the raw url is
// dropped from the params grid (the url wins, no duplicate).
function urlQueryKeys(raw: string): Set<string> {
  const query = raw.split("?")[1];
  if (query === undefined) {
    return new Set();
  }
  return new Set(
    query
      .split("&")
      .map((pair) => pair.split("=")[0])
      .filter((key) => key !== ""),
  );
}

// The request url: a bare string, `url.raw`, else a best-effort reconstruction from
// protocol/host/path (host + path arrays joined), else "".
function urlOf(url: unknown): string {
  if (typeof url === "string") {
    return url;
  }
  if (typeof url !== "object" || url === null) {
    return "";
  }
  const obj = url as PostmanUrl;
  if (typeof obj.raw === "string") {
    return obj.raw;
  }
  const protocol = asString(obj.protocol);
  const host = Array.isArray(obj.host) ? obj.host.map(asString).join(".") : asString(obj.host);
  const path = Array.isArray(obj.path)
    ? obj.path.map(asString).join("/")
    : asString(obj.path);
  if (host === "" && path === "") {
    return "";
  }
  const scheme = protocol === "" ? "" : `${protocol}://`;
  const slash = path === "" || path.startsWith("/") ? "" : "/";
  return `${scheme}${host}${slash}${path}`;
}

function queryParamsOf(url: unknown): KeyValue[] {
  if (typeof url !== "object" || url === null) {
    return [];
  }
  const inUrl = urlQueryKeys(urlOf(url));
  return toRows((url as PostmanUrl).query).filter((row) => !inUrl.has(row.key));
}

function pathParamsOf(url: unknown): KeyValue[] {
  if (typeof url !== "object" || url === null) {
    return [];
  }
  const variable = (url as PostmanUrl).variable;
  if (!isRowArray(variable)) {
    return [];
  }
  return variable.flatMap<KeyValue>((row) => {
    const key = asString(row?.key);
    return key === "" ? [] : [{ key, value: asString(row?.value), enabled: true }];
  });
}

function bodyOf(value: unknown): RequestBody {
  const body = emptyBody();
  if (typeof value !== "object" || value === null) {
    body.active = "none";
    return body;
  }
  const doc = value as PostmanBody;
  if (doc.mode === "raw") {
    body.active = "json";
    body.types.json = asString(doc.raw);
    return body;
  }
  if (doc.mode === "urlencoded") {
    body.active = "form";
    body.types.form = toRows(doc.urlencoded);
    return body;
  }
  if (doc.mode === "formdata") {
    body.active = "multipart";
    body.types.multipart = toRows(doc.formdata);
    return body;
  }
  if (doc.mode === "graphql" && typeof doc.graphql === "object" && doc.graphql !== null) {
    const gql = doc.graphql as { query?: unknown; variables?: unknown };
    body.active = "graphql";
    body.types.graphql = {
      query: asString(gql.query),
      variables: asString(gql.variables),
    };
    return body;
  }
  body.active = "none";
  return body;
}

// bearer/basic/noauth map to a concrete Auth; every other type (apikey/oauth2/...)
// yields undefined so the request inherits from an ancestor scope.
function authOfPostman(value: unknown): Auth | undefined {
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const auth = value as PostmanAuth;
  if (auth.type === "bearer") {
    return authOf({ active: "bearer", token: authRecord(auth.bearer).token ?? "" });
  }
  if (auth.type === "basic") {
    const record = authRecord(auth.basic);
    return authOf({
      active: "basic",
      username: record.username ?? "",
      password: record.password ?? "",
    });
  }
  if (auth.type === "noauth") {
    return authOf({ active: "none" });
  }
  return undefined;
}

function execText(script: unknown): string {
  if (typeof script !== "object" || script === null) {
    return "";
  }
  const exec = (script as PostmanScript).exec;
  if (Array.isArray(exec)) {
    return exec.map(asString).join("\n");
  }
  return asString(exec);
}

function scriptsOf(value: unknown): ScriptConfig | undefined {
  if (!Array.isArray(value)) {
    return undefined;
  }
  const events = value as PostmanEvent[];
  const pre = events.find((event) => event?.listen === "prerequest");
  const post = events.find((event) => event?.listen === "test");
  const preText = pre ? execText(pre.script) : "";
  const postText = post ? execText(post.script) : "";
  if (preText === "" && postText === "") {
    return undefined;
  }
  return {
    ...(preText !== "" ? { pre: preText } : {}),
    ...(postText !== "" ? { post: postText } : {}),
  };
}

function variablesOf(value: unknown): KeyValue[] {
  if (!isRowArray(value)) {
    return [];
  }
  return value.flatMap<KeyValue>((row) => {
    const key = asString(row?.key);
    return key === "" ? [] : [{ key, value: asString(row?.value) }];
  });
}

type IdGen = () => string;

function makeIdGen(): IdGen {
  let counter = 0;
  return () => {
    counter += 1;
    return `postman-${counter}`;
  };
}

function requestConfig(request: PostmanRequest, event: unknown): ConfigScope {
  const headers = toRows(request.header);
  const auth = authOfPostman(request.auth);
  const scripts = scriptsOf(event);
  return {
    ...(headers.length > 0 ? { headers } : {}),
    ...(auth ? { auth } : {}),
    ...(scripts ? { scripts } : {}),
  };
}

function scopeConfig(item: PostmanItem): ConfigScope {
  const variables = variablesOf(item.variable);
  const auth = authOfPostman(item.auth);
  const scripts = scriptsOf(item.event);
  return {
    ...(variables.length > 0 ? { variables } : {}),
    ...(auth ? { auth } : {}),
    ...(scripts ? { scripts } : {}),
  };
}

function toRequestNode(item: PostmanItem, nextId: IdGen): RequestNode {
  const request = item.request as PostmanRequest;
  return {
    kind: "request",
    id: nextId(),
    name: asString(item.name),
    method: METHOD_FROM(request.method),
    url: urlOf(request.url),
    body: bodyOf(request.body),
    params: { path: pathParamsOf(request.url), query: queryParamsOf(request.url) },
    config: requestConfig(request, item.event),
  };
}

function walkItems(value: unknown, nextId: IdGen): TreeNode[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return (value as PostmanItem[]).flatMap<TreeNode>((item) => {
    if (typeof item !== "object" || item === null) {
      return [];
    }
    if (item.request !== undefined && typeof item.request === "object") {
      return [toRequestNode(item, nextId)];
    }
    if (Array.isArray(item.item)) {
      const folder: FolderNode = {
        kind: "folder",
        id: nextId(),
        name: asString(item.name),
        config: scopeConfig(item),
        children: walkItems(item.item, nextId),
      };
      return [folder];
    }
    return [];
  });
}

// Parse a Postman v2.1 collection JSON into a single root FolderNode wrapping the
// whole collection. Returns null for invalid JSON or a doc missing `info`+`item`.
export function parsePostmanCollection(
  text: string,
  fallbackName: string,
): FolderNode | null {
  let doc: PostmanDoc | null;
  try {
    doc = JSON.parse(text) as PostmanDoc | null;
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) {
    return null;
  }
  if (typeof doc.info !== "object" || doc.info === null || !Array.isArray(doc.item)) {
    return null;
  }
  const nextId = makeIdGen();
  const infoName = asString(doc.info.name);
  const variables = variablesOf(doc.variable);
  const auth = authOfPostman(doc.auth);
  const scripts = scriptsOf(doc.event);
  return {
    kind: "folder",
    id: nextId(),
    name: infoName !== "" ? infoName : fallbackName,
    config: {
      ...(variables.length > 0 ? { variables } : {}),
      ...(auth ? { auth } : {}),
      ...(scripts ? { scripts } : {}),
    },
    children: walkItems(doc.item, nextId),
  };
}

// Parse a Postman environment JSON (`{name, values:[{key,value,enabled?}]}`) into an
// Environment. An enabled/absent value drops the `enabled` flag (like purerequest's own env
// rows); `enabled:false` is kept. Returns null when the doc has no name+values.
export function parsePostmanEnvironment(text: string): Environment | null {
  let doc: PostmanEnvDoc | null;
  try {
    doc = JSON.parse(text) as PostmanEnvDoc | null;
  } catch {
    return null;
  }
  if (typeof doc !== "object" || doc === null) {
    return null;
  }
  const name = asString(doc.name);
  if (name === "" || !Array.isArray(doc.values)) {
    return null;
  }
  const variables = (doc.values as PostmanRow[]).flatMap<KeyValue>((row) => {
    const key = asString(row?.key);
    if (key === "") {
      return [];
    }
    const value = asString(row?.value);
    return [row?.enabled === false ? { key, value, enabled: false } : { key, value }];
  });
  return { name, variables };
}
