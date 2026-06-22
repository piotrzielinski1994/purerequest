import { describe, it, expect } from "vitest";

import { parseConsoleObjectLine } from "@/components/workspace/console-line";

describe("parseConsoleObjectLine", () => {
  it("should split a pre-prefixed object line into prefix + json", () => {
    expect(parseConsoleObjectLine('[pre] {\n  "asd": 2\n}')).toEqual({
      prefix: "[pre] ",
      json: '{\n  "asd": 2\n}',
    });
  });

  it("should split a post-prefixed array line", () => {
    expect(parseConsoleObjectLine("[post] [\n  1,\n  2\n]")).toEqual({
      prefix: "[post] ",
      json: "[\n  1,\n  2\n]",
    });
  });

  it("should handle a non-prefixed object line", () => {
    expect(parseConsoleObjectLine('{"a":1}')).toEqual({
      prefix: "",
      json: '{"a":1}',
    });
  });

  it("should return null for a plain text line", () => {
    expect(parseConsoleObjectLine("[pre] Hello World")).toBeNull();
  });

  it("should split leading text before the object into the prefix", () => {
    expect(parseConsoleObjectLine('[pre] asd: {\n  "asd": 2\n}')).toEqual({
      prefix: "[pre] asd: ",
      json: '{\n  "asd": 2\n}',
    });
  });

  it("should return null when text trails the object", () => {
    expect(parseConsoleObjectLine('[pre] hello {\n  "n": 1\n} 42')).toBeNull();
  });

  it("should return null for a workspace line that is not JSON", () => {
    expect(
      parseConsoleObjectLine('[workspace] Set "workspacePath" in settings.json'),
    ).toBeNull();
  });

  it("should return null for a bracketed-but-not-JSON line", () => {
    expect(parseConsoleObjectLine("[12:00:00] Ready.")).toBeNull();
  });

  it("should return null for a bare scalar", () => {
    expect(parseConsoleObjectLine("[pre] 42")).toBeNull();
    expect(parseConsoleObjectLine('[pre] "just a string"')).toBeNull();
  });
});
