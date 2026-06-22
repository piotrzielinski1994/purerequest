import { describe, it, expect } from "vitest";

import { apiMembers } from "@/components/workspace/script-api-complete";

describe("apiMembers", () => {
  it("should list the requi methods in both stages", () => {
    expect(apiMembers("requi", "pre")).toEqual([
      "getVar",
      "setVar",
      "getProcessEnv",
      "getEnvName",
    ]);
    expect(apiMembers("requi", "post")).toEqual(apiMembers("requi", "pre"));
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

  it("should list req methods only in the pre stage", () => {
    expect(apiMembers("req", "pre")).toContain("setUrl");
    expect(apiMembers("req", "pre")).toContain("setHeader");
    expect(apiMembers("req", "post")).toEqual([]);
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
