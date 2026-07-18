import { describe, it, expect } from "vitest";

import { serialize, deserialize } from "@/lib/workspace/disk-format";
import type { FileMap } from "@/lib/workspace/disk-format";
import { emptyBody, emptyParams, requestHttpVersion } from "@/lib/workspace/model";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (
  name: string,
  overrides: Partial<RequestNode> & { httpVersion?: "auto" | "h3" } = {},
): RequestNode =>
  ({
    kind: "request",
    id: `pending-${name}`,
    name,
    method: "GET",
    url: `https://example.test/${name}`,
    body: emptyBody(),
    params: emptyParams(),
    config: {},
    ...overrides,
  }) as RequestNode;

const expectOk = (result: ReturnType<typeof deserialize>) => {
  if (!result.ok) {
    throw new Error(`expected ok result, got error: ${result.error}`);
  }
  return result;
};

const reqFileOf = (map: FileMap): string => {
  const entry = Object.entries(map).find(([path]) =>
    path.endsWith(".req.json"),
  );
  expect(entry).toBeDefined();
  return entry![1];
};

describe("disk-format httpVersion", () => {
  // TC-007, AC-003 - side-effect-contract: an h3 request persists
  // `"httpVersion": "h3"` on its *.req.json.
  it("should write httpVersion h3 on the req.json if the request version is h3", () => {
    const tree: TreeNode[] = [request("h3req", { httpVersion: "h3" })];

    const map = serialize(tree);

    expect(reqFileOf(map)).toContain('"httpVersion": "h3"');
  });

  // TC-007, AC-003 - side-effect-contract: the manifest schemaVersion bumps 5 -> 6.
  it("should stamp the workspace manifest with schemaVersion 6", () => {
    const map = serialize([]);

    const manifest = JSON.parse(map["purerequest.workspace.json"]) as {
      schemaVersion: number;
    };
    expect(manifest.schemaVersion).toBe(6);
  });

  // TC-008, AC-003 - side-effect-contract: an auto request omits httpVersion on
  // disk entirely (minimal diff).
  it("should omit httpVersion from the req.json if the request version is auto", () => {
    const tree: TreeNode[] = [request("autoreq", { httpVersion: "auto" })];

    const map = serialize(tree);

    expect(reqFileOf(map)).not.toContain("httpVersion");
  });

  // TC-008, AC-003 - side-effect-contract: an absent httpVersion also writes
  // nothing (absent means auto).
  it("should omit httpVersion from the req.json if the request has no version set", () => {
    const tree: TreeNode[] = [request("plainreq")];

    const map = serialize(tree);

    expect(reqFileOf(map)).not.toContain("httpVersion");
  });

  // TC-009, AC-003 - behavior: a req.json carrying "httpVersion":"h3" round-trips
  // to a node whose requestHttpVersion is "h3".
  it("should deserialize httpVersion h3 back to a request whose version is h3", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({ schemaVersion: 6, name: "W" }),
      "h3.req.json": JSON.stringify({
        name: "H3",
        method: "GET",
        url: "https://api/h3",
        httpVersion: "h3",
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));
    const node = result.tree[0] as RequestNode;

    expect(requestHttpVersion(node)).toBe("h3");
  });

  // TC-009, AC-003 - behavior: a v5 (or earlier) doc with no httpVersion loads as
  // auto.
  it("should deserialize a doc with no httpVersion to a request whose version is auto", () => {
    const files: FileMap = {
      "purerequest.workspace.json": JSON.stringify({ schemaVersion: 5, name: "W" }),
      "legacy.req.json": JSON.stringify({
        name: "Legacy",
        method: "GET",
        url: "https://api/legacy",
        order: 0,
      }),
    };

    const result = expectOk(deserialize(files));
    const node = result.tree[0] as RequestNode;

    expect(requestHttpVersion(node)).toBe("auto");
  });
});
