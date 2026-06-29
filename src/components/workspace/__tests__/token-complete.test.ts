import { describe, it, expect } from "vitest";

import {
  tokenCandidates,
  tokenCompletionAt,
  applyTokenCandidate,
  type TokenCandidate,
} from "@/components/workspace/token-complete";
import type { EffectiveConfig } from "@/lib/workspace/resolve";

const effective: EffectiveConfig = {
  variables: {
    BASE_URL: {
      value: "https://api",
      from: { scopeId: "f1", scopeName: "asd1" },
      origin: "variable",
    },
    ENV_TOKEN: {
      value: "tok",
      from: { scopeId: "f1:env-11", scopeName: "asd1 (env-11)" },
      origin: "environment",
    },
  },
  headers: {},
  params: {},
  auth: { value: { type: "inherit" }, from: { scopeId: "d", scopeName: "d" } },
  scripts: {
    pre: { value: "", from: { scopeId: "d", scopeName: "d" } },
    post: { value: "", from: { scopeId: "d", scopeName: "d" } },
  },
  timeoutMs: { value: 30000, from: { scopeId: "d", scopeName: "d" } },
};

const processEnv = { HOST: "localhost", PORT: "3000" };

describe("tokenCandidates", () => {
  // behavior: merges resolved variables (vars + env) with .env keys as
  // process.env.X, sorted, each tagged with its kind.
  it("should list variables, env vars and process.env keys sorted", () => {
    const result = tokenCandidates(effective, processEnv);

    expect(result.map((c) => c.name)).toEqual([
      "BASE_URL",
      "ENV_TOKEN",
      "process.env.HOST",
      "process.env.PORT",
    ]);
  });

  // behavior: each candidate carries its origin kind for the dropdown color/label.
  it("should tag each candidate with its kind", () => {
    const byName = Object.fromEntries(
      tokenCandidates(effective, processEnv).map((c) => [c.name, c.kind]),
    );

    expect(byName["BASE_URL"]).toBe("variable");
    expect(byName["ENV_TOKEN"]).toBe("environment");
    expect(byName["process.env.HOST"]).toBe("dotenv");
  });

  // behavior: groups ordered variables -> env vars -> .env, alpha within each group
  // (a plain var sorted AFTER an env var alphabetically still comes first).
  it("should order groups variable then environment then dotenv", () => {
    const grouped: EffectiveConfig = {
      ...effective,
      variables: {
        ZED_VAR: {
          value: "z",
          from: { scopeId: "f", scopeName: "f" },
          origin: "variable",
        },
        ALPHA_ENV: {
          value: "a",
          from: { scopeId: "f:e", scopeName: "f (e)" },
          origin: "environment",
        },
      },
    };

    expect(tokenCandidates(grouped, { HOST: "h" }).map((c) => c.name)).toEqual([
      "ZED_VAR",
      "ALPHA_ENV",
      "process.env.HOST",
    ]);
  });

  // behavior: same-source variables stay grouped (no name interleaving across
  // folders), and the NEAREST folder leads. effective.variables is built root ->
  // leaf, so the parent's keys (as24) are inserted first but the deeper folder
  // (lts) must come first in the dropdown.
  it("should group same-source variables and lead with the nearest folder", () => {
    const multiSource: EffectiveConfig = {
      ...effective,
      variables: {
        // as24 = parent (inserted first), lts = nearest/deeper (inserted later).
        CUSTOMER_ID: { value: "c", from: { scopeId: "a", scopeName: "as24" } },
        VIN: { value: "v", from: { scopeId: "a", scopeName: "as24" } },
        LTS_URL: { value: "u", from: { scopeId: "l", scopeName: "lts" } },
        MAKE_ID: { value: "m", from: { scopeId: "l", scopeName: "lts" } },
      },
    };

    expect(tokenCandidates(multiSource, {}).map((c) => c.name)).toEqual([
      // lts (nearest) group first, alphabetical; then as24 (parent) group.
      "LTS_URL",
      "MAKE_ID",
      "CUSTOMER_ID",
      "VIN",
    ]);
  });

  // behavior: a variable defined in the OWN scope (the request/folder being edited)
  // has no source label - its scope name is long/noisy (e.g. a request path) and
  // redundant. ownScopeId matches the variable's provenance scopeId.
  it("should blank the source for a variable from the own scope", () => {
    const own: EffectiveConfig = {
      ...effective,
      variables: {
        LOCAL_VAR: {
          value: "x",
          from: { scopeId: "req-1", scopeName: "/very/long/request/path" },
          origin: "variable",
        },
        BASE_URL: {
          value: "https://api",
          from: { scopeId: "f1", scopeName: "asd1" },
          origin: "variable",
        },
      },
    };

    const bySource = Object.fromEntries(
      tokenCandidates(own, {}, "req-1").map((c) => [c.name, c.source]),
    );
    expect(bySource["LOCAL_VAR"]).toBe("");
    expect(bySource["BASE_URL"]).toBe("asd1");
  });

  // behavior: with no effective config (e.g. a folder pane), only .env keys show.
  it("should still list process.env keys if effective is null", () => {
    expect(tokenCandidates(null, processEnv).map((c) => c.name)).toEqual([
      "process.env.HOST",
      "process.env.PORT",
    ]);
  });
});

describe("tokenCompletionAt", () => {
  const all: TokenCandidate[] = tokenCandidates(effective, processEnv);

  // behavior: caret right after `{{` (no prefix) offers every candidate.
  it("should offer all candidates if the caret is right after an open {{", () => {
    const text = "asd/{{";
    const result = tokenCompletionAt(text, text.length, all);

    expect(result).not.toBeNull();
    expect(result?.prefix).toBe("");
    expect(result?.candidates).toHaveLength(4);
  });

  // behavior: a typed prefix filters case-insensitively by substring.
  it("should filter candidates by the typed prefix", () => {
    const text = "asd/{{env";
    const result = tokenCompletionAt(text, text.length, all);

    expect(result?.prefix).toBe("env");
    expect(result?.candidates.map((c) => c.name)).toEqual([
      "ENV_TOKEN",
      "process.env.HOST",
      "process.env.PORT",
    ]);
  });

  // behavior: a process.env prefix narrows to .env keys.
  it("should filter to process.env keys for a process.env prefix", () => {
    const text = "{{process.env.h";
    const result = tokenCompletionAt(text, text.length, all);

    expect(result?.candidates.map((c) => c.name)).toEqual([
      "process.env.HOST",
    ]);
  });

  // behavior: no open token (plain text) -> no completion.
  it("should return null if the caret is not inside an open token", () => {
    expect(tokenCompletionAt("asd/path", 8, all)).toBeNull();
  });

  // behavior: caret past a CLOSED token -> no completion.
  it("should return null if the caret is past a closed token", () => {
    const text = "{{BASE_URL}}/x";
    expect(tokenCompletionAt(text, text.length, all)).toBeNull();
  });

  // behavior: a prefix matching nothing -> null (dropdown hidden).
  it("should return null if no candidate matches the prefix", () => {
    const text = "{{zzz";
    expect(tokenCompletionAt(text, text.length, all)).toBeNull();
  });

  // behavior: caret inside an open token that already has a closing `}}` after it
  // still completes (editing an existing token).
  it("should complete a token whose closing braces already follow the caret", () => {
    const text = "{{ba}}";
    const result = tokenCompletionAt(text, 4, all);

    expect(result?.prefix).toBe("ba");
    expect(result?.candidates.map((c) => c.name)).toEqual(["BASE_URL"]);
  });
});

describe("applyTokenCandidate", () => {
  const all = tokenCandidates(effective, processEnv);

  // behavior: inserting from an open `{{prefix` replaces the prefix with the full
  // name and auto-closes with `}}`; caret lands after the `}}`.
  it("should insert the name and auto-close with braces", () => {
    const text = "asd/{{ba";
    const caret = text.length;
    const completion = tokenCompletionAt(text, caret, all)!;
    const candidate = completion.candidates[0];

    const result = applyTokenCandidate(text, completion, caret, candidate);

    expect(result.text).toBe("asd/{{BASE_URL}}");
    expect(result.caret).toBe(result.text.length);
  });

  // behavior: when a `}}` already follows the caret, don't add another; caret lands
  // after the existing `}}`.
  it("should not double the closing braces if they already follow", () => {
    const text = "{{ba}}";
    const caret = 4;
    const completion = tokenCompletionAt(text, caret, all)!;
    const candidate = completion.candidates[0];

    const result = applyTokenCandidate(text, completion, caret, candidate);

    expect(result.text).toBe("{{BASE_URL}}");
    expect(result.caret).toBe("{{BASE_URL}}".length);
  });

  // behavior: text after the token is preserved.
  it("should preserve text after the inserted token", () => {
    const text = "{{ba/sellers";
    // caret right after "ba" (index 4); the "/sellers" is trailing text.
    const completion = tokenCompletionAt(text, 4, all)!;
    const result = applyTokenCandidate(
      text,
      completion,
      4,
      completion.candidates[0],
    );

    expect(result.text).toBe("{{BASE_URL}}/sellers");
  });
});
