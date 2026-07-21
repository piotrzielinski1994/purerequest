import { describe, expect, it } from "vitest";

import { requestSettingsSchema } from "@/lib/config-schema/zod-schemas";

// The request-settings doc embeds the body schema as `body`, so parsing a full
// doc with a graphql body exercises the same `requestBodySchema` (its enum +
// graphql slot) via the exported public surface. TC-009 / AC-004.
const docWith = (body: unknown) => ({
  name: "GQL",
  method: "POST" as const,
  url: "https://x.test/graphql",
  body,
});

describe("requestSettingsSchema - graphql body (AC-004, TC-009)", () => {
  // TC-009, AC-004 - behavior: a graphql body doc (active "graphql" + a graphql
  // slot with query/variables) parses successfully.
  it("should parse a doc whose body is active graphql with a query/variables slot", () => {
    const result = requestSettingsSchema.safeParse(
      docWith({
        active: "graphql",
        types: { graphql: { query: "query { me }", variables: '{"id":1}' } },
      }),
    );

    expect(result.success).toBe(true);
  });

  // AC-004 - behavior: the graphql slot's fields are optional (both omissible) for
  // a minimal-diff doc; an empty graphql object still parses.
  it("should parse a graphql body whose slot omits query and variables", () => {
    const result = requestSettingsSchema.safeParse(
      docWith({ active: "graphql", types: { graphql: {} } }),
    );

    expect(result.success).toBe(true);
  });

  // TC-009, AC-004 - behavior: the schema stays `.strict()` - the same graphql slot
  // parses clean but rejects an unknown key inside it. The positive control (clean
  // parse) makes this RED until the graphql slot exists, so the reject half can't
  // pass tautologically (today the whole graphql body is an unknown shape).
  it("should accept a clean graphql slot but reject an unknown key inside it", () => {
    const clean = requestSettingsSchema.safeParse(
      docWith({ active: "graphql", types: { graphql: { query: "q" } } }),
    );
    const dirty = requestSettingsSchema.safeParse(
      docWith({
        active: "graphql",
        types: { graphql: { query: "q", bogus: true } },
      }),
    );

    expect(clean.success).toBe(true);
    expect(dirty.success).toBe(false);
  });

  // TC-009, AC-004 - behavior: `.strict()` still rejects an unknown key at the
  // body.types level, while a clean graphql body parses (positive control again).
  it("should accept a clean graphql body but reject an unknown key at the body.types level", () => {
    const clean = requestSettingsSchema.safeParse(
      docWith({ active: "graphql", types: { graphql: {} } }),
    );
    const dirty = requestSettingsSchema.safeParse(
      docWith({ active: "graphql", types: { graphql: {}, mystery: 1 } }),
    );

    expect(clean.success).toBe(true);
    expect(dirty.success).toBe(false);
  });
});
