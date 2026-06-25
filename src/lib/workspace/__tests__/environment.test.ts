import { describe, it, expect } from "vitest";

import {
  listEnvironmentNames,
  mergeDotenv,
  parseDotenv,
  setDotenvValue,
} from "@/lib/workspace/environment";
import type { FolderNode, RequestNode, TreeNode } from "@/lib/workspace/model";

const request = (
  id: string,
  name: string,
  config: RequestNode["config"],
): RequestNode => ({
  kind: "request",
  id,
  name,
  method: "GET",
  url: "",
  body: "",
  config,
});

const folder = (
  id: string,
  name: string,
  config: FolderNode["config"],
  children: TreeNode[],
): FolderNode => ({ kind: "folder", id, name, config, children });

describe("listEnvironmentNames", () => {
  // AC-002 - behavior: union across the whole tree
  it("should collect every environment name found anywhere in the tree", () => {
    const tree: TreeNode[] = [
      folder(
        "root",
        "Root",
        { environments: { local: { a: "1" }, prod: { a: "2" } } },
        [
          folder("sub", "Sub", { environments: { staging: { b: "3" } } }, [
            request("req", "Req", {}),
          ]),
        ],
      ),
    ];

    const names = listEnvironmentNames(tree);

    expect(names).toContain("local");
    expect(names).toContain("prod");
    expect(names).toContain("staging");
  });

  // AC-002 - behavior: sorted ascending
  it("should return the names sorted ascending", () => {
    const tree: TreeNode[] = [
      folder(
        "root",
        "Root",
        { environments: { prod: {}, local: {}, staging: {} } },
        [],
      ),
    ];

    expect(listEnvironmentNames(tree)).toEqual(["local", "prod", "staging"]);
  });

  // AC-002 - behavior: dedupe the same name found in different scopes
  it("should dedupe a name that appears in more than one scope", () => {
    const tree: TreeNode[] = [
      folder("root", "Root", { environments: { prod: { a: "1" } } }, [
        folder("sub", "Sub", { environments: { prod: { a: "2" } } }, [
          request("req", "Req", { environments: { prod: { a: "3" } } }),
        ]),
      ]),
    ];

    const names = listEnvironmentNames(tree);

    expect(names.filter((name) => name === "prod")).toHaveLength(1);
    expect(names).toEqual(["prod"]);
  });

  // AC-002, edge case §6 - behavior: no environments anywhere -> []
  it("should return an empty array if no scope defines environments", () => {
    const tree: TreeNode[] = [
      folder("root", "Root", { variables: { a: "1" } }, [
        request("req", "Req", {}),
      ]),
    ];

    expect(listEnvironmentNames(tree)).toEqual([]);
  });

  // AC-002 - behavior: empty tree
  it("should return an empty array for an empty tree", () => {
    expect(listEnvironmentNames([])).toEqual([]);
  });

  // AC-002 - behavior: names defined only on a request node are included
  it("should include names defined on a request-level environments block", () => {
    const tree: TreeNode[] = [
      request("req", "Req", { environments: { onlyHere: { a: "1" } } }),
    ];

    expect(listEnvironmentNames(tree)).toEqual(["onlyHere"]);
  });
});

describe("parseDotenv", () => {
  // AC-004 - behavior: basic KEY=value lines
  it("should parse KEY=value lines into a record", () => {
    const out = parseDotenv("TOKEN=abc123\nHOST=localhost");

    expect(out).toEqual({ TOKEN: "abc123", HOST: "localhost" });
  });

  // AC-004, edge case §6 - behavior: ignore comment lines
  it("should ignore # comment lines", () => {
    const out = parseDotenv("# a comment\nTOKEN=abc123\n# another");

    expect(out).toEqual({ TOKEN: "abc123" });
  });

  // AC-004, edge case §6 - behavior: ignore blank lines
  it("should ignore blank lines", () => {
    const out = parseDotenv("\nTOKEN=abc123\n\n\nHOST=local\n");

    expect(out).toEqual({ TOKEN: "abc123", HOST: "local" });
  });

  // AC-004, edge case §6 - behavior: a line with no = is ignored
  it("should ignore a line that has no = sign", () => {
    const out = parseDotenv("NOTANENTRY\nTOKEN=abc123");

    expect(out).toEqual({ TOKEN: "abc123" });
    expect(out).not.toHaveProperty("NOTANENTRY");
  });

  // AC-004, edge case §6 - behavior: value may contain further = signs
  it("should split on the first = and keep later = signs in the value", () => {
    const out = parseDotenv("JWT=a=b=c");

    expect(out.JWT).toBe("a=b=c");
  });

  // AC-004 - behavior: key is trimmed
  it("should trim whitespace around the key", () => {
    const out = parseDotenv("  TOKEN  =abc123");

    expect(out).toHaveProperty("TOKEN", "abc123");
    expect(out).not.toHaveProperty("  TOKEN  ");
  });

  // AC-004 - behavior: value is trimmed
  it("should trim whitespace around the value", () => {
    const out = parseDotenv("TOKEN=   abc123   ");

    expect(out.TOKEN).toBe("abc123");
  });

  // AC-004 - behavior: empty input yields empty record
  it("should return an empty record for empty input", () => {
    expect(parseDotenv("")).toEqual({});
  });
});

describe("setDotenvValue", () => {
  // behavior: updates an existing key in place, preserving other lines
  it("should replace the value of an existing key and keep the rest", () => {
    const out = setDotenvValue("# c\nTOKEN=old\nHOST=local", "TOKEN", "new");

    expect(parseDotenv(out)).toEqual({ TOKEN: "new", HOST: "local" });
    expect(out).toContain("# c");
  });

  // behavior: appends a new key if absent
  it("should append the key if it is not present", () => {
    const out = setDotenvValue("HOST=local", "TOKEN", "abc");

    expect(parseDotenv(out)).toEqual({ HOST: "local", TOKEN: "abc" });
  });

  // behavior: appends to empty content
  it("should create the key from empty content", () => {
    expect(parseDotenv(setDotenvValue("", "TOKEN", "abc"))).toEqual({
      TOKEN: "abc",
    });
  });
});

describe("mergeDotenv", () => {
  // behavior: keys unique to each side are both kept.
  it("should keep keys from both the existing and the incoming env", () => {
    const out = mergeDotenv("HOST=local", "CULTURE=en-CA");

    expect(parseDotenv(out)).toEqual({ HOST: "local", CULTURE: "en-CA" });
  });

  // behavior: an incoming key wins for keys present in both (the imported
  // collection is authoritative for the keys it ships).
  it("should let the incoming value win on a key present in both", () => {
    const out = mergeDotenv("CULTURE=de-DE\nHOST=local", "CULTURE=en-CA");

    expect(parseDotenv(out)).toEqual({ CULTURE: "en-CA", HOST: "local" });
  });

  // behavior: merging into empty existing content yields the incoming env.
  it("should produce the incoming env when existing is empty", () => {
    const out = mergeDotenv("", "A=1\nB=2");

    expect(parseDotenv(out)).toEqual({ A: "1", B: "2" });
  });

  // behavior: an empty incoming env leaves the existing content unchanged.
  it("should leave existing unchanged for an empty incoming env", () => {
    expect(parseDotenv(mergeDotenv("HOST=local", ""))).toEqual({
      HOST: "local",
    });
  });
});
