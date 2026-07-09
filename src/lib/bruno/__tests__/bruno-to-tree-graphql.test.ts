import { describe, it, expect } from "vitest";

import { brunoToTree, type BrunoFileMap } from "@/lib/bruno/bruno-to-tree";
import type { FolderNode, RequestBody, RequestNode, TreeNode } from "@/lib/workspace/model";

function asFolder(node: TreeNode | undefined): FolderNode {
  if (!node || node.kind !== "folder") {
    throw new Error("expected a folder node");
  }
  return node;
}

function firstRequest(nodes: TreeNode[]): RequestNode {
  const found = nodes.find((node) => node.kind === "request");
  if (!found || found.kind !== "request") {
    throw new Error("expected a request node");
  }
  return found;
}

const graphqlSlot = (
  body: RequestBody,
): { query: string; variables: string } =>
  (body.types as unknown as { graphql: { query: string; variables: string } })
    .graphql;

describe("brunoToTree - graphql import (AC-005)", () => {
  // AC-005, TC-007 - behavior: a .bru with `post { body: graphql }`, a body:graphql
  // block AND a body:graphql:vars sibling -> node active "graphql", query populated
  // from the block, variables populated (raw text) from the vars sibling.
  it("should import a body:graphql + body:graphql:vars into the graphql slot with query and variables", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "GQL API" }',
      "me.bru": [
        "meta {",
        "  name: Me",
        "}",
        "post {",
        "  url: https://x.test/graphql",
        "  body: graphql",
        "}",
        "body:graphql {",
        "  query { me { id } }",
        "}",
        "body:graphql:vars {",
        '  {',
        '    "x": 1',
        '  }',
        "}",
      ].join("\n"),
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);
    const request = firstRequest(root.children);

    expect(request.body.active).toBe("graphql");
    expect(graphqlSlot(request.body).query).toContain("query { me { id } }");
    expect(graphqlSlot(request.body).variables).toContain('"x": 1');
  });

  // AC-005, TC-008 - behavior: a body:graphql block with NO vars sibling -> query
  // populated, variables blank.
  it("should import a body:graphql with no vars sibling into query populated, variables blank", () => {
    const files: BrunoFileMap = {
      "bruno.json": '{ "name": "GQL API" }',
      "ping.bru": [
        "meta {",
        "  name: Ping",
        "}",
        "post {",
        "  url: https://x.test/graphql",
        "  body: graphql",
        "}",
        "body:graphql {",
        "  query { ping }",
        "}",
      ].join("\n"),
    };

    const root = asFolder(brunoToTree(files, "fallback")[0]);
    const request = firstRequest(root.children);

    expect(request.body.active).toBe("graphql");
    expect(graphqlSlot(request.body).query).toContain("query { ping }");
    expect(graphqlSlot(request.body).variables).toBe("");
  });
});
