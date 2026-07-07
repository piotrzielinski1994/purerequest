import { describe, it, expect } from "vitest";

import {
  configScopeJsonSchema,
  requestSettingsJsonSchema,
  themeColorsJsonSchema,
} from "@/lib/config-schema/json-schemas";

// Walk a generated JSON Schema and collect every `enum` array's members, so a
// test can assert a constrained value set appears SOMEWHERE in the tree without
// hard-coding the (zod-driven) nesting path.
function collectEnums(node: unknown): string[] {
  if (Array.isArray(node)) {
    return node.flatMap(collectEnums);
  }
  if (typeof node !== "object" || node === null) {
    return [];
  }
  const obj = node as Record<string, unknown>;
  const here = Array.isArray(obj.enum)
    ? (obj.enum as unknown[]).filter((v): v is string => typeof v === "string")
    : [];
  return [...here, ...Object.values(obj).flatMap(collectEnums)];
}

describe("generated config JSON schemas", () => {
  // AC-007 - side-effect-contract: generation never throws; the exports are defined.
  it("should export a defined JSON schema for every editor surface", () => {
    expect(configScopeJsonSchema).toBeDefined();
    expect(requestSettingsJsonSchema).toBeDefined();
    expect(themeColorsJsonSchema).toBeDefined();
  });

  // AC-004 - behavior: the config-scope schema is a closed object.
  it("should generate a closed object schema for ConfigScope with the expected top-level keys", () => {
    const schema = configScopeJsonSchema as Record<string, unknown>;

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    const props = Object.keys(schema.properties as object);
    expect(props).toEqual(
      expect.arrayContaining([
        "variables",
        "environments",
        "headers",
        "auth",
        "scripts",
        "timeoutMs",
      ]),
    );
  });

  // AC-002 - behavior: the auth.type enum members survive into the generated schema.
  it("should carry the auth.type enum members in the ConfigScope schema", () => {
    const enums = collectEnums(configScopeJsonSchema);

    expect(enums).toEqual(
      expect.arrayContaining(["inherit", "none", "bearer", "basic"]),
    );
  });

  // AC-004 - behavior: the request-settings schema is a closed object with the doc keys.
  it("should generate a closed object schema for request settings with the expected top-level keys", () => {
    const schema = requestSettingsJsonSchema as Record<string, unknown>;

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    const props = Object.keys(schema.properties as object);
    // Config fields are FLAT at the top level now (no `config` wrapper).
    expect(props).toEqual(
      expect.arrayContaining([
        "name",
        "method",
        "url",
        "body",
        "params",
        "headers",
        "auth",
        "scripts",
        "variables",
      ]),
    );
    expect(props).not.toContain("config");
  });

  // AC-002 - behavior: the HTTP method + bodyMode enums survive into the request schema.
  it("should carry the method and bodyMode enum members in the request-settings schema", () => {
    const enums = collectEnums(requestSettingsJsonSchema);

    expect(enums).toEqual(
      expect.arrayContaining(["GET", "POST", "PUT", "PATCH", "DELETE"]),
    );
    expect(enums).toEqual(
      expect.arrayContaining(["json", "none", "form", "multipart"]),
    );
  });

  // AC-004 - behavior: the theme-colors schema is a closed object with light/dark.
  it("should generate a closed object schema for ThemeColors with light and dark keys", () => {
    const schema = themeColorsJsonSchema as Record<string, unknown>;

    expect(schema.type).toBe("object");
    expect(schema.additionalProperties).toBe(false);
    const props = Object.keys(schema.properties as object);
    expect(props).toEqual(expect.arrayContaining(["light", "dark"]));
  });
});
