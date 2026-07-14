import type { HttpMethod, TreeNode } from "@/lib/workspace/model";

// A flat, searchable view of one tree node for the quick-open dialog. Requests
// carry method + url (folders omit both); `breadcrumb` is the ancestor folder
// names joined " / " ("" at the root), used both to disambiguate duplicate names
// and as a match field.
export type QuickOpenEntry = {
  id: string;
  kind: "request" | "folder";
  name: string;
  breadcrumb: string;
  method?: HttpMethod;
  url?: string;
};

// Weight per matched field so a name hit outranks a breadcrumb-only hit, which
// outranks a url-only hit. Highest single-field score wins the entry's rank.
const NAME_WEIGHT = 3;
const BREADCRUMB_WEIGHT = 2;
const URL_WEIGHT = 1;

export function buildQuickOpenEntries(tree: TreeNode[]): QuickOpenEntry[] {
  const walk = (nodes: TreeNode[], breadcrumb: string): QuickOpenEntry[] =>
    nodes.flatMap((node) => {
      if (node.kind === "request") {
        return [
          {
            id: node.id,
            kind: "request",
            name: node.name,
            breadcrumb,
            method: node.method,
            url: node.url,
          },
        ];
      }
      const childBreadcrumb =
        breadcrumb === "" ? node.name : `${breadcrumb} / ${node.name}`;
      return [
        { id: node.id, kind: "folder", name: node.name, breadcrumb },
        ...walk(node.children, childBreadcrumb),
      ];
    });
  return walk(tree, "");
}

// Case-insensitive subsequence test: every query char appears in `haystack` in
// order (VSCode-style fuzzy). An empty query matches everything.
function isSubsequence(query: string, haystack: string): boolean {
  const target = haystack.toLowerCase();
  let cursor = 0;
  for (const char of query.toLowerCase()) {
    cursor = target.indexOf(char, cursor);
    if (cursor === -1) {
      return false;
    }
    cursor += 1;
  }
  return true;
}

// The rank for a query over a node's searchable fields: the highest field
// weight it fuzzy-matches on, 0 when no field matches. Shared by `filterQuickOpen`
// (the pure list filter) and the dialog's cmdk `filter` prop, so ranking stays
// identical in both.
export function scoreQuickOpen(
  query: string,
  fields: { name: string; breadcrumb: string; url?: string },
): number {
  const matches: Array<[string, number]> = [
    [fields.name, NAME_WEIGHT],
    [fields.breadcrumb, BREADCRUMB_WEIGHT],
    [fields.url ?? "", URL_WEIGHT],
  ];
  return matches.reduce(
    (best, [field, weight]) =>
      field !== "" && isSubsequence(query, field)
        ? Math.max(best, weight)
        : best,
    0,
  );
}

export function filterQuickOpen(
  entries: QuickOpenEntry[],
  query: string,
): QuickOpenEntry[] {
  if (query === "") {
    return entries;
  }
  return entries
    .map((entry, index) => ({
      entry,
      index,
      score: scoreQuickOpen(query, entry),
    }))
    .filter((scored) => scored.score > 0)
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .map((scored) => scored.entry);
}
