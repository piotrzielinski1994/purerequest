import { describe, expect, it } from "vitest";

import { bodyField, deserialize, serialize } from "@/lib/workspace/disk-format";
import type { RequestBody, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

const request = (
  overrides: Partial<RequestNode> & { name: string },
): RequestNode => ({
  kind: "request",
  id: `pending-${overrides.name}`,
  method: "POST",
  url: `https://example.test/${overrides.name}`,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
  ...overrides,
});

// A graphql body: the new slot alongside the existing side-by-side slots. Typed
// loosely because the model gains the slot as part of this feature.
const graphqlBody = (query: string, variables: string): RequestBody =>
  ({
    active: "graphql",
    types: { json: "", form: [], multipart: [], graphql: { query, variables } },
  }) as unknown as RequestBody;

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

const firstRequest = (tree: TreeNode[]): RequestNode => {
  const node = tree[0];
  if (node.kind !== "request") {
    throw new Error("expected a request node at the root");
  }
  return node;
};

const reqFileJson = (tree: TreeNode[]): Record<string, unknown> => {
  const map = serialize(tree);
  const entry = Object.entries(map).find(([path]) =>
    path.endsWith(".req.json"),
  );
  if (!entry) {
    throw new Error("expected a .req.json file in the serialized map");
  }
  return JSON.parse(entry[1]) as Record<string, unknown>;
};

const graphqlSlot = (body: RequestBody): { query: string; variables: string } =>
  (body.types as unknown as { graphql: { query: string; variables: string } })
    .graphql;

describe("disk-format graphql round-trip (AC-004, TC-006)", () => {
  // TC-006, AC-004 - behavior: a graphql request round-trips its active mode +
  // the graphql slot (query + variables) through serialize/deserialize.
  it("should round-trip the active mode and the graphql slot for a graphql request", () => {
    const tree: TreeNode[] = [
      request({
        name: "GQL",
        body: graphqlBody("query { me { id } }", '{"id":"1"}'),
      }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree);

    expect(loaded.body.active).toBe("graphql");
    expect(graphqlSlot(loaded.body)).toEqual({
      query: "query { me { id } }",
      variables: '{"id":"1"}',
    });
  });

  // AC-004 - behavior: bodyField writes the graphql slot on disk for a graphql body.
  it("should write body.types.graphql when bodyField serializes a graphql body", () => {
    const parsed = reqFileJson([
      request({
        name: "GQL2",
        body: graphqlBody("query { me { id } }", '{"id":"1"}'),
      }),
    ]) as { body: { active: string; types: Record<string, unknown> } };

    expect(parsed.body.active).toBe("graphql");
    expect(parsed.body.types.graphql).toEqual({
      query: "query { me { id } }",
      variables: '{"id":"1"}',
    });
  });

  // TC-006, AC-004 - side-effect-contract: a blank graphql body (both fields
  // empty) is fully default -> bodyField omits `body` entirely (minimal-diff).
  it("should omit body if the graphql slot is blank (default)", () => {
    const parsed = reqFileJson([
      request({ name: "GQLBlank", body: graphqlBody("", "") }),
    ]) as Record<string, unknown>;

    expect("body" in parsed).toBe(false);
  });

  // AC-004 - behavior: bodyField() called directly on a blank graphql body returns
  // an empty object (no `body` key), matching the minimal-diff invariant.
  it("should return no body field for a blank graphql body via bodyField", () => {
    expect(bodyField(graphqlBody("", ""))).toEqual({});
  });

  // TC-006, AC-004 - behavior: a graphql body with only a query (blank variables)
  // round-trips to query populated + variables blank (the on-disk representation
  // of the blank variables field - omitted or "" - is an implementation detail).
  it("should round-trip a query-only graphql body to a populated query and blank variables", () => {
    const tree: TreeNode[] = [
      request({ name: "GQLQ", body: graphqlBody("query { me }", "") }),
    ];

    const result = expectOk(deserialize(serialize(tree)));
    const loaded = firstRequest(result.tree);

    expect(loaded.body.active).toBe("graphql");
    expect(graphqlSlot(loaded.body)).toEqual({
      query: "query { me }",
      variables: "",
    });
  });
});
