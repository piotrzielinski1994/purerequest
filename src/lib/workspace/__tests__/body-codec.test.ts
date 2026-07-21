import { describe, expect, it } from "vitest";
import {
  bodyToDisk,
  diskToBody,
  legacyStoredToBody,
} from "@/lib/workspace/body-codec";

describe("bodyToDisk", () => {
  // behavior: a JSON object body becomes its parsed value (real nested JSON).
  it("should produce the parsed value if the body is a JSON object", () => {
    expect(bodyToDisk('{\n  "grant_type": "client_credentials"\n}')).toEqual({
      grant_type: "client_credentials",
    });
  });

  // behavior: a JSON array body becomes the parsed array.
  it("should produce the parsed array if the body is a JSON array", () => {
    expect(bodyToDisk("[1, 2, 3]")).toEqual([1, 2, 3]);
  });

  // behavior: an empty body stays a string, so it round-trips to "".
  it("should keep an empty body as a string", () => {
    expect(bodyToDisk("")).toBe("");
  });

  // behavior: non-JSON text stays a string.
  it("should keep a non-JSON body as a string", () => {
    expect(bodyToDisk("grant_type=client_credentials")).toBe(
      "grant_type=client_credentials",
    );
  });

  // behavior: a bare JSON scalar (number/bool/null/quoted-string) stays a STRING,
  // so it round-trips verbatim instead of being re-typed as a JSON value.
  it.each(["123", "true", "null", '"hello"'])(
    "should keep the bare scalar %s as a string (round-trips verbatim)",
    (scalar) => {
      expect(bodyToDisk(scalar)).toBe(scalar);
      expect(diskToBody(bodyToDisk(scalar))).toBe(scalar);
    },
  );
});

describe("diskToBody", () => {
  // behavior: a JSON object/array value pretty-prints back to a 2-space string.
  it("should pretty-print a JSON object value to a 2-space JSON string", () => {
    expect(diskToBody({ grant_type: "client_credentials" })).toBe(
      '{\n  "grant_type": "client_credentials"\n}',
    );
  });

  // behavior: a string value is returned verbatim.
  it("should return a string value verbatim", () => {
    expect(diskToBody("x=1")).toBe("x=1");
  });

  // behavior: undefined / null fall back to empty.
  it("should fall back to an empty string for undefined or null", () => {
    expect(diskToBody(undefined)).toBe("");
    expect(diskToBody(null)).toBe("");
  });
});

describe("legacyStoredToBody", () => {
  // behavior: the retired tagged json body pretty-prints back to a JSON string.
  it("should pretty-print a legacy tagged json body", () => {
    expect(
      legacyStoredToBody({
        type: "json",
        payload: { grant_type: "client_credentials" },
      }),
    ).toBe('{\n  "grant_type": "client_credentials"\n}');
  });

  // behavior: the retired tagged text body returns its raw payload.
  it("should return the raw payload of a legacy tagged text body", () => {
    expect(legacyStoredToBody({ type: "text", payload: "x=1" })).toBe("x=1");
  });

  // behavior: a legacy bare string body (pre-v3) is returned verbatim.
  it("should return a legacy bare string body verbatim", () => {
    expect(legacyStoredToBody('{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
  });

  // behavior: undefined / null fall back to empty.
  it("should fall back to an empty string for undefined or null", () => {
    expect(legacyStoredToBody(undefined)).toBe("");
    expect(legacyStoredToBody(null)).toBe("");
  });
});

describe("round-trip", () => {
  // behavior: a canonically-formatted JSON body survives string -> disk -> string.
  it("should round-trip a canonical JSON body through disk form", () => {
    const original = JSON.stringify({ a: 1, b: [2, 3] }, null, 2);
    expect(diskToBody(bodyToDisk(original))).toBe(original);
  });

  // behavior: the conversion is idempotent (re-pretty-printing is stable) even
  // from non-canonical input.
  it("should be idempotent if applied twice from non-canonical JSON", () => {
    const once = diskToBody(bodyToDisk('{ "a":1,"b":[2,3] }'));
    expect(diskToBody(bodyToDisk(once))).toBe(once);
  });

  // behavior: non-JSON text survives the round-trip unchanged.
  it("should round-trip non-JSON text through disk form", () => {
    const original = "not json at all";
    expect(diskToBody(bodyToDisk(original))).toBe(original);
  });
});
