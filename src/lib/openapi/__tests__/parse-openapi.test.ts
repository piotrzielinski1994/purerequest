import { describe, it, expect } from "vitest";

import { parseOpenapiDocument } from "@/lib/openapi/parse-openapi";

// AC-008 ($ref resolution + external-ref-absent) is exercised observably through
// `openapiToTree` output in openapi-to-tree.test.ts - the parse layer returns the
// raw doc and the mapper is what resolves `#/` pointers, so the tree is where the
// resolved param/body become observable. This file pins parse + version gate.

function json(doc: Record<string, unknown>): string {
  return JSON.stringify(doc);
}

describe("parseOpenapiDocument - format + version gate (AC-001)", () => {
  // AC-001, TC-001 - behavior: a minimal 3.0 JSON doc parses (non-null).
  it("should parse a minimal 3.0 JSON document", () => {
    const doc = json({
      openapi: "3.0.0",
      info: { title: "x" },
      paths: { "/x": { get: {} } },
    });

    expect(parseOpenapiDocument(doc)).not.toBeNull();
  });

  // AC-001, TC-001 - behavior: the same doc written as YAML parses equivalently.
  it("should parse an equivalent 3.0 YAML document", () => {
    const yaml = [
      'openapi: "3.0.0"',
      "info:",
      "  title: x",
      "paths:",
      "  /x:",
      "    get: {}",
      "",
    ].join("\n");

    expect(parseOpenapiDocument(yaml)).not.toBeNull();
  });

  // AC-001, TC-001 - behavior: a 3.1 doc parses.
  it("should parse a 3.1 document", () => {
    const doc = json({
      openapi: "3.1.0",
      info: { title: "x" },
      paths: { "/x": { get: {} } },
    });

    expect(parseOpenapiDocument(doc)).not.toBeNull();
  });

  // AC-001, AC-010 - behavior: a YAML doc with a recoverable spec violation (a
  // mis-quoted multi-line scalar - seen in real-world files) still parses lenient
  // rather than being rejected wholesale.
  it("should leniently parse YAML with a recoverable spec violation", () => {
    const yaml = [
      'openapi: "3.0.0"',
      "info:",
      "  title: x",
      "paths:",
      "  /x:",
      "    get:",
      "      description: 'line one \\ line two",
      "        \\ line three",
      "      '",
      "      responses:",
      "        '200': { description: ok }",
      "",
    ].join("\n");

    expect(parseOpenapiDocument(yaml)).not.toBeNull();
  });
});

describe("parseOpenapiDocument - rejects non-3.x + invalid (AC-001, AC-010)", () => {
  // AC-001, TC-001 - behavior: a swagger 2.0 doc is gated out (null).
  it("should return null for a swagger 2.0 document", () => {
    const doc = json({ swagger: "2.0", info: { title: "x" }, paths: {} });

    expect(parseOpenapiDocument(doc)).toBeNull();
  });

  // AC-001, TC-001 - behavior: a doc with no openapi field is gated out (null).
  it("should return null for a document with no openapi field", () => {
    const doc = json({ info: { title: "x" }, paths: {} });

    expect(parseOpenapiDocument(doc)).toBeNull();
  });

  // AC-001 - behavior: an unsupported openapi version is gated out (null).
  it("should return null for an unsupported openapi version", () => {
    const doc = json({ openapi: "2.0.0", info: { title: "x" }, paths: {} });

    expect(parseOpenapiDocument(doc)).toBeNull();
  });

  // AC-010, TC-001 - behavior: invalid text (neither JSON nor YAML object) yields
  // null without throwing.
  it("should return null for invalid text", () => {
    expect(parseOpenapiDocument("{ broken")).toBeNull();
  });

  // AC-010 - behavior: an empty string yields null without throwing.
  it("should return null for an empty string", () => {
    expect(parseOpenapiDocument("")).toBeNull();
  });

  // AC-010 - behavior: a document that is not an object (array/scalar) yields null.
  it("should return null for a non-object document", () => {
    expect(parseOpenapiDocument("[1, 2, 3]")).toBeNull();
  });
});
