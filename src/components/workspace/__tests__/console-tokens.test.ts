import { describe, it, expect } from "vitest";

import { tokenizeConsoleLine } from "@/components/workspace/console-line";

const kinds = (line: string) =>
  tokenizeConsoleLine(line).map((s) => `${s.kind}:${s.text}`);

describe("tokenizeConsoleLine", () => {
  it("should return a single plain segment for plain text", () => {
    expect(tokenizeConsoleLine("Hello World")).toEqual([
      { kind: "plain", text: "Hello World" },
    ]);
  });

  it("should color a JSON property name as a key and its value as a string", () => {
    const segs = tokenizeConsoleLine('{"name":"bar"}');

    expect(segs).toContainEqual({ kind: "key", text: '"name"' });
    expect(segs).toContainEqual({ kind: "string", text: '"bar"' });
  });

  it("should color a number value", () => {
    expect(kinds('{"asd":2}')).toContain("key:\"asd\"");
    expect(kinds('{"asd":2}')).toContain("number:2");
  });

  it("should color true/false/null as keywords", () => {
    expect(kinds("[true, false, null]")).toEqual(
      expect.arrayContaining(["keyword:true", "keyword:false", "keyword:null"]),
    );
  });

  it("should keep the [pre] prefix and punctuation as plain", () => {
    const segs = tokenizeConsoleLine('[pre] {"a":1}');
    const plain = segs.filter((s) => s.kind === "plain").map((s) => s.text).join("");

    expect(plain).toContain("[pre] ");
    expect(plain).toContain("{");
    expect(plain).toContain("}");
  });

  it("should distinguish a string value from a key by the following colon", () => {
    const segs = tokenizeConsoleLine('{"k": "v"}');

    expect(segs).toContainEqual({ kind: "key", text: '"k"' });
    expect(segs).toContainEqual({ kind: "string", text: '"v"' });
  });

  it("should reassemble to the original line", () => {
    const line = '[post] {"id":7,"ok":true,"name":"x"}';

    expect(tokenizeConsoleLine(line).map((s) => s.text).join("")).toBe(line);
  });

  it("should handle an escaped quote inside a string", () => {
    const segs = tokenizeConsoleLine('"a\\"b"');

    expect(segs).toEqual([{ kind: "string", text: '"a\\"b"' }]);
  });
});
