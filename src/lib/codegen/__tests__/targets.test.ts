import { describe, it, expect } from "vitest";

// Imported before the module exists so RED fails on the missing feature.
import {
  CODE_TARGETS,
  codeTargetById,
  type CodeTargetId,
  type CodeTarget,
} from "@/lib/codegen/targets";
import { toCurl } from "@/lib/curl/to-curl";
import { toFetch } from "@/lib/codegen/to-fetch";
import type { HttpRequest } from "@/lib/http/model";
import type { Auth, HttpMethod, KeyValue } from "@/lib/workspace/model";
import { authOf } from "@/lib/workspace/model";

const wire = (
  over: Partial<HttpRequest> & {
    method?: HttpMethod;
    headers?: KeyValue[];
    body?: string | null;
    auth?: Auth;
  } = {},
): HttpRequest => ({
  method: "GET",
  url: "https://api.example.com/widgets",
  headers: [],
  body: null,
  auth: authOf({ active: "none" }),
  timeoutMs: 30000,
  requestId: "rid",
  ...over,
});

const representative = wire({
  method: "POST",
  url: "https://api.example.com/widgets?page=2",
  headers: [
    { key: "Authorization", value: "Bearer abc123" },
    { key: "Content-Type", value: "application/json" },
  ],
  auth: authOf({ active: "bearer", token: "abc123" }),
  body: '{"name":"foo"}',
});

describe("CODE_TARGETS - registry order + labels (AC-003)", () => {
  // AC-003 - behavior: exactly [curl, fetch] with these ids/labels, in this
  // order (dropdown order); curl is first (the default).
  it("should list exactly cURL then JavaScript - fetch, in that order", () => {
    const idsAndLabels = CODE_TARGETS.map((target: CodeTarget) => ({
      id: target.id,
      label: target.label,
    }));

    expect(idsAndLabels).toEqual([
      { id: "curl", label: "cURL" },
      { id: "fetch", label: "JavaScript - fetch" },
    ]);
  });

  // AC-003 - behavior: the first target (the default) is curl.
  it("should have curl as the first (default) target", () => {
    expect(CODE_TARGETS[0].id).toBe("curl");
  });

  // AC-003 - behavior: every registered target carries a non-empty label.
  it("should give every target a non-empty label", () => {
    CODE_TARGETS.forEach((target) => {
      expect(target.label.length).toBeGreaterThan(0);
    });
  });
});

describe("CODE_TARGETS - generate strategies (AC-008)", () => {
  // AC-008, TC-006 - behavior: the curl target reuses toCurl byte-for-byte
  // (regression guard against reimplementation).
  it("should produce byte-identical output to toCurl for the curl target", () => {
    const curl = CODE_TARGETS.find((target) => target.id === "curl");

    expect(curl).toBeDefined();
    expect(curl!.generate(representative)).toBe(toCurl(representative));
  });

  // behavior: the fetch target delegates to toFetch byte-for-byte.
  it("should produce byte-identical output to toFetch for the fetch target", () => {
    const fetchTarget = CODE_TARGETS.find((target) => target.id === "fetch");

    expect(fetchTarget).toBeDefined();
    expect(fetchTarget!.generate(representative)).toBe(toFetch(representative));
  });
});

describe("codeTargetById - lookup helper", () => {
  // behavior: resolves a known id to its target.
  it("should return the curl target for the id \"curl\"", () => {
    const target = codeTargetById("curl");

    expect(target.id).toBe("curl");
    expect(target.label).toBe("cURL");
  });

  // behavior: resolves the fetch id to the fetch target.
  it("should return the fetch target for the id \"fetch\"", () => {
    const target = codeTargetById("fetch");

    expect(target.id).toBe("fetch");
    expect(target.label).toBe("JavaScript - fetch");
  });

  // behavior: the resolved target's generate matches the underlying generator.
  it("should return a target whose generate delegates to the right generator", () => {
    const id: CodeTargetId = "fetch";

    expect(codeTargetById(id).generate(representative)).toBe(
      toFetch(representative),
    );
  });
});
