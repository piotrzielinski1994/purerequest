import { describe, expect, it } from "vitest";

import { encodeBody } from "@/lib/http/body-encode";
import { buildHttpRequest } from "@/lib/http/build-request";
import type {
  Auth,
  HttpMethod,
  RequestBody,
  RequestNode,
} from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

// A graphql RequestBody: the new `graphql` slot holds a { query, variables } pair
// alongside the existing side-by-side slots. Typed loosely (`as` the model type)
// because the model gains the slot as part of this feature.
const graphqlBody = (query: string, variables: string): RequestBody =>
  ({
    active: "graphql",
    types: { json: "", form: [], multipart: [], graphql: { query, variables } },
  }) as unknown as RequestBody;

// Identity substitution: most cases don't interpolate, so subst passes text through.
const identity = (input: string) => input;

// Parse the encoded body without throwing on the RED (unimplemented) case: an
// empty string becomes JSON `null`, so a missing graphql branch fails as a clean
// assertion mismatch rather than a thrown SyntaxError.
const parseBody = (body: string | null): unknown => JSON.parse(body || "null");

describe("encodeBody - graphql mode", () => {
  // TC-001, AC-003 - behavior: query + object variables -> application/json with
  // the canonical { query, variables } JSON body.
  it("should encode query and object variables as {query,variables} JSON if active is graphql", () => {
    const encoded = encodeBody(
      graphqlBody("query { me { id } }", '{"id":"1"}'),
      identity,
    );

    expect(encoded.contentType).toBe("application/json");
    expect(parseBody(encoded.body)).toEqual({
      query: "query { me { id } }",
      variables: { id: "1" },
    });
  });

  // TC-002, AC-003 - behavior: blank variables -> the `variables` key is omitted,
  // the query is still sent.
  it("should omit the variables key if the variables text is blank", () => {
    const encoded = encodeBody(
      graphqlBody("query { me { id } }", ""),
      identity,
    );

    expect(parseBody(encoded.body)).toEqual({ query: "query { me { id } }" });
  });

  // TC-003, AC-003 - behavior: array variables (`[1,2]`) parse to JSON but not an
  // object -> `variables` omitted, query still sent. Asserted as the whole object
  // so a missing branch fails as a clean mismatch (not a null-crash).
  it("should omit variables if the variables parse to a JSON array, not an object", () => {
    const encoded = encodeBody(
      graphqlBody("query { me { id } }", "[1,2]"),
      identity,
    );

    expect(parseBody(encoded.body)).toEqual({ query: "query { me { id } }" });
  });

  // TC-003, AC-003 - behavior: unparseable variables (`not json`) -> `variables`
  // omitted, query still sent.
  it("should omit variables if the variables text is not valid JSON", () => {
    const encoded = encodeBody(
      graphqlBody("query { me { id } }", "not json"),
      identity,
    );

    expect(parseBody(encoded.body)).toEqual({ query: "query { me { id } }" });
  });

  // TC-003, AC-003 - behavior: a scalar (`5`) parses to JSON but is not an object
  // -> `variables` omitted.
  it("should omit variables if the variables text is a JSON scalar", () => {
    const encoded = encodeBody(
      graphqlBody("query { me { id } }", "5"),
      identity,
    );

    expect(parseBody(encoded.body)).toEqual({ query: "query { me { id } }" });
  });

  // TC-004, AC-003 - behavior: {{tokens}} in BOTH query and variables interpolate
  // via `subst` before the JSON is built (variables parsed after substitution).
  it("should interpolate {{tokens}} in both the query and the variables before encoding", () => {
    const subst = (input: string) =>
      input
        .replace(/\{\{id\}\}/g, "42")
        .replace(/\{\{host\}\}/g, "example.com");

    const encoded = encodeBody(
      graphqlBody('query { user(id: "{{id}}") }', '{"h":"{{host}}"}'),
      subst,
    );

    expect(parseBody(encoded.body)).toEqual({
      query: 'query { user(id: "42") }',
      variables: { h: "example.com" },
    });
  });

  // Empty state (UI states table) - behavior: a fully blank graphql body still
  // POSTs `{"query":""}` with the json content type (not a null body).
  it('should encode a blank graphql body as {"query":""} with application/json', () => {
    const encoded = encodeBody(graphqlBody("", ""), identity);

    expect(encoded.contentType).toBe("application/json");
    expect(parseBody(encoded.body)).toEqual({ query: "" });
  });
});

// Mirrors build-request-body-modes.test.ts: a hand-built EffectiveConfig pins the
// resolved inputs buildHttpRequest consumes, so the graphql branch is exercised
// end-to-end (auto Content-Type, user override, bodyless-method guard).
const effectiveOf = (over: {
  headers?: Record<string, string>;
  auth?: Auth;
}): EffectiveConfig => {
  const from = { scopeId: "test", scopeName: "test" };
  const wrapKeyed = (entries?: Record<string, string>) =>
    Object.fromEntries(
      Object.entries(entries ?? {}).map(([k, v]) => [k, { value: v, from }]),
    );
  return {
    variables: wrapKeyed(),
    headers: wrapKeyed(over.headers),
    auth: { value: over.auth ?? authOf({ active: "none" }), from },
    scripts: { pre: { value: "", from }, post: { value: "", from } },
    timeoutMs: { value: 30000, from },
  };
};

const graphqlRequest = (method: HttpMethod): RequestNode => ({
  kind: "request",
  id: "r",
  name: "r",
  method,
  url: "https://example.test/graphql",
  params: { path: [], query: [] },
  config: {},
  body: graphqlBody("query { me { id } }", '{"id":"1"}'),
});

const contentTypeHeaders = (headers: { key: string; value: string }[]) =>
  headers.filter((h) => h.key.toLowerCase() === "content-type");

describe("buildHttpRequest - graphql mode", () => {
  // AC-003 - behavior: a graphql POST auto-adds Content-Type application/json and
  // sends the built {query,variables} JSON on the wire.
  it("should auto-add Content-Type application/json and send the graphql JSON on a POST", () => {
    const wire = buildHttpRequest(graphqlRequest("POST"), effectiveOf({}));

    const cts = contentTypeHeaders(wire.headers);
    expect(cts).toHaveLength(1);
    expect(cts[0].value).toBe("application/json");
    expect(JSON.parse(wire.body || "null")).toEqual({
      query: "query { me { id } }",
      variables: { id: "1" },
    });
  });

  // AC-003 - behavior: an explicit user Content-Type wins over the auto one in
  // graphql mode (auto-set rule unchanged) while the graphql JSON body is still
  // built. The body assertion keeps this RED today (graphql falls through to the
  // empty json branch until the feature lands), so it can't pass tautologically.
  it("should keep only the user Content-Type but still send the graphql JSON body", () => {
    const wire = buildHttpRequest(
      graphqlRequest("POST"),
      effectiveOf({
        headers: { "content-type": "application/graphql-response+json" },
      }),
    );

    const cts = contentTypeHeaders(wire.headers);
    expect(cts).toHaveLength(1);
    expect(cts[0].value).toBe("application/graphql-response+json");
    expect(JSON.parse(wire.body || "null")).toEqual({
      query: "query { me { id } }",
      variables: { id: "1" },
    });
  });
});
