import { describe, it, expect } from "vitest";

import { emptyBody } from "@/lib/workspace/model";
import type { BodyMode, RequestBody } from "@/lib/workspace/model";

// The graphql slot the model gains: emptyBody() seeds it blank, and it survives
// mode switches side-by-side with the other slots.
type GraphqlSlot = { query: string; variables: string };

const graphqlSlotOf = (body: RequestBody): GraphqlSlot =>
  (body.types as unknown as { graphql: GraphqlSlot }).graphql;

describe("emptyBody - graphql slot", () => {
  // AC-001 - behavior: emptyBody() seeds a blank graphql slot { query, variables }.
  it("should seed a blank graphql slot with empty query and variables", () => {
    expect(graphqlSlotOf(emptyBody())).toEqual({ query: "", variables: "" });
  });
});

describe("body mode switch preserves every slot (AC-001, TC-005)", () => {
  // TC-005, AC-001 - behavior: starting from emptyBody()'s seeded slots, set json
  // text, switch to graphql + type a query, switch to form, back to graphql ->
  // the graphql query and the json slot both survive, and the graphql slot keeps
  // its (blank) variables from the seed. Editing a slot mirrors the panel setters'
  // `{ ...body.types, [slot]: { ...body.types.graphql, query } }` spread, so this
  // reads emptyBody()'s graphql seed - it is RED until that seed exists (spreading
  // an undefined seed drops `variables`).
  it("should retain the json slot, graphql query and seeded blank variables across json->graphql->form->graphql", () => {
    const seed = emptyBody();
    const seedGraphql = graphqlSlotOf(seed);

    const withJson: RequestBody = {
      ...seed,
      active: "json",
      types: { ...seed.types, json: '{"a":1}' },
    };

    // switch to graphql + type a query, preserving the seeded graphql slot's
    // other fields (mirrors the panel's slot-merge edit).
    const withGraphql = {
      ...withJson,
      active: "graphql" as BodyMode,
      types: {
        ...withJson.types,
        graphql: { ...seedGraphql, query: "query { me { id } }" },
      },
    } as unknown as RequestBody;

    // switch to form, then back to graphql (active flip only).
    const toForm = { ...withGraphql, active: "form" as BodyMode };
    const backToGraphql = { ...toForm, active: "graphql" as BodyMode };

    expect(backToGraphql.active).toBe("graphql");
    expect(graphqlSlotOf(backToGraphql)).toEqual({
      query: "query { me { id } }",
      variables: "",
    });
    expect(backToGraphql.types.json).toBe('{"a":1}');
  });
});
