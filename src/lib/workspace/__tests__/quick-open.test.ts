import { describe, it, expect } from "vitest";

import {
  buildQuickOpenEntries,
  filterQuickOpen,
  type QuickOpenEntry,
} from "@/lib/workspace/quick-open";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import type {
  FolderNode,
  HttpMethod,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";

const request = (
  id: string,
  name: string,
  method: HttpMethod,
  url: string,
): RequestNode => ({
  kind: "request",
  id,
  name,
  method,
  url,
  body: emptyBody(),
  params: emptyParams(),
  config: {},
});

const folder = (
  id: string,
  name: string,
  children: TreeNode[],
): FolderNode => ({
  kind: "folder",
  id,
  name,
  config: {},
  children,
});

describe("buildQuickOpenEntries", () => {
  // AC-002, TC-002 — behavior: one entry per folder AND request in tree (DFS)
  // order; requests carry method + url, folders omit both; breadcrumb is the
  // ancestor folder names, "" at the root.
  it("should flatten the tree to entries in DFS order with breadcrumb, method and url", () => {
    const tree: TreeNode[] = [
      folder("F", "F", [request("A", "A", "GET", "/a")]),
      request("B", "B", "POST", "/b"),
    ];

    expect(buildQuickOpenEntries(tree)).toEqual([
      { id: "F", kind: "folder", name: "F", breadcrumb: "" },
      {
        id: "A",
        kind: "request",
        name: "A",
        breadcrumb: "F",
        method: "GET",
        url: "/a",
      },
      {
        id: "B",
        kind: "request",
        name: "B",
        breadcrumb: "",
        method: "POST",
        url: "/b",
      },
    ]);
  });

  // AC-002 — behavior: a folder entry omits method + url.
  it("should omit method and url on a folder entry", () => {
    const entries = buildQuickOpenEntries([
      folder("F", "F", [request("A", "A", "GET", "/a")]),
    ]);
    const folderEntry = entries.find((entry) => entry.kind === "folder")!;

    expect(folderEntry.method).toBeUndefined();
    expect(folderEntry.url).toBeUndefined();
  });

  // AC-002 — behavior: nested folders join into a " / " breadcrumb for the leaf.
  it("should join ancestor folder names with ' / ' for a deeply nested request", () => {
    const tree: TreeNode[] = [
      folder("F", "F", [folder("G", "G", [request("R", "R", "GET", "/r")])]),
    ];

    const requestEntry = buildQuickOpenEntries(tree).find(
      (entry) => entry.id === "R",
    )!;

    expect(requestEntry.breadcrumb).toBe("F / G");
  });

  // Edge case — behavior: an empty tree yields no entries.
  it("should return an empty list if the tree is empty", () => {
    expect(buildQuickOpenEntries([])).toEqual([]);
  });
});

describe("filterQuickOpen", () => {
  const sample: QuickOpenEntry[] = [
    {
      id: "bear",
      kind: "request",
      name: "bear",
      breadcrumb: "",
      method: "GET",
      url: "https://api.test/zzz",
    },
    {
      id: "zebra",
      kind: "request",
      name: "zebra",
      breadcrumb: "",
      method: "GET",
      url: "https://api.test/animals",
    },
    {
      id: "cat",
      kind: "request",
      name: "cat",
      breadcrumb: "",
      method: "GET",
      url: "https://api.test/dog",
    },
  ];

  // AC-003, TC-003 — behavior: an empty query returns every entry unchanged, in
  // tree order.
  it("should return all entries in order if the query is empty", () => {
    const entries = buildQuickOpenEntries([
      folder("F", "F", [request("A", "A", "GET", "/a")]),
      request("B", "B", "POST", "/b"),
    ]);

    expect(filterQuickOpen(entries, "")).toEqual(entries);
  });

  // AC-004, TC-004 — behavior: non-matches are dropped.
  it("should drop entries that match the query in no field", () => {
    const result = filterQuickOpen(sample, "z");

    expect(result.map((entry) => entry.id)).not.toContain("cat");
  });

  // AC-004, TC-004 — behavior: a name hit ranks above a url-only hit regardless
  // of the input order.
  it("should rank a name match above a url-only match", () => {
    const result = filterQuickOpen(sample, "z");

    // "zebra" matches by name; "bear" matches only via its /zzz url.
    expect(result.map((entry) => entry.id)).toEqual(["zebra", "bear"]);
  });

  // AC-004, TC-004 — behavior: a query matching nothing returns [].
  it("should return an empty list if the query matches nothing", () => {
    expect(filterQuickOpen(sample, "zzzz")).toEqual([]);
  });
});
