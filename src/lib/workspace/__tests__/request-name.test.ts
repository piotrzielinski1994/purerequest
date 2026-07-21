import { describe, expect, it } from "vitest";

import { deriveRequestName } from "@/lib/workspace/request-name";

describe("deriveRequestName", () => {
  // behavior: a {{baseUrl}} prefix is stripped, leaving the path (matches the
  // demo workspace convention: name == the request path).
  it("should strip a leading {{var}} prefix and keep the path", () => {
    expect(deriveRequestName("{{baseUrl}}/billing/invoices")).toBe(
      "/billing/invoices",
    );
  });

  // behavior: a scheme + host is stripped, leaving the path.
  it("should strip a leading scheme and host and keep the path", () => {
    expect(deriveRequestName("https://api.example.com/users/123")).toBe(
      "/users/123",
    );
  });

  // behavior: a query string is dropped.
  it("should drop the query string", () => {
    expect(deriveRequestName("{{baseUrl}}/get?env=prod&x=1")).toBe("/get");
  });

  // behavior: a hash fragment is dropped.
  it("should drop the hash fragment", () => {
    expect(deriveRequestName("{{baseUrl}}/path#frag")).toBe("/path");
  });

  // behavior: a path that carries :params is preserved verbatim.
  it("should keep :param segments in the path", () => {
    expect(deriveRequestName("{{baseUrl}}/users/:id")).toBe("/users/:id");
  });

  // behavior: an empty / prefix-only URL yields no name (caller keeps the
  // default).
  it("should return an empty string if there is no path", () => {
    expect(deriveRequestName("")).toBe("");
    expect(deriveRequestName("{{baseUrl}}")).toBe("");
    expect(deriveRequestName("https://api.example.com")).toBe("");
  });

  // behavior: a bare string with no {{var}}/scheme prefix is used verbatim as
  // the name (the user is typing a path/name directly, e.g. "asds").
  it("should use a bare string with no prefix as the name", () => {
    expect(deriveRequestName("asds")).toBe("asds");
    expect(deriveRequestName("/asd")).toBe("/asd");
    expect(deriveRequestName("users/list")).toBe("users/list");
  });

  // behavior: a bare string still drops its query/hash.
  it("should drop the query from a bare string", () => {
    expect(deriveRequestName("search?q=1")).toBe("search");
  });

  // behavior: surrounding whitespace is trimmed.
  it("should trim surrounding whitespace", () => {
    expect(deriveRequestName("  {{baseUrl}}/foo  ")).toBe("/foo");
  });
});
