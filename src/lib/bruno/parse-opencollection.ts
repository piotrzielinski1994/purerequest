import { parse as parseYaml } from "yaml";
import type {
  Auth,
  BodyMode,
  HttpMethod,
  KeyValue,
  ScriptConfig,
} from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";
import type { ParsedBru } from "@/lib/bruno/parse-bru";

// OpenCollection YAML rows: headers/params/body-data/variables are all
// `{ name, value, disabled?, type? }` lists.
type YamlRow = {
  name?: unknown;
  value?: unknown;
  disabled?: unknown;
  type?: unknown;
};

type YamlAuth = {
  type?: unknown;
  token?: unknown;
  username?: unknown;
  password?: unknown;
};

type YamlBody = { type?: unknown; data?: unknown };

type YamlScript = { type?: unknown; code?: unknown };

type YamlDoc = {
  info?: { name?: unknown };
  http?: {
    method?: unknown;
    url?: unknown;
    headers?: unknown;
    params?: unknown;
    body?: unknown;
    auth?: unknown;
  };
  request?: { variables?: unknown; scripts?: unknown; auth?: unknown };
  runtime?: { scripts?: unknown };
  variables?: unknown;
};

const EMPTY: ParsedBru = {
  headers: [],
  params: [],
  body: "",
  bodyForm: [],
  graphqlVariables: "",
  variables: {},
  environments: {},
};

const METHODS = new Set<HttpMethod>(["GET", "POST", "PUT", "PATCH", "DELETE"]);

function asString(value: unknown): string {
  return typeof value === "string" ? value : value === undefined ? "" : String(value);
}

function isRowArray(value: unknown): value is YamlRow[] {
  return Array.isArray(value);
}

function toRows(value: unknown): KeyValue[] {
  if (!isRowArray(value)) {
    return [];
  }
  return value.flatMap<KeyValue>((row) => {
    const key = asString(row?.name);
    if (key === "") {
      return [];
    }
    return [{ key, value: asString(row?.value), enabled: row?.disabled !== true }];
  });
}

// The set of query-param keys already written into a url's `?a=&b=` string.
// Bruno mirrors query params in both the url AND the params block, so a param
// already in the url must not be re-appended (it would duplicate).
function urlQueryKeys(url: string | undefined): Set<string> {
  if (url === undefined) {
    return new Set();
  }
  const query = url.split("?")[1];
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

// Param rows count only when `type` is `query` or absent; path/file params are
// part of the URL template / unsupported, so they're dropped. A key already in
// the url's query string is dropped too (the url query wins; no duplicate).
function toQueryParams(value: unknown, url: string | undefined): KeyValue[] {
  if (!isRowArray(value)) {
    return [];
  }
  const inUrl = urlQueryKeys(url);
  return value
    .filter((row) => row?.type === undefined || row?.type === "query")
    .flatMap<KeyValue>((row) => {
      const key = asString(row?.name);
      if (key === "" || inUrl.has(key)) {
        return [];
      }
      return [
        { key, value: asString(row?.value), enabled: row?.disabled !== true },
      ];
    });
}

function toRecord(value: unknown): Record<string, string> {
  return toRows(value).reduce<Record<string, string>>(
    (acc, { key, value: rowValue }) => ({ ...acc, [key]: rowValue }),
    {},
  );
}

function resolveAuth(value: unknown): Auth | undefined {
  if (typeof value === "string") {
    if (value === "inherit") {
      return authOf({ active: "inherit" });
    }
    if (value === "none") {
      return authOf({ active: "none" });
    }
    return undefined;
  }
  if (typeof value !== "object" || value === null) {
    return undefined;
  }
  const auth = value as YamlAuth;
  if (auth.type === "bearer") {
    return authOf({ active: "bearer", token: asString(auth.token) });
  }
  if (auth.type === "basic") {
    return authOf({
      active: "basic",
      username: asString(auth.username),
      password: asString(auth.password),
    });
  }
  if (auth.type === "none") {
    return authOf({ active: "none" });
  }
  if (auth.type === "inherit") {
    return authOf({ active: "inherit" });
  }
  return undefined;
}

function resolveBody(value: unknown): {
  body: string;
  bodyMode?: BodyMode;
  bodyForm: KeyValue[];
} {
  if (typeof value !== "object" || value === null) {
    return { body: "", bodyForm: [] };
  }
  const body = value as YamlBody;
  if (body.type === "form-urlencoded") {
    return { body: "", bodyMode: "form", bodyForm: toRows(body.data) };
  }
  if (body.type === "multipart-form") {
    return { body: "", bodyMode: "multipart", bodyForm: toRows(body.data) };
  }
  return { body: asString(body.data), bodyForm: [] };
}

function isScriptArray(value: unknown): value is YamlScript[] {
  return Array.isArray(value);
}

function resolveScripts(
  request: YamlDoc["request"],
  runtime: YamlDoc["runtime"],
): ScriptConfig | undefined {
  const entries = [
    ...(isScriptArray(request?.scripts) ? request.scripts : []),
    ...(isScriptArray(runtime?.scripts) ? runtime.scripts : []),
  ];
  const pre = entries.find(
    (script) => script?.type === "before-request" || script?.type === "pre-request",
  );
  const post = entries.find(
    (script) => script?.type === "after-response" || script?.type === "post-response",
  );
  if (!pre && !post) {
    return undefined;
  }
  return {
    ...(pre ? { pre: asString(pre.code) } : {}),
    ...(post ? { post: asString(post.code) } : {}),
  };
}

// Parse an OpenCollection YAML file (request, folder.yml, opencollection.yml, or
// an environment file) into the shared `ParsedBru` shape. Total - a YAML parse
// failure or non-object document yields the empty best-effort record.
export function parseOpenCollection(text: string): ParsedBru {
  let doc: YamlDoc | null;
  try {
    doc = parseYaml(text) as YamlDoc | null;
  } catch {
    return EMPTY;
  }
  if (typeof doc !== "object" || doc === null) {
    return EMPTY;
  }

  const http = doc.http ?? {};
  const methodRaw = asString(http.method).toUpperCase();
  const method = METHODS.has(methodRaw as HttpMethod)
    ? (methodRaw as HttpMethod)
    : undefined;
  const url = http.url !== undefined ? asString(http.url) : undefined;
  const name = doc.info?.name !== undefined ? asString(doc.info.name) : undefined;
  const { body, bodyMode, bodyForm } = resolveBody(http.body);
  const auth = resolveAuth(http.auth ?? doc.request?.auth);
  const scripts = resolveScripts(doc.request, doc.runtime);
  // A request file carries vars under `variables` (top-level, environment files)
  // or `request.variables` (folder/collection files).
  const variables = {
    ...toRecord(doc.request?.variables),
    ...toRecord(doc.variables),
  };

  return {
    ...(name !== undefined && name !== "" ? { name } : {}),
    ...(method ? { method } : {}),
    ...(url !== undefined ? { url } : {}),
    headers: toRows(http.headers),
    params: toQueryParams(http.params, url),
    ...(bodyMode ? { bodyMode } : {}),
    body,
    bodyForm,
    graphqlVariables: "",
    ...(auth ? { auth } : {}),
    variables,
    ...(scripts ? { scripts } : {}),
    environments: {},
  };
}
