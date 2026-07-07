// A request's json body is held in-memory as a plain `string` (what the editor +
// the HTTP wire need). On disk and in the full-request Settings JSON it is written
// as its natural JSON value when it parses as a JSON object/array (so it renders as
// real nested JSON, not an escaped `"{\n ...}"` string), else verbatim as a string.
// These helpers convert at that boundary.

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

// in-memory string -> disk value. A body that parses as a JSON object/array becomes
// its parsed value (real nested JSON); everything else (empty, scalar, or non-JSON
// text) stays the raw string.
export function bodyToDisk(body: string): unknown {
  if (isJsonObjectOrArray(body)) {
    return JSON.parse(body);
  }
  return body;
}

// disk value -> in-memory string. A string is verbatim; a JSON object/array is
// pretty-printed; undefined/null fall back to "". This is the reverse of
// bodyToDisk for the current `body.types.json` slot - no tag handling, so a body
// that happens to look like the retired tag is never misread.
export function diskToBody(value: unknown): string {
  if (value === undefined || value === null) {
    return "";
  }
  if (typeof value === "string") {
    return value;
  }
  return JSON.stringify(value, null, 2);
}

// Decode the RETIRED tagged `{type:"json"|"text", payload}` body shape from a
// legacy (v3) on-disk doc into an in-memory string. A v2 doc stored `body` as a
// bare string; unknown shapes fall back to "". Only the legacy read path calls
// this - the current format stores the json body as its natural value.
export function legacyStoredToBody(stored: unknown): string {
  if (typeof stored === "object" && stored !== null && "type" in stored) {
    const tagged = stored as { type?: unknown; payload?: unknown };
    if (tagged.type === "json") {
      return JSON.stringify(tagged.payload, null, 2);
    }
    if (tagged.type === "text") {
      return typeof tagged.payload === "string" ? tagged.payload : "";
    }
  }
  return diskToBody(stored);
}
