import { describe, expect, it } from "vitest";

import { apiMembers } from "@/components/workspace/script-api-complete";

describe("apiMembers", () => {
  it("should list the purerequest methods in both stages", () => {
    expect(apiMembers("purerequest", "pre")).toEqual([
      "getVar",
      "setVar",
      "getProcessEnv",
      "getEnvName",
    ]);
    expect(apiMembers("purerequest", "post")).toEqual(
      apiMembers("purerequest", "pre"),
    );
  });

  it("should list the console methods in both stages", () => {
    expect(apiMembers("console", "pre")).toEqual([
      "log",
      "info",
      "warn",
      "error",
      "clear",
    ]);
  });

  it("should list the full req read+write set in the pre stage", () => {
    expect(apiMembers("req", "pre")).toContain("setUrl");
    expect(apiMembers("req", "pre")).toContain("setHeader");
    expect(apiMembers("req", "pre")).toContain("getUrl");
  });

  // `req` is also available in post (read-only): getters yes, setters no (a post
  // setter would mutate a draft discarded after send).
  it("should list only the read-only req getters in the post stage", () => {
    expect(apiMembers("req", "post")).toContain("getUrl");
    expect(apiMembers("req", "post")).toContain("getHeader");
    expect(apiMembers("req", "post")).not.toContain("setUrl");
    expect(apiMembers("req", "post")).not.toContain("setHeader");
  });

  it("should list res methods only in the post stage", () => {
    expect(apiMembers("res", "post")).toContain("getStatus");
    expect(apiMembers("res", "post")).toContain("getJson");
    expect(apiMembers("res", "pre")).toEqual([]);
  });

  it("should return an empty list for an unknown object", () => {
    expect(apiMembers("window", "pre")).toEqual([]);
  });
});
