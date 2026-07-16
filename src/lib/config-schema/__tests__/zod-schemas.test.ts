import { describe, it, expect, expectTypeOf } from "vitest";

import {
  configScopeSchema,
  requestSettingsSchema,
  themeColorsSchema,
} from "@/lib/config-schema/zod-schemas";
import type { ConfigScope, HttpMethod, BodyMode } from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";
import type { ThemeColors } from "@/lib/settings/settings";
import type { z } from "zod";

type KeyValueRow = { key: string; value: string; enabled?: boolean };

// The request-settings JSON document shape (spec §1 / config-editor.tsx
// RequestSettingsForm): the whole node minus runtime-only fields, with the body
// as an `{active,types}` object (json slot is any JSON value - nested JSON or a
// raw string), params as a `{path,query}` object, and the ConfigScope fields FLAT
// at the top level (no `config` wrapper). Every optional slot is omissible for a
// minimal-diff doc. The zod schema's inferred type must match so the IntelliSense
// schema can't drift from the editor.
type RequestSettingsDoc = {
  name: string;
  method: HttpMethod;
  url: string;
  body?: {
    active: BodyMode;
    types: {
      json?: unknown;
      form?: KeyValueRow[];
      multipart?: KeyValueRow[];
      graphql?: { query?: string; variables?: string };
    };
  };
  params?: {
    path?: KeyValueRow[];
    query?: KeyValueRow[];
  };
  variables?: KeyValueRow[];
  environments?: { name: string; variables: KeyValueRow[] }[];
  headers?: KeyValueRow[];
  auth?: ConfigScope["auth"];
  scripts?: { pre?: string; post?: string };
  timeoutMs?: number;
};

describe("zod config schemas drift guard", () => {
  // AC-007 - side-effect-contract: the ConfigScope zod infer matches the hand-written TS model.
  it("should infer a type matching ConfigScope for configScopeSchema", () => {
    expectTypeOf<z.infer<typeof configScopeSchema>>().toEqualTypeOf<ConfigScope>();
  });

  // AC-007 - side-effect-contract: the ThemeColors zod infer matches the settings TS model.
  it("should infer a type matching ThemeColors for themeColorsSchema", () => {
    expectTypeOf<z.infer<typeof themeColorsSchema>>().toEqualTypeOf<ThemeColors>();
  });

  // AC-007 - side-effect-contract: the request-settings zod infer matches the document shape.
  it("should infer a type matching the request-settings document for requestSettingsSchema", () => {
    expectTypeOf<
      z.infer<typeof requestSettingsSchema>
    >().toEqualTypeOf<RequestSettingsDoc>();
  });
});

describe("configScopeSchema runtime behavior", () => {
  // AC-007 - behavior: a valid ConfigScope passes safeParse.
  it("should accept a valid ConfigScope", () => {
    const value: ConfigScope = {
      variables: [{ key: "token", value: "tok-123" }],
      headers: [{ key: "Accept", value: "application/json" }],
      auth: authOf({ active: "bearer", token: "secret" }),
      scripts: { pre: "// pre", post: "" },
      timeoutMs: 5000,
    };

    expect(configScopeSchema.safeParse(value).success).toBe(true);
  });

  // AC-004 - behavior: a closed (.strict) schema rejects an unknown key.
  it("should reject an unknown key", () => {
    const result = configScopeSchema.safeParse({ aut2h: {} });

    expect(result.success).toBe(false);
  });

  // AC-003 - behavior: a wrong-typed field fails safeParse.
  it("should reject a wrong-typed field", () => {
    const result = configScopeSchema.safeParse({ timeoutMs: "soon" });

    expect(result.success).toBe(false);
  });
});

describe("requestSettingsSchema method enum (AC-004)", () => {
  const doc = (method: string) => ({
    name: "Req",
    method,
    url: "https://x.test",
  });

  // TC-004, AC-004 - behavior: QUERY is a valid method (added to the enum).
  it("should accept method QUERY", () => {
    const result = requestSettingsSchema.safeParse(doc("QUERY"));

    expect(result.success).toBe(true);
  });

  // TC-005, AC-004 - behavior: an unknown method (FETCH) is still rejected.
  it("should reject an unknown method FETCH", () => {
    const result = requestSettingsSchema.safeParse(doc("FETCH"));

    expect(result.success).toBe(false);
  });
});
