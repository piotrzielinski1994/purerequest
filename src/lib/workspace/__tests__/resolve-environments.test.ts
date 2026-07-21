import { describe, expect, it } from "vitest";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { resolveConfig } from "@/lib/workspace/resolve";

const request = (
  id: string,
  name: string,
  config: RequestNode["config"],
): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: "",
  body: emptyBody(),
  params: emptyParams(),
  config,
});

const folder = (
  id: string,
  name: string,
  config: FolderNode["config"],
  children: TreeNode[],
): FolderNode => ({ kind: "folder", id, name, config, children });

describe("resolveConfig environments - active env layer", () => {
  // AC-007, TC-001 - behavior: with an active env, an env-only var resolves
  it("should resolve a bare {{name}} from the active environment block", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          {
            name: "local",
            variables: [{ key: "baseUrl", value: "http://localhost:3000" }],
          },
          {
            name: "prod",
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "prod" });

    expect(effective.variables.baseUrl.value).toBe("https://api.example.com");
  });

  // AC-007, TC-001 - behavior: switching the active env changes the resolved value
  it("should change which value a bare {{name}} resolves to when the env switches", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          {
            name: "local",
            variables: [{ key: "baseUrl", value: "http://localhost:3000" }],
          },
          {
            name: "prod",
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
        ],
      },
      [req],
    );

    const local = resolveConfig([root], "req", { environment: "local" });
    const prod = resolveConfig([root], "req", { environment: "prod" });

    expect(local.variables.baseUrl.value).toBe("http://localhost:3000");
    expect(prod.variables.baseUrl.value).toBe("https://api.example.com");
  });
});

describe("resolveConfig environments - no active env", () => {
  // AC-007 - behavior: no options -> env layer contributes nothing
  it("should not resolve an env-only var if no environment option is passed", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          {
            name: "prod",
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req");

    expect(effective.variables.baseUrl).toBeUndefined();
  });

  // AC-007 - behavior: explicitly no environment -> env layer empty
  it("should not resolve an env-only var if the environment option is undefined", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          {
            name: "prod",
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: undefined });

    expect(effective.variables.baseUrl).toBeUndefined();
  });

  // AC-007, edge case §6 - behavior: an unknown env name contributes nothing
  it("should contribute nothing if the active env name is not present in the scope", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          {
            name: "prod",
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "ghost" });

    expect(effective.variables.baseUrl).toBeUndefined();
  });

  // AC-007 - behavior: plain vars still resolve regardless of env layer being empty
  it("should still resolve plain variables when no environment is active", () => {
    const req = request("req", "Req", {
      variables: [{ key: "token", value: "plain" }],
    });
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          { name: "prod", variables: [{ key: "baseUrl", value: "x" }] },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req");

    expect(effective.variables.token.value).toBe("plain");
  });
});

describe("resolveConfig environments - precedence", () => {
  // AC-006, TC-004 - behavior: a plain var in a scope beats that scope's env block
  it("should let a plain variable win over the same-scope active-environment block", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        variables: [{ key: "host", value: "folder-host" }],
        environments: [
          { name: "local", variables: [{ key: "host", value: "env-host" }] },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "local" });

    expect(effective.variables.host.value).toBe("folder-host");
  });

  // AC-006, TC-004 - behavior: removing the plain var lets the env block show through
  it("should fall back to the env block value if the scope has no plain var for the name", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          { name: "local", variables: [{ key: "host", value: "env-host" }] },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "local" });

    expect(effective.variables.host.value).toBe("env-host");
  });

  // AC-006, TC-004 - behavior: a nearer scope's plain var beats a farther scope's env block
  it("should let a nearer scope plain var override a farther scope env block", () => {
    const req = request("req", "Req", {
      variables: [{ key: "host", value: "request-host" }],
    });
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          { name: "local", variables: [{ key: "host", value: "env-host" }] },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "local" });

    expect(effective.variables.host.value).toBe("request-host");
  });

  // AC-006 - behavior: a nearer scope's env block beats a farther scope's env block
  it("should let a nearer scope env block override a farther scope env block", () => {
    const req = request("req", "Req", {});
    const sub = folder(
      "sub",
      "Sub",
      {
        environments: [
          { name: "local", variables: [{ key: "host", value: "sub-env" }] },
        ],
      },
      [req],
    );
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          { name: "local", variables: [{ key: "host", value: "root-env" }] },
        ],
      },
      [sub],
    );

    const effective = resolveConfig([root], "req", { environment: "local" });

    expect(effective.variables.host.value).toBe("sub-env");
  });
});

describe("resolveConfig environments - provenance", () => {
  // AC-008, TC-006 - behavior: env-sourced provenance names the environment
  it("should mark an env-sourced variable's provenance with the env name", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          {
            name: "prod",
            variables: [{ key: "baseUrl", value: "https://api.example.com" }],
          },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "prod" });

    expect(effective.variables.baseUrl.from.scopeName).toContain("prod");
  });

  // AC-008 - behavior: env provenance matches the env name loosely (format not pinned)
  it("should expose the env name in the provenance scopeName for an env var", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        environments: [
          { name: "staging", variables: [{ key: "apiKey", value: "k1" }] },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "staging" });

    expect(effective.variables.apiKey.from.scopeName).toMatch(/staging/);
  });

  // AC-008 - behavior: a plain var keeps the plain scope-name provenance
  it("should keep the plain scope name as provenance for a plain variable", () => {
    const req = request("req", "Req", {});
    const root = folder(
      "root",
      "Root",
      {
        variables: [{ key: "host", value: "folder-host" }],
        environments: [
          { name: "prod", variables: [{ key: "host", value: "env-host" }] },
        ],
      },
      [req],
    );

    const effective = resolveConfig([root], "req", { environment: "prod" });

    expect(effective.variables.host.value).toBe("folder-host");
    expect(effective.variables.host.from.scopeName).toBe("Root");
  });
});
