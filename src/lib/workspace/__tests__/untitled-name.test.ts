import { describe, expect, it } from "vitest";

import { untitledName } from "@/lib/workspace/request-name";

describe("untitledName", () => {
  // behavior: with no existing untitled name, the plain base is used.
  it("should return 'untitled' if no name is taken", () => {
    expect(untitledName([])).toBe("untitled");
    expect(untitledName(["echo", "billing"])).toBe("untitled");
  });

  // behavior: if 'untitled' is taken, the first free index suffix is used.
  it("should return 'untitled-2' if 'untitled' is taken", () => {
    expect(untitledName(["untitled"])).toBe("untitled-2");
  });

  // behavior: it picks the lowest free index across a run of taken names.
  it("should pick the lowest free index", () => {
    expect(untitledName(["untitled", "untitled-2", "untitled-3"])).toBe(
      "untitled-4",
    );
  });

  // behavior: a gap in the indices is filled.
  it("should fill a gap in the taken indices", () => {
    expect(untitledName(["untitled", "untitled-3"])).toBe("untitled-2");
  });

  // behavior: unrelated names never collide with the untitled scheme.
  it("should ignore names that are not the untitled base", () => {
    expect(untitledName(["untitledX", "my-untitled", "untitled "])).toBe(
      "untitled",
    );
  });
});
