import type { KeyValue } from "@/lib/workspace/model";

// Bidirectional mirror between the URL bar's `?query` string and the request's
// `config.params` (the Query grid). The grid is the store; the URL `?` reflects the
// ENABLED rows. Values (incl. `{{var}}` tokens) are kept raw - never percent-encoded
// here - so the round-trip is lossless and tokens stay editable.

// Split a URL into its base (everything before `?`), raw query, and `#fragment`.
// The query ends at the first `#`, so a fragment is never folded into a query value
// and survives a query rewrite.
function splitUrl(url: string): {
  base: string;
  query: string;
  fragment: string;
} {
  const hashIndex = url.indexOf("#");
  const fragment = hashIndex === -1 ? "" : url.slice(hashIndex);
  const beforeHash = hashIndex === -1 ? url : url.slice(0, hashIndex);
  const qIndex = beforeHash.indexOf("?");
  if (qIndex === -1) {
    return { base: beforeHash, query: "", fragment };
  }
  return {
    base: beforeHash.slice(0, qIndex),
    query: beforeHash.slice(qIndex + 1),
    fragment,
  };
}

// Ordered raw key/value pairs from a URL's `?query`. A bare key (`?flag`) has an
// empty value. No decoding - `{{var}}` and friends survive verbatim.
export function parseUrlQuery(url: string): KeyValue[] {
  const { query } = splitUrl(url);
  if (query === "") {
    return [];
  }
  return query
    .split("&")
    .filter((pair) => pair !== "")
    .map((pair) => {
      const eq = pair.indexOf("=");
      const key = eq === -1 ? pair : pair.slice(0, eq);
      const value = eq === -1 ? "" : pair.slice(eq + 1);
      return { key, value };
    });
}

// Apply a URL edit to the grid rows. Keys now in the URL become enabled rows with
// the URL's value (added if new, re-enabled + value-synced if they existed). A row
// whose key LEFT the URL is disabled (value kept) IF it carries a value - but if its
// value is empty it is dropped instead, so typing a key into the URL char-by-char
// (`?q` -> `?qw` -> `?qwe`) doesn't litter the grid with empty partial-key rows. Rows
// whose key was never in the old or new URL (manual / folder-mirror-free) are left
// untouched.
export function syncParamsFromUrl(
  prevUrl: string,
  nextUrl: string,
  rows: KeyValue[],
): KeyValue[] {
  const prevKeys = new Set(parseUrlQuery(prevUrl).map((p) => p.key));
  const nextPairs = parseUrlQuery(nextUrl);
  const nextByKey = new Map(nextPairs.map((p) => [p.key, p.value]));

  const updated = rows.flatMap<KeyValue>((row) => {
    if (nextByKey.has(row.key)) {
      return [{ ...row, value: nextByKey.get(row.key) ?? "", enabled: true }];
    }
    if (prevKeys.has(row.key) && row.enabled !== false) {
      return row.value === "" ? [] : [{ ...row, enabled: false }];
    }
    return [row];
  });

  const known = new Set(rows.map((row) => row.key));
  const appended = nextPairs
    .filter((pair) => !known.has(pair.key))
    .map((pair) => ({ key: pair.key, value: pair.value, enabled: true }));

  return [...updated, ...appended];
}

// Rewrite a URL's `?query` from the grid rows: enabled, non-blank-key rows in order;
// disabled/blank rows dropped. The base (path + `:pathParams`) is preserved; an empty
// result strips the `?` entirely.
export function syncUrlFromParams(url: string, rows: KeyValue[]): string {
  const { base, fragment } = splitUrl(url);
  const query = rows
    .filter((row) => row.enabled !== false && row.key !== "")
    .map((row) => `${row.key}=${row.value}`)
    .join("&");
  return query === "" ? `${base}${fragment}` : `${base}?${query}${fragment}`;
}
