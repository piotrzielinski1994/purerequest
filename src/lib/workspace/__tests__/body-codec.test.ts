import { describe, it, expect } from "vitest";
import {
  bodyToStored,
  storedToBody,
  type StoredBody,
} from "@/lib/workspace/body-codec";

describe("bodyToStored", () => {
  // behavior: a JSON object body becomes a json StoredBody with the parsed value.
  it("should produce a json StoredBody with the parsed payload if the body is JSON", () => {
    const stored = bodyToStored('{\n  "grant_type": "client_credentials"\n}');
    expect(stored).toEqual({
      type: "json",
      payload: { grant_type: "client_credentials" },
    });
  });

  // behavior: a JSON array body is also json (payload is the array).
  it("should produce a json StoredBody if the body is a JSON array", () => {
    expect(bodyToStored("[1, 2, 3]")).toEqual({ type: "json", payload: [1, 2, 3] });
  });

  // behavior: an empty body is text (not json), so it round-trips to "".
  it("should produce a text StoredBody if the body is empty", () => {
    expect(bodyToStored("")).toEqual({ type: "text", payload: "" });
  });

  // behavior: non-JSON text stays text.
  it("should produce a text StoredBody if the body is not valid JSON", () => {
    expect(bodyToStored("grant_type=client_credentials")).toEqual({
      type: "text",
      payload: "grant_type=client_credentials",
    });
  });

  // behavior: a bare JSON scalar (number/bool/null/quoted-string) stays TEXT, so
  // it round-trips verbatim instead of being re-quoted/re-typed as json.
  it.each(["123", "true", "null", '"hello"'])(
    "should keep the bare scalar %s as a text StoredBody (round-trips verbatim)",
    (scalar) => {
      const stored = bodyToStored(scalar);
      expect(stored).toEqual({ type: "text", payload: scalar });
      expect(storedToBody(stored)).toBe(scalar);
    },
  );
});

describe("storedToBody", () => {
  // behavior: a json StoredBody pretty-prints back to a 2-space JSON string.
  it("should pretty-print a json StoredBody to a 2-space JSON string", () => {
    const stored: StoredBody = {
      type: "json",
      payload: { grant_type: "client_credentials" },
    };
    expect(storedToBody(stored)).toBe(
      '{\n  "grant_type": "client_credentials"\n}',
    );
  });

  // behavior: a text StoredBody returns its raw payload.
  it("should return the raw payload of a text StoredBody", () => {
    expect(storedToBody({ type: "text", payload: "x=1" })).toBe("x=1");
  });

  // behavior: a legacy bare string body (pre-v3) is returned verbatim.
  it("should return a legacy bare string body verbatim", () => {
    expect(storedToBody('{\n  "a": 1\n}')).toBe('{\n  "a": 1\n}');
  });

  // behavior: undefined / unknown shapes fall back to empty.
  it("should fall back to an empty string for undefined or unknown shapes", () => {
    expect(storedToBody(undefined)).toBe("");
    expect(storedToBody(null)).toBe("");
    expect(storedToBody({ nope: true })).toBe("");
    expect(storedToBody(42)).toBe("");
  });
});

describe("round-trip", () => {
  // behavior: a canonically-formatted JSON body survives string -> stored -> string.
  it("should round-trip a canonical JSON body through stored form", () => {
    const original = JSON.stringify({ a: 1, b: [2, 3] }, null, 2);
    expect(storedToBody(bodyToStored(original))).toBe(original);
  });

  // behavior: the conversion is idempotent (re-pretty-printing is stable) even
  // from non-canonical input.
  it("should be idempotent if applied twice from non-canonical JSON", () => {
    const once = storedToBody(bodyToStored('{ "a":1,"b":[2,3] }'));
    expect(storedToBody(bodyToStored(once))).toBe(once);
  });

  // behavior: non-JSON text survives the round-trip unchanged.
  it("should round-trip non-JSON text through stored form", () => {
    const original = "not json at all";
    expect(storedToBody(bodyToStored(original))).toBe(original);
  });
});
