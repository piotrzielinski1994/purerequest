import { describe, expect, it } from "vitest";

import {
  pureRefInner,
  resolvePathTokenPreview,
  resolveTokenPreview,
  resolveWriteTarget,
} from "@/components/workspace/url-token";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { resolveConfig } from "@/lib/workspace/resolve";

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

// A root folder holding `variables`/`environments` and a single request `req`, so
// `resolveConfig(mkTree(...), "req")` folds the same chain the popup resolves.
type Config = TreeNode["config"];
function mkTree(config: Config): TreeNode[] {
  return [
    {
      kind: "folder",
      id: "root",
      name: "Root",
      config,
      children: [
        {
          kind: "request",
          id: "req",
          name: "Req",
          method: "GET",
          url: "{{a}}",
          body: emptyBody(),
          params: emptyParams(),
          config: {},
        },
      ],
    },
  ];
}

describe("pureRefInner (AC-001)", () => {
  // TC-001, behavior: a single pure `{{token}}` yields its trimmed inner name.
  it("should return the trimmed inner token name if the value is a single pure reference", () => {
    expect(pureRefInner("{{ x }}")).toBe("x");
    expect(pureRefInner("{{process.env.K}}")).toBe("process.env.K");
  });

  // TC-001, behavior: anything that is not a single pure reference is null.
  it("should return null for a literal, empty, wrapped, multi-token, or text-around value", () => {
    expect(pureRefInner("lit")).toBeNull();
    expect(pureRefInner("")).toBeNull();
    expect(pureRefInner("{{a}}/v1")).toBeNull();
    expect(pureRefInner("{{a}}{{b}}")).toBeNull();
    expect(pureRefInner("x {{a}}")).toBeNull();
  });
});

describe("resolveWriteTarget (AC-002..006)", () => {
  // TC-002, behavior: a literal nearest row is its own write target - identical to
  // the preview's current `target`, so the literal case is unchanged.
  it("should return the row's own variable target if the nearest row is a real literal", () => {
    const effective = resolveConfig(tree, "req");

    expect(resolveWriteTarget("suffix", effective)).toEqual({
      kind: "variable",
      scopeId: "root",
      name: "suffix",
    });
    expect(resolveWriteTarget("suffix", effective)).toEqual(
      resolveTokenPreview("suffix", effective, {})?.target,
    );
  });

  // TC-003, behavior: a pure `{{process.env.KEY}}` pointer drills to the .env key.
  it("should return a dotenv target if the nearest row is a pure process.env pointer", () => {
    const effective = resolveConfig(
      mkTree({
        variables: [
          { key: "CUSTOMER_ID", value: "{{process.env.CUSTOMER_ID}}" },
        ],
      }),
      "req",
    );

    expect(resolveWriteTarget("CUSTOMER_ID", effective)).toEqual({
      kind: "dotenv",
      key: "CUSTOMER_ID",
    });
  });

  // TC-004, behavior: a var->var->process.env chain drills through every hop.
  it("should follow multiple hops to a process.env terminal", () => {
    const effective = resolveConfig(
      mkTree({
        variables: [
          { key: "a", value: "{{b}}" },
          { key: "b", value: "{{process.env.K}}" },
        ],
      }),
      "req",
    );

    expect(resolveWriteTarget("a", effective)).toEqual({
      kind: "dotenv",
      key: "K",
    });
  });

  // TC-004, behavior: a var->var chain ending at a literal targets the literal row.
  it("should follow a hop to the literal row it points at", () => {
    const effective = resolveConfig(
      mkTree({
        variables: [
          { key: "a", value: "{{b}}" },
          { key: "b", value: "lit" },
        ],
      }),
      "req",
    );

    expect(resolveWriteTarget("a", effective)).toEqual({
      kind: "variable",
      scopeId: "root",
      name: "b",
    });
  });

  // TC-005, behavior: a pointer resolved through the active environment block
  // yields an environment target for the terminal literal row.
  it("should return an environment target if the pointer resolves via an env block", () => {
    const effective = resolveConfig(
      mkTree({
        variables: [{ key: "a", value: "{{host}}" }],
        environments: [
          {
            name: "prod",
            variables: [{ key: "host", value: "https://prod.example.com" }],
          },
        ],
      }),
      "req",
      { environment: "prod" },
    );

    expect(resolveWriteTarget("a", effective, "prod")).toEqual({
      kind: "environment",
      scopeId: "root",
      env: "prod",
      name: "host",
    });
  });

  // TC-006, behavior: a pointer to an undefined var falls back to the hovered
  // var's own row (never throws / hangs).
  it("should fall back to the hovered row if the pointer targets an undefined var", () => {
    const effective = resolveConfig(
      mkTree({ variables: [{ key: "a", value: "{{missing}}" }] }),
      "req",
    );

    expect(resolveWriteTarget("a", effective)).toEqual({
      kind: "variable",
      scopeId: "root",
      name: "a",
    });
  });

  // behavior: a non-pure multi-token value is a literal terminal - no drill,
  // the row is written in place (its interpolated result lands there).
  it("should treat a non-pure multi-token value as its own terminal row", () => {
    const effective = resolveConfig(tree, "req", { environment: "prod" });

    // `api = {{baseUrl}}{{suffix}}` (two tokens) is defined in the prod env block.
    expect(resolveWriteTarget("api", effective, "prod")).toEqual({
      kind: "environment",
      scopeId: "root",
      env: "prod",
      name: "api",
    });
  });

  // TC-006, behavior: a reference cycle falls back to the hovered row (no hang).
  it("should fall back to the hovered row if the reference chain is a cycle", () => {
    const effective = resolveConfig(
      mkTree({
        variables: [
          { key: "a", value: "{{b}}" },
          { key: "b", value: "{{a}}" },
        ],
      }),
      "req",
    );

    expect(resolveWriteTarget("a", effective)).toEqual({
      kind: "variable",
      scopeId: "root",
      name: "a",
    });
  });
});

describe("resolveTokenPreview - writeTarget field (AC-007)", () => {
  // TC-007, behavior: a directly-hovered process.env token has writeTarget ==
  // target (no indirection to follow).
  it("should set writeTarget equal to target for a directly-hovered process.env token", () => {
    const preview = resolveTokenPreview(
      "process.env.TOKEN",
      resolveConfig(tree, "req"),
      { TOKEN: "abc123" },
    );

    expect(preview?.writeTarget).toEqual({ kind: "dotenv", key: "TOKEN" });
    expect(preview?.writeTarget).toEqual(preview?.target);
  });

  // TC-007, behavior: a path-param token has writeTarget === target (same target).
  it("should set writeTarget to the same target for a path-param token", () => {
    const preview = resolvePathTokenPreview(
      "id",
      "req",
      { id: "42" },
      resolveConfig(tree, "req"),
      {},
    );

    expect(preview?.writeTarget).toBe(preview?.target);
  });
});
