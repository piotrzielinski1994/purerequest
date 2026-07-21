import { describe, expect, it } from "vitest";

import { DEFAULT_SETTINGS, mergeSettings } from "@/lib/settings/settings";

// Stage 2 - Themes feature, colors half. mergeSettings now ALSO tolerantly merges
// theme.colors (a new mergeThemeColors): keeps only known AppTokenName /
// EditorTokenName keys with STRING values, drops unknown keys / non-string values
// / non-object sections, and tolerates a missing colors. Covers AC-006 (colors
// are part of the model the merge tolerates) and the §7 edge cases (malformed
// theme.json never throws, unknown keys / invalid types are dropped).

describe("mergeSettings theme.colors", () => {
  // AC-005, AC-006 - behavior: a known overridden app token is kept.
  it("should keep a known overridden app token (light.tokens.primary)", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: {
        mode: "light",
        colors: {
          light: { tokens: { primary: "oklch(0.55 0.22 27)" }, editor: {} },
          dark: { tokens: {}, editor: {} },
        },
      },
    });

    expect(merged.theme.colors.light.tokens.primary).toBe(
      "oklch(0.55 0.22 27)",
    );
  });

  // AC-011 - behavior: a known editor token is kept.
  it("should keep a known overridden editor token (dark.editor.string)", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: {
        mode: "dark",
        colors: {
          light: { tokens: {}, editor: {} },
          dark: { tokens: {}, editor: { string: "oklch(0.74 0.15 60)" } },
        },
      },
    });

    expect(merged.theme.colors.dark.editor.string).toBe("oklch(0.74 0.15 60)");
  });

  // §7 edge case - behavior: an unknown token key is dropped (keyed to the union).
  it("should drop an unknown app token key", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: {
        mode: "light",
        colors: {
          light: {
            tokens: { primary: "oklch(0.55 0.22 27)", bogus: "oklch(0 0 0)" },
            editor: {},
          },
          dark: { tokens: {}, editor: {} },
        },
      },
    });

    expect(merged.theme.colors.light.tokens.primary).toBe(
      "oklch(0.55 0.22 27)",
    );
    expect(merged.theme.colors.light.tokens).not.toHaveProperty("bogus");
  });

  it("should drop an unknown editor token key", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: {
        mode: "dark",
        colors: {
          light: { tokens: {}, editor: {} },
          dark: {
            tokens: {},
            editor: { string: "oklch(0.74 0.15 60)", nope: "oklch(0 0 0)" },
          },
        },
      },
    });

    expect(merged.theme.colors.dark.editor.string).toBe("oklch(0.74 0.15 60)");
    expect(merged.theme.colors.dark.editor).not.toHaveProperty("nope");
  });

  // §7 edge case - behavior: a non-string token value is dropped.
  it("should drop a non-string token value", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: {
        mode: "light",
        colors: {
          light: {
            tokens: { primary: 42, background: "oklch(1 0 0)" },
            editor: {},
          },
          dark: { tokens: {}, editor: {} },
        },
      },
    });

    expect(merged.theme.colors.light.tokens).not.toHaveProperty("primary");
    expect(merged.theme.colors.light.tokens.background).toBe("oklch(1 0 0)");
  });

  // §7 edge case - behavior: a missing colors falls back to empty maps.
  it("should tolerate a theme with no colors", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: { mode: "dark" },
    });

    expect(merged.theme.colors.light.tokens).toEqual({});
    expect(merged.theme.colors.light.editor).toEqual({});
    expect(merged.theme.colors.dark.tokens).toEqual({});
    expect(merged.theme.colors.dark.editor).toEqual({});
  });

  // §7 edge case - behavior: a non-object colors falls back to empty maps.
  it("should fall back to empty maps if colors is not an object", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: { mode: "dark", colors: "garbage" },
    });

    expect(merged.theme.colors).toEqual(DEFAULT_SETTINGS.theme.colors);
  });

  // §7 edge case - behavior: a non-object per-mode section falls back to empty.
  it("should fall back to empty maps if a per-mode section is not an object", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: {
        mode: "light",
        colors: { light: "nope", dark: { tokens: {}, editor: {} } },
      },
    });

    expect(merged.theme.colors.light.tokens).toEqual({});
    expect(merged.theme.colors.light.editor).toEqual({});
  });

  // §7 edge case - behavior: a non-object tokens/editor sub-map falls back to empty.
  it("should fall back to empty maps if tokens or editor is not an object", () => {
    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: {
        mode: "light",
        colors: {
          light: { tokens: 42, editor: "x" },
          dark: { tokens: {}, editor: {} },
        },
      },
    });

    expect(merged.theme.colors.light.tokens).toEqual({});
    expect(merged.theme.colors.light.editor).toEqual({});
  });

  // §7 edge case - behavior: garbage anywhere in theme.colors must not throw.
  it("should not throw if theme.colors is garbage", () => {
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { theme: { mode: "light", colors: [] } }),
    ).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, { theme: { mode: "light", colors: 42 } }),
    ).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, {
        theme: {
          mode: "light",
          colors: { light: null, dark: [{ nope: true }] },
        },
      }),
    ).not.toThrow();
    expect(() =>
      mergeSettings(DEFAULT_SETTINGS, {
        theme: {
          mode: "light",
          colors: {
            light: { tokens: { primary: null }, editor: { string: 7 } },
            dark: { tokens: [], editor: null },
          },
        },
      }),
    ).not.toThrow();
  });

  // AC-005, AC-011 - behavior: a full valid colors map round-trips both modes.
  it("should keep a full valid colors map across both modes and sections", () => {
    const colors = {
      light: {
        tokens: { primary: "oklch(0.55 0.22 27)" },
        editor: { keyword: "oklch(0.71 0.2 30)" },
      },
      dark: {
        tokens: { background: "oklch(0.12 0 0)" },
        editor: { string: "oklch(0.74 0.15 60)" },
      },
    };

    const merged = mergeSettings(DEFAULT_SETTINGS, {
      theme: { mode: "system", colors },
    });

    expect(merged.theme.colors).toEqual(colors);
  });
});
