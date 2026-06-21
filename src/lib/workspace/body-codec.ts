// A request body is held in-memory as a plain `string` (what the editor + the
// HTTP wire need). On disk and in the full-request Settings JSON it is a tagged
// `StoredBody` so a JSON body renders as real nested JSON (no `"{\n ...}"`
// escaping) and is comfortable to edit. These helpers convert at that boundary.

export type StoredBody =
  | { type: "json"; payload: unknown }
  | { type: "text"; payload: string };

// Only a JSON object or array counts as a "json" body - a bare scalar literal
// (number/bool/null/quoted-string) stays text, so a plain-text body that happens
// to parse as a JSON scalar round-trips verbatim instead of gaining/changing quotes.
function isJsonObjectOrArray(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed[0] !== "{" && trimmed[0] !== "[") {
    return false;
  }
  try {
    JSON.parse(trimmed);
    return true;
  } catch {
    return false;
  }
}

// in-memory string -> StoredBody. A body that parses as a JSON object/array
// becomes `{type:"json", payload:<parsed>}`; everything else (empty, scalar, or
// non-JSON text) becomes `{type:"text", payload:<raw>}`.
export function bodyToStored(body: string): StoredBody {
  if (isJsonObjectOrArray(body)) {
    return { type: "json", payload: JSON.parse(body) };
  }
  return { type: "text", payload: body };
}

// StoredBody (or a legacy raw string, or undefined) -> in-memory string.
// Tolerant: legacy workspaces stored `body` as a bare string; unknown shapes
// fall back to "".
export function storedToBody(stored: unknown): string {
  if (stored === undefined || stored === null) {
    return "";
  }
  if (typeof stored === "string") {
    return stored;
  }
  if (typeof stored === "object" && "type" in stored) {
    const tagged = stored as { type?: unknown; payload?: unknown };
    if (tagged.type === "json") {
      return JSON.stringify(tagged.payload, null, 2);
    }
    if (tagged.type === "text") {
      return typeof tagged.payload === "string" ? tagged.payload : "";
    }
  }
  return "";
}
