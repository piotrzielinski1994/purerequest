import { parseDocument } from "yaml";
import { normalizeSwagger2 } from "@/lib/openapi/swagger2";

// An OpenAPI 3.x document, parsed but not deeply validated: every nested field is
// read + narrowed lazily by the mapper (openapi-to-tree). Only the version gate is
// enforced here; local `$ref` pointers are resolved against this same root by
// resolveRef. Total: this module never throws.
export type OpenapiDoc = Record<string, unknown> & { openapi: string };

const SUPPORTED_VERSION = /^3\.(0|1)(\.|$)/;
const MAX_REF_DEPTH = 32;

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// JSON first (stricter + faster for the common `.json` case), then YAML. The YAML
// pass is lenient: real-world OpenAPI files carry minor spec violations (e.g. a
// mis-quoted multi-line scalar) that a strict parse would reject wholesale, so we
// build the document tolerating recoverable errors and take the best-effort value.
// Undefined only when both passes yield nothing usable.
function parseText(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    // not JSON - fall through to YAML
  }
  try {
    return parseDocument(text, { logLevel: "silent" }).toJS();
  } catch {
    return undefined;
  }
}

// Parse an OpenAPI document (JSON or YAML) and version-gate it to 3.0/3.1. A
// Swagger 2.0 doc (`swagger: "2.0"`) is first normalized into the 3.x shape, so it
// passes the same gate and flows through the unchanged mapper. Total: invalid text,
// a non-object doc, a `swagger` other than "2.0", or a missing/other `openapi`
// value all yield null (never throws).
export function parseOpenapiDocument(text: string): OpenapiDoc | null {
  const parsed = parseText(text);
  if (!isRecord(parsed)) {
    return null;
  }
  const doc = parsed.swagger === "2.0" ? normalizeSwagger2(parsed) : parsed;
  const version = doc.openapi;
  if (typeof version !== "string" || !SUPPORTED_VERSION.test(version)) {
    return null;
  }
  return doc as OpenapiDoc;
}

// Split a JSON pointer (`#/a/b~1c`) into its decoded segments (`~1` -> `/`, `~0` -> `~`).
function pointerSegments(ref: string): string[] {
  return ref
    .slice(2)
    .split("/")
    .map((segment) => segment.replace(/~1/g, "/").replace(/~0/g, "~"));
}

// Resolve a local JSON-pointer `$ref` (`#/a/b/c`) against the root document, with a
// depth guard against cycles. A node that is not a `$ref` is returned as-is; an
// external ref (not starting `#/`), a broken pointer, or a too-deep chain yields
// undefined (treated as absent by the mapper).
export function resolveRef(
  root: Record<string, unknown>,
  node: unknown,
  depth = 0,
): unknown {
  if (!isRecord(node) || typeof node.$ref !== "string") {
    return node;
  }
  const ref = node.$ref;
  if (!ref.startsWith("#/") || depth >= MAX_REF_DEPTH) {
    return undefined;
  }
  const target = pointerSegments(ref).reduce<unknown>(
    (acc, segment) => (isRecord(acc) ? acc[segment] : undefined),
    root,
  );
  if (target === undefined) {
    return undefined;
  }
  return resolveRef(root, target, depth + 1);
}
