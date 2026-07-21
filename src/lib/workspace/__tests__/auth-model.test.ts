import { describe, expect, it } from "vitest";

import { authOf, emptyAuth } from "@/lib/workspace/model";

describe("emptyAuth", () => {
  // behavior: a fresh auth is inherit-active with both variant slots blank.
  it("should default to inherit with blank bearer and basic slots", () => {
    expect(emptyAuth()).toEqual({
      active: "inherit",
      types: { bearer: { token: "" }, basic: { username: "", password: "" } },
    });
  });
});

describe("authOf", () => {
  // behavior: bearer fills only the bearer slot; basic stays blank.
  it("should fill only the bearer slot for a bearer auth", () => {
    const auth = authOf({ active: "bearer", token: "t" });

    expect(auth.active).toBe("bearer");
    expect(auth.types.bearer).toEqual({ token: "t" });
    expect(auth.types.basic).toEqual({ username: "", password: "" });
  });

  // behavior: basic fills only the basic slot; bearer stays blank.
  it("should fill only the basic slot for a basic auth", () => {
    const auth = authOf({ active: "basic", username: "u", password: "p" });

    expect(auth.active).toBe("basic");
    expect(auth.types.basic).toEqual({ username: "u", password: "p" });
    expect(auth.types.bearer).toEqual({ token: "" });
  });

  // behavior: none/inherit carry no filled slots (both blank).
  it("should leave both slots blank for none and inherit", () => {
    expect(authOf({ active: "none" }).types).toEqual(emptyAuth().types);
    expect(authOf({ active: "inherit" }).types).toEqual(emptyAuth().types);
  });
});

describe("auth type switch preserves other slots", () => {
  // behavior: flipping `active` (as the AuthPanel does) keeps every `types` slot,
  // so switching bearer -> basic -> bearer never loses the token or the creds.
  it("should retain the bearer token when switching to basic and back", () => {
    const bearer = authOf({ active: "bearer", token: "kept" });

    // switch to basic + fill it (mirrors AuthPanel's `{ ...auth, active }` + slot edit).
    const basic = {
      ...bearer,
      active: "basic" as const,
      types: {
        ...bearer.types,
        basic: { username: "u", password: "p" },
      },
    };
    // switch back to bearer.
    const backToBearer = { ...basic, active: "bearer" as const };

    expect(backToBearer.types.bearer.token).toBe("kept");
    expect(backToBearer.types.basic).toEqual({ username: "u", password: "p" });
  });
});
