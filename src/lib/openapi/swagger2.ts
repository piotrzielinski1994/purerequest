import { isRecord } from "@/lib/openapi/parse-openapi";

// A Swagger 2.0 document normalized into the OpenAPI 3.x in-memory SHAPE the
// mapper (openapi-to-tree) already reads, so the mapper stays single-format. Only
// the handful of fields that moved between 2.0 and 3.x are rewritten; everything
// else (paths, tags, info, non-body params) is copied through untouched. Pure -
// never mutates the input.

const BODY_METHODS = ["get", "post", "put", "patch", "delete"];
const JSON_MEDIA_TYPE = "application/json";
const DEFAULT_SCHEME = "https";

// `<scheme>://<host><basePath>` from the first scheme (default https), host, and
// basePath. undefined when there is no host - the caller then omits `servers`, so
// the mapper falls back to relative paths.
function serverUrl(doc: Record<string, unknown>): string | undefined {
  if (typeof doc.host !== "string" || doc.host === "") {
    return undefined;
  }
  const scheme =
    Array.isArray(doc.schemes) && typeof doc.schemes[0] === "string"
      ? doc.schemes[0]
      : DEFAULT_SCHEME;
  const basePath = typeof doc.basePath === "string" ? doc.basePath : "";
  return `${scheme}://${doc.host}${basePath}`;
}

// Rewrite one operation: an `in: "body"` param's schema becomes the JSON
// requestBody schema, and every body param is dropped from `parameters` (non-body
// params stay verbatim). Operations without a body param are returned unchanged.
function normalizeOperation(op: Record<string, unknown>): Record<string, unknown> {
  if (!Array.isArray(op.parameters)) {
    return op;
  }
  const bodyParam = op.parameters.find(
    (param) => isRecord(param) && param.in === "body",
  );
  const nonBody = op.parameters.filter(
    (param) => !(isRecord(param) && param.in === "body"),
  );
  const withoutBody = { ...op, parameters: nonBody };
  if (!isRecord(bodyParam) || bodyParam.schema === undefined) {
    return withoutBody;
  }
  return {
    ...withoutBody,
    requestBody: {
      content: { [JSON_MEDIA_TYPE]: { schema: bodyParam.schema } },
    },
  };
}

function normalizePathItem(
  pathItem: Record<string, unknown>,
): Record<string, unknown> {
  return BODY_METHODS.reduce<Record<string, unknown>>((acc, method) => {
    const op = acc[method];
    return isRecord(op) ? { ...acc, [method]: normalizeOperation(op) } : acc;
  }, pathItem);
}

function normalizePaths(paths: unknown): Record<string, unknown> {
  if (!isRecord(paths)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(paths).map(([path, pathItem]) => [
      path,
      isRecord(pathItem) ? normalizePathItem(pathItem) : pathItem,
    ]),
  );
}

export function normalizeSwagger2(
  doc: Record<string, unknown>,
): Record<string, unknown> {
  const url = serverUrl(doc);
  const components = isRecord(doc.components) ? doc.components : {};
  const normalized: Record<string, unknown> = {
    ...doc,
    openapi: "3.0.0",
    paths: normalizePaths(doc.paths),
    ...(url !== undefined ? { servers: [{ url }] } : {}),
    ...(isRecord(doc.securityDefinitions)
      ? {
          components: {
            ...components,
            securitySchemes: doc.securityDefinitions,
          },
        }
      : {}),
  };
  delete normalized.swagger;
  return normalized;
}
