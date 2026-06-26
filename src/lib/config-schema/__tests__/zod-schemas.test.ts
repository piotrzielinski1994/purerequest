import { describe, it, expect, expectTypeOf } from "vitest";

import {
  configScopeSchema,
  requestSettingsSchema,
  themeColorsSchema,
} from "@/lib/config-schema/zod-schemas";
import type { ConfigScope, HttpMethod, BodyMode } from "@/lib/workspace/model";
import type { StoredBody } from "@/lib/workspace/body-codec";
import type { ThemeColors } from "@/lib/settings/settings";
import type { z } from "zod";

// The request-settings JSON document shape (spec §1 / config-editor.tsx
// RequestSettingsForm): the whole node minus runtime-only fields, with the body
// serialized as a tagged StoredBody. The zod schema's inferred type must match
// this shape so the generated IntelliSense schema can't drift from the editor.
type RequestSettingsDoc = {
  name: string;
  method: HttpMethod;
  url: string;
  body: StoredBody;
  bodyMode?: BodyMode;
  bodyForm?: { key: string; value: string; enabled?: boolean }[];
  config: ConfigScope;
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
      variables: { token: "tok-123" },
      headers: [{ key: "Accept", value: "application/json" }],
      params: [{ key: "page", value: "1" }],
      auth: { type: "bearer", token: "secret" },
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
