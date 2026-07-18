import type { BodyMode, KeyValue, RequestBody } from "@/lib/workspace/model";

// A fixed, deterministic boundary token. The script/test env forbids
// Math.random; a long fixed token keeps multipart output stable + testable and
// is unlikely to collide with text-part content.
const MULTIPART_BOUNDARY = "----purerequestFormBoundary7MA4YWxkTrZu0gW";

const CONTENT_TYPE: Record<Exclude<BodyMode, "none">, string> = {
  json: "application/json",
  form: "application/x-www-form-urlencoded",
  multipart: `multipart/form-data; boundary=${MULTIPART_BOUNDARY}`,
  graphql: "application/json",
};

export type EncodedBody = { body: string | null; contentType: string | null };

function enabledRows(rows: KeyValue[], subst: (input: string) => string) {
  return rows
    .filter((row) => row.enabled !== false)
    .map((row) => ({ key: subst(row.key), value: subst(row.value) }))
    .filter((row) => row.key.trim() !== "");
}

function encodeForm(rows: KeyValue[], subst: (input: string) => string): string {
  const search = new URLSearchParams();
  enabledRows(rows, subst).forEach(({ key, value }) => search.append(key, value));
  return search.toString();
}

function encodeMultipart(
  rows: KeyValue[],
  subst: (input: string) => string,
): string {
  const parts = enabledRows(rows, subst).map(
    ({ key, value }) =>
      `--${MULTIPART_BOUNDARY}\r\n` +
      `Content-Disposition: form-data; name="${key}"\r\n\r\n` +
      `${value}\r\n`,
  );
  return `${parts.join("")}--${MULTIPART_BOUNDARY}--\r\n`;
}

// Parse the variables text (after {{var}} substitution) into a JSON object. Only
// a plain object counts: blank, unparseable, arrays and scalars all resolve to
// undefined so the `variables` key is omitted from the wire (common GraphQL-over-
// HTTP practice - variables is a map).
function parseGraphqlVariables(text: string): Record<string, unknown> | undefined {
  const trimmed = text.trim();
  if (trimmed === "") {
    return undefined;
  }
  try {
    const parsed = JSON.parse(trimmed);
    const isObject =
      typeof parsed === "object" && parsed !== null && !Array.isArray(parsed);
    return isObject ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

function encodeGraphql(
  slot: RequestBody["types"]["graphql"],
  subst: (input: string) => string,
): string {
  const query = subst(slot.query);
  const variables = parseGraphqlVariables(subst(slot.variables));
  return JSON.stringify(variables === undefined ? { query } : { query, variables });
}

// Resolve a request's body + canonical Content-Type from its active type. JSON
// text and form/multipart rows interpolate via `subst` (same {{var}} substitution
// as headers/params). `none` sends nothing and carries no content type.
export function encodeBody(
  body: RequestBody,
  subst: (input: string) => string,
): EncodedBody {
  const mode: BodyMode = body.active;
  if (mode === "none") {
    return { body: null, contentType: null };
  }
  if (mode === "form") {
    return {
      body: encodeForm(body.types.form, subst),
      contentType: CONTENT_TYPE.form,
    };
  }
  if (mode === "multipart") {
    return {
      body: encodeMultipart(body.types.multipart, subst),
      contentType: CONTENT_TYPE.multipart,
    };
  }
  if (mode === "graphql") {
    return {
      body: encodeGraphql(body.types.graphql, subst),
      contentType: CONTENT_TYPE.graphql,
    };
  }
  return { body: subst(body.types.json), contentType: CONTENT_TYPE.json };
}
