import { describe, expect, it } from "vitest";

import { applyPathParams, extractPathParams } from "@/lib/http/path-params";

// `subst` stand-ins: `identity` leaves a value untouched (no {{var}} resolution),
// while `vars(map)` interpolates a single {{name}} token from a lookup so the
// {{var}}-before-substitution contract (AC-006/E-4) is exercised without pulling
// the real interpolate fn in (kept decoupled, mirrors build-request's hand-built
// inputs).
const identity = (value: string) => value;
const vars =
  (map: Record<string, string>) =>
  (value: string): string =>
    value.replace(
      /\{\{([^}]+)\}\}/g,
      (_match, name: string) => map[name.trim()] ?? `{{${name}}}`,
    );

describe("extractPathParams - detection", () => {
  // AC-003, TC-003 - behavior: each distinct :name in the path surfaces as a
  // param name (colon stripped).
  it("should return each :name token in the url path without the colon", () => {
    expect(
      extractPathParams("https://api.com/users/:id/posts/:postId"),
    ).toEqual(["id", "postId"]);
  });

  // AC-003, TC-003 - behavior: names come back in first-appearance order.
  it("should return param names in first-appearance order", () => {
    expect(extractPathParams("/:zeta/:alpha/:mid")).toEqual([
      "zeta",
      "alpha",
      "mid",
    ]);
  });

  // AC-006, E-2, TC-007 - behavior: a :name repeated in one url is a single row.
  it("should dedupe a :name that appears more than once into a single entry", () => {
    expect(extractPathParams("/:id/x/:id")).toEqual(["id"]);
  });

  // AC-010, TC-009 - behavior: a url with no :name yields no params (drives the
  // empty-state).
  it("should return an empty array if the url has no path params", () => {
    expect(extractPathParams("https://api.com/health")).toEqual([]);
  });

  // AC-003 - behavior: a leading underscore is a valid first char of a param name.
  it("should detect a param name that starts with an underscore", () => {
    expect(extractPathParams("/things/:_internal")).toEqual(["_internal"]);
  });
});

describe("extractPathParams - scheme/port guard (AC-009)", () => {
  // AC-009, E-1, TC-011 - behavior: the scheme separator's colon (https:) is not
  // a param.
  it("should not capture the scheme separator in https://", () => {
    expect(extractPathParams("https://api.com/p")).toEqual([]);
  });

  // AC-009, E-1, TC-011 - behavior: a :8080 port is not a param (digit after the
  // colon).
  it("should not capture a :8080 port as a path param", () => {
    expect(extractPathParams("https://host:8080/p/:id")).toEqual(["id"]);
  });

  // AC-009, E-1 - behavior: scheme + port are both skipped, only the real :name
  // survives.
  it("should detect only the real :name in a url carrying both a scheme and a port", () => {
    expect(extractPathParams("https://host:8080/users/:id")).toEqual(["id"]);
  });
});

describe("extractPathParams - no clash with {{var}} (AC-009)", () => {
  // AC-009, TC-012 - behavior: a {{var}} token is not a path param.
  it("should not treat a {{base}} token as a path param", () => {
    expect(extractPathParams("https://api.com/{{base}}/users")).toEqual([]);
  });

  // AC-009, TC-012 - behavior: a {{var}} and a :name coexist - only :name is a
  // path param.
  it("should detect only the :name when a {{var}} sits alongside it", () => {
    expect(extractPathParams("https://api.com/{{base}}/:id")).toEqual(["id"]);
  });
});

describe("applyPathParams - substitution (AC-006)", () => {
  // AC-006, TC-006 - behavior: a :name is replaced by its value.
  it("should replace a :name in the url with its value", () => {
    expect(
      applyPathParams("https://api.com/users/:id", { id: "42" }, identity),
    ).toBe("https://api.com/users/42");
  });

  // AC-006, E-2, TC-007 - behavior: every occurrence of a repeated :name takes the
  // one value.
  it("should replace every occurrence of a repeated :name with the same value", () => {
    expect(applyPathParams("/:id/x/:id", { id: "9" }, identity)).toBe("/9/x/9");
  });

  // AC-006 - behavior: multiple distinct params are each substituted.
  it("should substitute multiple distinct path params independently", () => {
    expect(
      applyPathParams(
        "/users/:id/posts/:postId",
        { id: "42", postId: "7" },
        identity,
      ),
    ).toBe("/users/42/posts/7");
  });

  // AC-009, E-1 - behavior: substitution leaves the scheme + port untouched (they
  // are not params).
  it("should leave the scheme and port intact while substituting the :name", () => {
    expect(
      applyPathParams("https://host:8080/users/:id", { id: "42" }, identity),
    ).toBe("https://host:8080/users/42");
  });
});

describe("applyPathParams - {{var}} interpolation in values (AC-006, E-4)", () => {
  // AC-006, E-4, TC-006 - behavior: a value carrying a {{var}} is interpolated via
  // `subst` before being substituted into the url.
  it("should interpolate a {{var}} in the value before substituting it", () => {
    expect(
      applyPathParams(
        "https://api.com/users/:id",
        { id: "{{uid}}" },
        vars({ uid: "7" }),
      ),
    ).toBe("https://api.com/users/7");
  });

  // AC-006 - behavior: a literal value is passed through `subst` (identity case)
  // unchanged.
  it("should substitute a plain (token-free) value unchanged through subst", () => {
    expect(
      applyPathParams(
        "https://api.com/users/:id",
        { id: "42" },
        vars({ uid: "7" }),
      ),
    ).toBe("https://api.com/users/42");
  });
});

describe("applyPathParams - empty value stays literal (AC-007, E-3)", () => {
  // AC-007, E-3, TC-008 - behavior: an empty value leaves the :name verbatim.
  it("should leave the :name literal if its value is an empty string", () => {
    expect(
      applyPathParams("https://api.com/users/:id", { id: "" }, identity),
    ).toBe("https://api.com/users/:id");
  });

  // AC-007, TC-008 - behavior: a :name with no row at all stays literal.
  it("should leave a :name literal if it has no entry in the values map", () => {
    expect(applyPathParams("https://api.com/users/:id", {}, identity)).toBe(
      "https://api.com/users/:id",
    );
  });

  // AC-007, E-3 - behavior: a value that interpolates to empty (unresolved {{var}}
  // -> empty) leaves the :name literal too.
  it("should leave the :name literal if the value interpolates to an empty string", () => {
    const toEmpty = () => "";
    expect(
      applyPathParams("https://api.com/users/:id", { id: "{{x}}" }, toEmpty),
    ).toBe("https://api.com/users/:id");
  });

  // AC-006, AC-007 - behavior: a filled param is substituted while an empty sibling
  // stays literal in the SAME url.
  it("should substitute a filled param but leave an empty sibling literal", () => {
    expect(
      applyPathParams(
        "/users/:id/posts/:postId",
        { id: "42", postId: "" },
        identity,
      ),
    ).toBe("/users/42/posts/:postId");
  });
});
