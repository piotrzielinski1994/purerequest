import { describe, expect, it } from "vitest";
import type { ThemeColors } from "@/lib/settings/settings";
import { applyDefaults, diffOverrides } from "@/lib/theme/overrides";

// Stage 2 - Themes feature. overrides.ts is pure:
//  - applyDefaults(sparse, defaults) -> the FULL effective set (defaults with
//    sparse overrides layered on top), used to seed the editor + apply to the DOM.
//  - diffOverrides(edited, defaults) -> the SPARSE diff (only entries differing
//    from the default; whitespace-insensitive oklch compare), so an un-customized
//    token tracks the built-in default and editing a token back to default drops
//    it (AC-007 / AC-008 sparse-store = per-token reset).
// Round-trip: diffOverrides(applyDefaults(x, d), d) deep-equals x.

// A small, self-contained defaults table (not the real one) so the test pins the
// pure layering/diff behavior, not the canonical values.
const DEFAULTS: ThemeColors = {
  light: {
    tokens: {
      background: "oklch(1 0 0)",
      foreground: "oklch(0.145 0 0)",
      primary: "oklch(0.205 0 0)",
    },
    editor: {
      string: "oklch(0.6 0.1 140)",
      keyword: "oklch(0.7 0.2 30)",
    },
  },
  dark: {
    tokens: {
      background: "oklch(0.145 0 0)",
      foreground: "oklch(0.985 0 0)",
      primary: "oklch(0.922 0 0)",
    },
    editor: {
      string: "oklch(0.7 0.1 140)",
      keyword: "oklch(0.6 0.2 30)",
    },
  },
} as unknown as ThemeColors;

const emptyColors = (): ThemeColors => ({
  light: { tokens: {}, editor: {} },
  dark: { tokens: {}, editor: {} },
});

describe("applyDefaults", () => {
  // AC-005 - behavior: an overridden token wins; the others fall back to default.
  it("should layer a sparse override over the defaults", () => {
    const sparse: ThemeColors = {
      light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
      dark: { tokens: {}, editor: {} },
    };

    const effective = applyDefaults(sparse, DEFAULTS);

    // overridden token wins
    expect(effective.light.tokens.primary).toBe("oklch(0.55 0.22 27)");
    // un-overridden tokens fall back to the built-in default
    expect(effective.light.tokens.background).toBe(
      DEFAULTS.light.tokens.background,
    );
    expect(effective.light.tokens.foreground).toBe(
      DEFAULTS.light.tokens.foreground,
    );
  });

  // AC-009 - behavior: the full effective set carries EVERY default token (so
  // all tokens are discoverable in the seeded editor).
  it("should return the full set when no overrides are present", () => {
    const effective = applyDefaults(emptyColors(), DEFAULTS);

    expect(effective.light.tokens).toEqual(DEFAULTS.light.tokens);
    expect(effective.dark.tokens).toEqual(DEFAULTS.dark.tokens);
    expect(effective.light.editor).toEqual(DEFAULTS.light.editor);
    expect(effective.dark.editor).toEqual(DEFAULTS.dark.editor);
  });

  // AC-005 - behavior: overrides for the two modes are independent.
  it("should keep the two modes independent when only one is overridden", () => {
    const sparse: ThemeColors = {
      light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
      dark: { tokens: {}, editor: {} },
    };

    const effective = applyDefaults(sparse, DEFAULTS);

    expect(effective.light.tokens.primary).toBe("oklch(0.55 0.22 27)");
    expect(effective.dark.tokens.primary).toBe(DEFAULTS.dark.tokens.primary);
  });

  // AC-011 (editor half) - behavior: editor overrides layer the same way.
  it("should layer an editor-token override over the defaults", () => {
    const sparse: ThemeColors = {
      light: { tokens: {}, editor: { string: "oklch(0.74 0.15 60)" } },
      dark: { tokens: {}, editor: {} },
    };

    const effective = applyDefaults(sparse, DEFAULTS);

    expect(effective.light.editor.string).toBe("oklch(0.74 0.15 60)");
    expect(effective.light.editor.keyword).toBe(DEFAULTS.light.editor.keyword);
  });
});

describe("diffOverrides", () => {
  // AC-007 - behavior: only entries differing from the default are kept.
  it("should keep only the tokens that differ from the default", () => {
    const edited = applyDefaults(
      {
        light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
        dark: { tokens: {}, editor: {} },
      },
      DEFAULTS,
    );

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light.tokens).toEqual({ primary: "oklch(0.55 0.22 27)" });
    // everything left at default is dropped
    expect(diff.light.tokens.background).toBeUndefined();
    expect(diff.dark.tokens).toEqual({});
  });

  // AC-008 - behavior: a token edited BACK to its default drops out (the reset).
  it("should drop a token whose value equals the built-in default", () => {
    const edited: ThemeColors = {
      // primary set BACK to the exact default => must not be stored
      light: {
        tokens: { primary: DEFAULTS.light.tokens.primary! },
        editor: {},
      },
      dark: { tokens: {}, editor: {} },
    };

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light.tokens.primary).toBeUndefined();
    expect(diff.light.tokens).toEqual({});
  });

  // AC-008 - behavior: whitespace-insensitive compare treats spacing variants as
  // equal (so a re-formatted-but-equal value is treated as a reset, not a diff).
  it("should treat a whitespace-only variant of the default as equal and drop it", () => {
    const edited: ThemeColors = {
      // default is "oklch(1 0 0)"; same value with extra spaces must be dropped
      light: { tokens: { background: "oklch(1  0   0)" }, editor: {} },
      dark: { tokens: {}, editor: {} },
    };

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light.tokens.background).toBeUndefined();
  });

  // AC-008 - behavior: a genuinely different value (despite shared prefix) stays.
  it("should keep a value that differs from the default after whitespace normalization", () => {
    const edited: ThemeColors = {
      light: { tokens: { background: "oklch(0.99 0 0)" }, editor: {} },
      dark: { tokens: {}, editor: {} },
    };

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.light.tokens.background).toBe("oklch(0.99 0 0)");
  });

  // AC-011 (editor half) - behavior: editor-token diffing works the same way.
  it("should keep only the editor tokens that differ from the default", () => {
    const edited = applyDefaults(
      {
        light: { tokens: {}, editor: {} },
        dark: { tokens: {}, editor: { string: "oklch(0.74 0.15 60)" } },
      },
      DEFAULTS,
    );

    const diff = diffOverrides(edited, DEFAULTS);

    expect(diff.dark.editor).toEqual({ string: "oklch(0.74 0.15 60)" });
    expect(diff.dark.editor.keyword).toBeUndefined();
  });
});

describe("diffOverrides / applyDefaults round-trip", () => {
  // AC-007, AC-008 - behavior: diff(apply(x, d), d) deep-equals x for a
  // representative sparse x spanning app + editor tokens in both modes.
  it("should round-trip a representative sparse override set", () => {
    const sparse: ThemeColors = {
      light: {
        tokens: { primary: "oklch(0.55 0.22 27)" },
        editor: { keyword: "oklch(0.71 0.2 30)" },
      },
      dark: {
        tokens: { background: "oklch(0.12 0 0)" },
        editor: { string: "oklch(0.74 0.15 60)" },
      },
    };

    const roundTripped = diffOverrides(
      applyDefaults(sparse, DEFAULTS),
      DEFAULTS,
    );

    expect(roundTripped).toEqual(sparse);
  });

  // AC-009 - behavior: an empty sparse set survives the round-trip as empty (no
  // default leaks into the stored diff).
  it("should round-trip an empty sparse set to empty", () => {
    const roundTripped = diffOverrides(
      applyDefaults(emptyColors(), DEFAULTS),
      DEFAULTS,
    );

    expect(roundTripped).toEqual(emptyColors());
  });
});
