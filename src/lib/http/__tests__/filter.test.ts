import { describe, expect, it } from "vitest";

import { filterJson } from "@/lib/http/filter";

const BODY = JSON.stringify(
  {
    args: { foo: "bar" },
    headers: [{ key: "Content-Type", value: "application/json" }],
    nested: { a: { b: [10, 20, 30] } },
    count: 3,
    ok: true,
    nothing: null,
  },
  null,
  2,
);

describe("filterJson - empty / root path", () => {
  // AC-010, TC-007 — behavior
  it("should return the full body if the path is empty", () => {
    const result = filterJson(BODY, "");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(BODY);
    }
  });

  // AC-010 — behavior
  it("should return the full body if the path is only whitespace", () => {
    const result = filterJson(BODY, "   ");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(BODY);
    }
  });

  // AC-010 — behavior
  it("should return the full body if the path is the root $", () => {
    const result = filterJson(BODY, "$");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(BODY);
    }
  });
});

describe("filterJson - navigation", () => {
  // AC-009, TC-006 — behavior
  it("should extract a top-level key with $.key", () => {
    const result = filterJson(BODY, "$.args");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(JSON.stringify({ foo: "bar" }, null, 2));
    }
  });

  // AC-009, TC-006 — behavior
  it("should extract a nested key with $.a.b dot navigation", () => {
    const result = filterJson(BODY, "$.nested.a");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(JSON.stringify({ b: [10, 20, 30] }, null, 2));
    }
  });

  // AC-009 — behavior
  it("should extract an array element with $.arr[0] index navigation", () => {
    const result = filterJson(BODY, "$.headers[0]");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(
        JSON.stringify(
          { key: "Content-Type", value: "application/json" },
          null,
          2,
        ),
      );
    }
  });

  // AC-009 — behavior
  it("should navigate a nested mix of keys and indices", () => {
    const result = filterJson(BODY, "$.nested.a.b[2]");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("30");
    }
  });
});

describe("filterJson - scalar vs container formatting", () => {
  // AC-009 — behavior: a string scalar is shown raw (no surrounding quotes).
  it("should show a matched string scalar raw without JSON quotes", () => {
    const result = filterJson(BODY, "$.args.foo");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("bar");
    }
  });

  // AC-009 — behavior
  it("should stringify a matched number scalar", () => {
    const result = filterJson(BODY, "$.count");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("3");
    }
  });

  // AC-009 — behavior
  it("should stringify a matched boolean scalar", () => {
    const result = filterJson(BODY, "$.ok");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe("true");
    }
  });

  // AC-009 — behavior: objects/arrays are pretty-printed at 2 spaces.
  it("should pretty-print a matched array", () => {
    const result = filterJson(BODY, "$.nested.a.b");

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.text).toBe(JSON.stringify([10, 20, 30], null, 2));
    }
  });
});

describe("filterJson - no match (ADT failure)", () => {
  // AC-011, TC-007 — behavior
  it("should return not-ok if a key is missing", () => {
    const result = filterJson(BODY, "$.nope");

    expect(result.ok).toBe(false);
  });

  // AC-011, spec §6 — behavior
  it("should return not-ok if an array index is out of range", () => {
    const result = filterJson(BODY, "$.headers[5]");

    expect(result.ok).toBe(false);
  });

  // AC-011 — behavior
  it("should return not-ok if indexing into a non-array", () => {
    const result = filterJson(BODY, "$.args[0]");

    expect(result.ok).toBe(false);
  });

  // AC-011, TC-007 — behavior
  it("should return not-ok if the body is not valid JSON", () => {
    const result = filterJson("this is not json", "$.foo");

    expect(result.ok).toBe(false);
  });

  // AC-011, spec §6 — behavior
  it("should return not-ok if the body is empty", () => {
    const result = filterJson("", "$.foo");

    expect(result.ok).toBe(false);
  });
});
