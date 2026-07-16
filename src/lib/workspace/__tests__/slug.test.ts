import { describe, it, expect } from "vitest";

import { slugify, uniqueSlug } from "@/lib/workspace/slug";

describe("slugify", () => {
  it("should lowercase and hyphenate a name", () => {
    expect(slugify("Get Users")).toBe("get-users");
  });

  it("should collapse runs of non-alphanumerics to a single hyphen and trim edges", () => {
    expect(slugify("  Hello_World!!  ")).toBe("hello-world");
  });

  it("should fall back to untitled for an empty or all-symbol name", () => {
    expect(slugify("")).toBe("untitled");
    expect(slugify("***")).toBe("untitled");
  });
});

describe("uniqueSlug", () => {
  it("should return the base unchanged when unused and record it", () => {
    const used = new Set<string>();
    expect(uniqueSlug("get", used)).toBe("get");
    expect(used.has("get")).toBe(true);
  });

  it("should append an incrementing numeric suffix on collision", () => {
    const used = new Set<string>(["get"]);
    expect(uniqueSlug("get", used)).toBe("get-2");
    expect(uniqueSlug("get", used)).toBe("get-3");
  });
});
