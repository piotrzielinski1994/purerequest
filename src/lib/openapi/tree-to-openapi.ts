import type {
  Auth,
  ConfigScope,
  Environment,
  KeyValue,
  RequestBody,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { keyValuesToRecord } from "@/lib/workspace/model";

export type OpenapiExportRoot = {
  name: string;
  config: ConfigScope;
  children: TreeNode[];
};

export type OpenapiDocument = Record<string, unknown>;

const OPENAPI_VERSION = "3.0.3";
const INFO_VERSION = "1.0.0";
const JSON_MEDIA_TYPE = "application/json";

type OpEntry = {
  path: string;
  method: string;
  operation: Record<string, unknown>;
  tag: string | undefined;
};

function toOpenapiPath(url: string): string {
  const withoutQuery = url.split("?")[0];
  const withoutToken = withoutQuery.replace(/^\{\{[^}]+\}\}/, "");
  const withoutHost = withoutToken.replace(
    /^[a-zA-Z][a-zA-Z0-9+.-]*:\/\/[^/]*/,
    "",
  );
  const templated = withoutHost.replace(/:([^/]+)/g, "{$1}");
  return templated.startsWith("/") ? templated : `/${templated}`;
}

function parameterOf(row: KeyValue, place: string): Record<string, unknown> {
  const base: Record<string, unknown> = {
    name: row.key,
    in: place,
    ...(place === "path" ? { required: true } : {}),
    schema: { type: "string" },
  };
  return row.value !== "" ? { ...base, example: row.value } : base;
}

function parametersOf(node: RequestNode): Record<string, unknown>[] {
  return [
    ...node.params.query.map((row) => parameterOf(row, "query")),
    ...node.params.path.map((row) => parameterOf(row, "path")),
    ...(node.config.headers ?? []).map((row) => parameterOf(row, "header")),
  ];
}

function parseJsonMaybe(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

function mediaFromRows(rows: KeyValue[]): Record<string, unknown> {
  return { schema: { type: "object" }, example: keyValuesToRecord(rows) };
}

function requestBodyOf(body: RequestBody): Record<string, unknown> | null {
  if (body.active === "none") {
    return null;
  }
  if (body.active === "json") {
    return {
      content: {
        [JSON_MEDIA_TYPE]: { example: parseJsonMaybe(body.types.json) },
      },
    };
  }
  if (body.active === "graphql") {
    return {
      content: {
        [JSON_MEDIA_TYPE]: {
          example: {
            query: body.types.graphql.query,
            variables: body.types.graphql.variables,
          },
        },
      },
    };
  }
  if (body.active === "form") {
    return {
      content: {
        "application/x-www-form-urlencoded": mediaFromRows(body.types.form),
      },
    };
  }
  return {
    content: { "multipart/form-data": mediaFromRows(body.types.multipart) },
  };
}

function operationOf(
  node: RequestNode,
  tag: string | undefined,
): Record<string, unknown> {
  const parameters = parametersOf(node);
  const body = requestBodyOf(node.body);
  return {
    summary: node.name,
    ...(tag !== undefined ? { tags: [tag] } : {}),
    ...(parameters.length > 0 ? { parameters } : {}),
    ...(body ? { requestBody: body } : {}),
  };
}

function collectOps(nodes: TreeNode[], tag: string | undefined): OpEntry[] {
  return nodes.flatMap<OpEntry>((node) => {
    if (node.kind === "request") {
      return [
        {
          path: toOpenapiPath(node.url),
          method: node.method.toLowerCase(),
          operation: operationOf(node, tag),
          tag,
        },
      ];
    }
    return collectOps(node.children, node.name);
  });
}

function pathsObject(ops: OpEntry[]): Record<string, unknown> {
  return Object.fromEntries(
    [...new Set(ops.map(({ path }) => path))].map(
      (path) =>
        [
          path,
          Object.fromEntries(
            ops
              .filter((op) => op.path === path)
              .map(({ method, operation }) => [method, operation] as const),
          ),
        ] as const,
    ),
  );
}

function baseUrlOf(rows: KeyValue[]): string {
  return keyValuesToRecord(rows).baseUrl ?? "";
}

function serversOf(config: ConfigScope): Array<Record<string, string>> {
  const environments: Environment[] = config.environments ?? [];
  if (environments.length > 0) {
    return environments.map((env) => ({
      url: baseUrlOf(env.variables),
      description: env.name,
    }));
  }
  const baseUrl = baseUrlOf(config.variables ?? []);
  return baseUrl !== "" ? [{ url: baseUrl }] : [];
}

type SecurityScheme = {
  name: string;
  scheme: { type: "http"; scheme: "bearer" | "basic" };
};

function securityOf(auth: Auth | undefined): SecurityScheme | null {
  if (!auth || auth.active === "inherit" || auth.active === "none") {
    return null;
  }
  if (auth.active === "bearer") {
    return { name: "bearerAuth", scheme: { type: "http", scheme: "bearer" } };
  }
  return { name: "basicAuth", scheme: { type: "http", scheme: "basic" } };
}

export function treeToOpenapiDoc(root: OpenapiExportRoot): OpenapiDocument {
  const ops = collectOps(root.children, undefined);
  const servers = serversOf(root.config);
  const security = securityOf(root.config.auth);
  const tagNames = [
    ...new Set(ops.flatMap((op) => (op.tag !== undefined ? [op.tag] : []))),
  ];
  return {
    openapi: OPENAPI_VERSION,
    info: { title: root.name, version: INFO_VERSION },
    ...(servers.length > 0 ? { servers } : {}),
    ...(tagNames.length > 0
      ? { tags: tagNames.map((name) => ({ name })) }
      : {}),
    paths: pathsObject(ops),
    ...(security
      ? {
          components: { securitySchemes: { [security.name]: security.scheme } },
          security: [{ [security.name]: [] }],
        }
      : {}),
  };
}
