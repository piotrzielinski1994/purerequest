import { describe, it, expect } from "vitest";

import { resolveTokenPreview } from "@/components/workspace/url-token";
import { resolveConfig } from "@/lib/workspace/resolve";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "root",
    name: "Echo",
    config: {
      variables: [{ key: "suffix", value: "/v1" }],
      environments: [
        {
          name: "local",
          variables: [
            { key: "baseUrl", value: "http://localhost:3000" },
            { key: "api", value: "{{baseUrl}}{{suffix}}" },
          ],
        },
        {
          name: "prod",
          variables: [
            { key: "baseUrl", value: "https://api.example.com" },
            { key: "api", value: "{{baseUrl}}{{suffix}}" },
          ],
        },
      ],
    },
    children: [
      {
        kind: "request",
        id: "req",
        name: "Req",
        method: "GET",
        url: "{{baseUrl}}/get",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
];

describe("resolveTokenPreview", () => {
  // behavior: a plain variable resolves with its scope as the source
  it("should resolve a plain variable to its value and scope source", () => {
    const effective = resolveConfig(tree, "req");

    const preview = resolveTokenPreview("suffix", effective, {});

    expect(preview).toMatchObject({
      value: "/v1",
      source: "Echo",
      kind: "variable",
    });
  });

  // behavior: an env-sourced var resolves, source names the environment
  it("should resolve an env-sourced variable and name the environment as the source", () => {
    const effective = resolveConfig(tree, "req", { environment: "prod" });

    const preview = resolveTokenPreview("baseUrl", effective, {});

    expect(preview?.value).toBe("https://api.example.com");
    expect(preview?.source).toContain("prod");
  });

  // behavior: switching the active env changes the previewed value
  it("should preview a different value when the active environment changes", () => {
    const local = resolveTokenPreview(
      "baseUrl",
      resolveConfig(tree, "req", { environment: "local" }),
      {},
    );
    const prod = resolveTokenPreview(
      "baseUrl",
      resolveConfig(tree, "req", { environment: "prod" }),
      {},
    );

    expect(local?.value).toBe("http://localhost:3000");
    expect(prod?.value).toBe("https://api.example.com");
  });

  // behavior: a value referencing other vars is fully (recursively) resolved
  it("should recursively resolve a variable whose value references other variables", () => {
    const effective = resolveConfig(tree, "req", { environment: "prod" });

    const preview = resolveTokenPreview("api", effective, {});

    expect(preview?.value).toBe("https://api.example.com/v1");
  });

  // behavior: a {{process.env.KEY}} token resolves from processEnv with a .env source
  it("should resolve a process.env token from processEnv with a dotenv source", () => {
    const effective = resolveConfig(tree, "req");

    const preview = resolveTokenPreview("process.env.TOKEN", effective, {
      TOKEN: "abc123",
    });

    expect(preview).toMatchObject({
      value: "abc123",
      source: ".env",
      kind: "dotenv",
    });
  });

  // behavior: kind discriminates the source for coloring
  it("should tag a plain variable with kind 'variable'", () => {
    const preview = resolveTokenPreview(
      "suffix",
      resolveConfig(tree, "req"),
      {},
    );

    expect(preview?.kind).toBe("variable");
  });

  it("should tag an env-sourced variable with kind 'environment'", () => {
    const preview = resolveTokenPreview(
      "baseUrl",
      resolveConfig(tree, "req", { environment: "prod" }),
      {},
    );

    expect(preview?.kind).toBe("environment");
  });

  it("should tag a process.env token with kind 'dotenv'", () => {
    const preview = resolveTokenPreview(
      "process.env.TOKEN",
      resolveConfig(tree, "req"),
      { TOKEN: "abc123" },
    );

    expect(preview?.kind).toBe("dotenv");
  });

  // behavior: an unknown variable previews as null (unresolved)
  it("should return null for an unknown variable", () => {
    const effective = resolveConfig(tree, "req");

    expect(resolveTokenPreview("missing", effective, {})).toBeNull();
  });

  // behavior: an unknown process.env key previews as null
  it("should return null for a missing process.env key", () => {
    const effective = resolveConfig(tree, "req");

    expect(
      resolveTokenPreview("process.env.NOPE", effective, { OTHER: "x" }),
    ).toBeNull();
  });

  // behavior: a bare name is not read from processEnv (separate namespace)
  it("should not resolve a bare name from processEnv", () => {
    const effective = resolveConfig(tree, "req");

    expect(
      resolveTokenPreview("TOKEN", effective, { TOKEN: "abc" }),
    ).toBeNull();
  });
});

describe("resolveTokenPreview - rawValue + write target", () => {
  // behavior: a plain var exposes its raw stored value + a variable target with the scope id
  it("should expose the raw value and a variable target for a plain variable", () => {
    const preview = resolveTokenPreview(
      "suffix",
      resolveConfig(tree, "req"),
      {},
    );

    expect(preview?.rawValue).toBe("/v1");
    expect(preview?.target).toEqual({
      kind: "variable",
      scopeId: "root",
      name: "suffix",
    });
  });

  // behavior: the raw value of a var that references others is the UN-interpolated string
  it("should expose the un-interpolated raw value for a referencing variable", () => {
    const preview = resolveTokenPreview(
      "api",
      resolveConfig(tree, "req", { environment: "prod" }),
      {},
    );

    expect(preview?.value).toBe("https://api.example.com/v1");
    expect(preview?.rawValue).toBe("{{baseUrl}}{{suffix}}");
  });

  // behavior: an env-sourced var exposes an environment target naming the scope + env
  it("should expose an environment target for an env-sourced variable", () => {
    const preview = resolveTokenPreview(
      "baseUrl",
      resolveConfig(tree, "req", { environment: "prod" }),
      {},
      "prod",
    );

    expect(preview?.target).toEqual({
      kind: "environment",
      scopeId: "root",
      env: "prod",
      name: "baseUrl",
    });
  });

  // behavior: a process.env token exposes a dotenv target with its key
  it("should expose a dotenv target for a process.env token", () => {
    const preview = resolveTokenPreview(
      "process.env.TOKEN",
      resolveConfig(tree, "req"),
      { TOKEN: "abc123" },
    );

    expect(preview?.rawValue).toBe("abc123");
    expect(preview?.target).toEqual({ kind: "dotenv", key: "TOKEN" });
  });
});
