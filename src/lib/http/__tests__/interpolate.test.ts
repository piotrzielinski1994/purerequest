import { describe, expect, it } from "vitest";

import { interpolate } from "@/lib/http/interpolate";

describe("interpolate - variables", () => {
  // AC-009 - behavior
  it("should replace a {{name}} token from the vars map", () => {
    const out = interpolate(
      "{{baseUrl}}/get",
      { baseUrl: "https://x.test" },
      {},
    );

    expect(out).toBe("https://x.test/get");
  });

  // AC-009 - behavior
  it("should replace multiple distinct tokens in one string", () => {
    const out = interpolate(
      "{{proto}}://{{host}}/path",
      { proto: "https", host: "api.test" },
      {},
    );

    expect(out).toBe("https://api.test/path");
  });

  // AC-009 - behavior
  it("should tolerate whitespace inside the braces like the current build-request", () => {
    const out = interpolate("{{ name }}", { name: "Ada" }, {});

    expect(out).toBe("Ada");
  });

  // AC-009 - behavior
  it("should return text with no tokens unchanged", () => {
    const out = interpolate("https://api.test/get", { baseUrl: "x" }, {});

    expect(out).toBe("https://api.test/get");
  });

  // AC-009 - behavior
  it("should return an empty string unchanged", () => {
    expect(interpolate("", { a: "1" }, {})).toBe("");
  });
});

describe("interpolate - process.env namespace", () => {
  // AC-005, AC-009, TC-003 - behavior
  it("should resolve {{process.env.KEY}} from the processEnv map", () => {
    const out = interpolate(
      "Bearer {{process.env.TOKEN}}",
      {},
      { TOKEN: "abc123" },
    );

    expect(out).toBe("Bearer abc123");
  });

  // AC-005 - behavior: process.env is a distinct namespace from plain vars
  it("should not resolve a bare {{KEY}} from processEnv", () => {
    const out = interpolate("{{TOKEN}}", {}, { TOKEN: "abc123" });

    expect(out).toBe("{{TOKEN}}");
  });

  // AC-005 - behavior: a plain var named like the env key does not read processEnv via process.env prefix
  it("should not resolve {{process.env.KEY}} from the plain vars map", () => {
    const out = interpolate("{{process.env.TOKEN}}", { TOKEN: "fromVars" }, {});

    expect(out).toBe("{{process.env.TOKEN}}");
  });
});

describe("interpolate - recursive resolution", () => {
  // AC-010, TC-005 - behavior
  it("should fully resolve a variable whose value references another variable", () => {
    const out = interpolate(
      "{{apiBase}}",
      { apiBase: "{{root}}/v1", root: "https://x.test" },
      {},
    );

    expect(out).toBe("https://x.test/v1");
  });

  // AC-010 - behavior
  it("should resolve a variable that references a process.env token", () => {
    const out = interpolate(
      "{{token}}",
      { token: "{{process.env.JWT}}" },
      { JWT: "ey.signed" },
    );

    expect(out).toBe("ey.signed");
  });

  // AC-010 - behavior: chain three levels deep
  it("should resolve a multi-level variable chain", () => {
    const out = interpolate("{{a}}", { a: "{{b}}", b: "{{c}}", c: "deep" }, {});

    expect(out).toBe("deep");
  });
});

describe("interpolate - cycle guard", () => {
  // AC-010, TC-005 - behavior
  it("should leave a mutually-referential token unresolved and not hang", () => {
    const out = interpolate("{{a}}", { a: "{{b}}", b: "{{a}}" }, {});

    expect(out).toContain("{{a}}");
  });

  // AC-010 - behavior
  it("should leave a self-referential token unresolved and not hang", () => {
    const out = interpolate("{{a}}", { a: "{{a}}" }, {});

    expect(out).toBe("{{a}}");
  });

  // AC-010 - behavior: a cycle next to a resolvable token still resolves the good one
  it("should resolve a healthy token even if a sibling token is in a cycle", () => {
    const out = interpolate(
      "{{good}}-{{a}}",
      { good: "ok", a: "{{b}}", b: "{{a}}" },
      {},
    );

    expect(out).toContain("ok");
    expect(out).toContain("{{a}}");
  });
});

describe("interpolate - unknown tokens", () => {
  // AC-011 - behavior
  it("should leave an unknown {{missing}} token verbatim", () => {
    const out = interpolate("{{missing}}/get", {}, {});

    expect(out).toBe("{{missing}}/get");
  });

  // AC-011 - behavior
  it("should leave an unknown {{process.env.MISSING}} token verbatim", () => {
    const out = interpolate("{{process.env.MISSING}}", {}, { OTHER: "x" });

    expect(out).toBe("{{process.env.MISSING}}");
  });

  // AC-011 - behavior: known + unknown side by side
  it("should resolve a known token and leave an unknown one beside it verbatim", () => {
    const out = interpolate("{{a}}/{{b}}", { a: "x" }, {});

    expect(out).toBe("x/{{b}}");
  });
});
