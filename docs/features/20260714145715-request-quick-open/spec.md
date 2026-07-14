# Request quick-open

Branch: `20260714145715-request-quick-open`

## Overview

A VSCode `Cmd+P`-style **quick-open** dialog for jumping to a request (or folder)
anywhere in the collection tree by fuzzy-typing its name. Today the only way to reach a
deeply-nested request is to expand the sidebar tree by hand or scroll the tab bar. This adds
a dedicated overlay (separate from the `Mod+K` command palette) bound to **`Mod+P`** that
lists every request and folder, fuzzy-filters as you type across **name + folder breadcrumb +
URL**, and on select **opens the request** (and reveals it in the tree) or **reveals a folder**
in the tree.

It mirrors the existing command-palette plumbing (`cmdk` `CommandDialog`, a registry action, a
`main.tsx` handler) but is a distinct dialog with its own entry list and its own selection
behavior - selecting an entry does not "run an action", it navigates to a node.

## Approach

Three pure pieces + one dumb component + wiring, matching the repo's "pure fn + dumb view"
style:

1. `src/lib/workspace/quick-open.ts` - `buildQuickOpenEntries(tree)` flattens the tree to a
   flat entry list (id, kind, name, method?, breadcrumb, url?); `filterQuickOpen(entries, query)`
   fuzzy-filters + ranks them (empty query = all, in tree order).
2. `src/lib/workspace/tree-locate.ts` - add `ancestorIds(nodes, id)` (the folder-id chain from
   root down to the node's parent) so reveal can expand exactly the folders needed.
3. `RequestQuickOpen` dialog - a `CommandDialog` with `shouldFilter={false}` (we own the
   filter), a controlled input, method badge + name + muted breadcrumb per row.
4. `revealNode(id)` on the workspace context - expands ancestor folders, single-selects the
   node, opens+activates the tab for a request (folders have no tab), and asks the sidebar to
   scroll the row into view (a consume-once nonce seam, like `pendingPanelFocus`).
5. Registry action `open-quick-open` (`Mod+P`) + `main.tsx` state/handler + render.

Fuzzy matching is a small in-repo scorer (subsequence match, weighted name > breadcrumb > url),
not `cmdk`'s built-in filter - so `value` can stay the unique node id (no same-name collision)
and the matched fields are exactly the three we want. Selecting reuses existing context setters;
no new persistence.

## Acceptance criteria

- **AC-001**: A registry action `open-quick-open` exists with default hotkey `Mod+P`, a
  non-empty name and description; `resolveShortcuts({})` exposes it as `["Mod+P"]`;
  `findConflict("Mod+P", other, effective)` reports `open-quick-open` as the owner.
- **AC-002**: `buildQuickOpenEntries(tree)` returns one entry per request AND per folder in
  visible DFS (tree) order, each with `kind`, `name`, `breadcrumb` (ancestor folder names
  joined `" / "`, empty at root), plus `method` + `url` for requests (folders omit both).
- **AC-003**: `filterQuickOpen(entries, "")` returns all entries unchanged (tree order).
- **AC-004**: `filterQuickOpen(entries, query)` returns only entries that fuzzy-match the query
  in name, breadcrumb, or URL, ranked so a name match outranks a breadcrumb-only match, which
  outranks a URL-only match; a query matching nothing returns `[]`.
- **AC-005**: The quick-open dialog renders a row per supplied entry showing the request's
  method + name (folders show name only), filters rows live as the user types, and shows a
  "No matching requests" empty state when the filter yields nothing.
- **AC-006**: Selecting a **request** entry (Enter on the highlighted row, or click) calls
  `onSelect(id)` and closes the dialog; wired through, this opens+activates the request tab.
- **AC-007**: Selecting a **folder** entry calls `onSelect(id)` and closes the dialog; wired
  through, this reveals the folder in the tree AND opens its config edit card (the same
  surface as the sidebar right-click → Edit), so quick-open lands on something editable.
- **AC-008**: `revealNode(id)` adds every ancestor folder id of the node to
  `expandedFolderIds` and single-selects the node; for a request it also opens+activates its
  tab; for a folder it also expands the folder itself. `ancestorIds(nodes, id)` returns the
  root→parent folder-id chain (`[]` for a root node, `null`-safe for an unknown id → `[]`).
- **AC-009**: Pressing `Mod+P` in the app opens the quick-open dialog; `Escape` closes it;
  the dialog is distinct from the `Mod+K` command palette.

## Test cases

- **TC-001** (AC-001): registry has `open-quick-open` with `defaultHotkey === "Mod+P"`,
  non-empty name/description; `resolveShortcuts({})["open-quick-open"] === ["Mod+P"]`;
  `findConflict("Mod+P", "toggle-console", resolveShortcuts({}))` → `"open-quick-open"`.
- **TC-002** (AC-002): a tree `[folder F [req A (GET /a)], req B (POST /b)]` →
  entries `[F(folder,""), A(request,"F",GET,/a), B(request,"",POST,/b)]` in that order.
- **TC-003** (AC-003): `filterQuickOpen(entries, "")` deep-equals `entries`.
- **TC-004** (AC-004): with entries whose names/urls differ, `filterQuickOpen(entries, "a")`
  drops non-matches; a query hitting only a URL still returns that entry but ranked below a
  name hit; `filterQuickOpen(entries, "zzzz")` → `[]`.
- **TC-005** (AC-005): render `RequestQuickOpen` with 3 entries → 3 rows visible; type a
  query matching one → only that row; type `"zzzz"` → "No matching requests".
- **TC-006** (AC-006/007): Enter on the highlighted row (and a click on a row) call
  `onSelect` with that entry's id and call `onOpenChange(false)`.
- **TC-007** (AC-008): `ancestorIds([F [G [req R]]], "R") === ["F","G"]`; `ancestorIds(tree,
  "F") === []`; `ancestorIds(tree, "nope") === []`. `revealNode("R")` (request) →
  `expandedFolderIds ⊇ {F,G}`, R selected, R open + active. `revealNode("F")` (folder) →
  F selected + expanded, no tab opened.
- **TC-008** (AC-009): in the app shell, `Mod+P` opens a dialog with the quick-open input;
  `Escape` closes it; `Mod+K` still opens the command palette (unchanged).

## UI States

| State   | Behavior                                                                 |
| ------- | ------------------------------------------------------------------------ |
| Loading | N/A - entries are built synchronously from the in-memory tree.           |
| Empty   | Tree has no nodes → dialog opens with only the "No matching requests" empty state. |
| Error   | N/A - no async/IO in the dialog.                                         |
| Success | Fuzzy-filtered list; method badge + name + muted breadcrumb per row.     |

### ASCII wireframe

```
+------------------------------------------------------------+
| (search)  Search requests…                                 |
+------------------------------------------------------------+
| GET   Get the dealers            car-media-2-0-api         |
| POST  Create listing             car-media-2-0-api / write |
|       write                      car-media-2-0-api         |  <- folder row (no method)
| GET   /widgets                   Bruno import              |
+------------------------------------------------------------+
```

(method badge left, colored per `METHOD_COLOR`; folder rows show no badge; breadcrumb
muted, right-aligned. When the filter matches nothing the body is a single centered
"No matching requests" line.)

## Data model

No on-disk change. New in-memory types only:

```ts
type QuickOpenEntry = {
  id: string;
  kind: "request" | "folder";
  name: string;
  breadcrumb: string;          // ancestor folder names joined " / "; "" at root
  method?: HttpMethod;         // requests only
  url?: string;                // requests only
};
```

## Edge cases

- **Empty tree** → `buildQuickOpenEntries([]) === []`; dialog shows the empty state.
- **Root-level node** → `breadcrumb === ""`; row shows name only (no breadcrumb text).
- **Duplicate request names** → disambiguated by breadcrumb in the row; `value` is the unique
  node id, so selection targets the right node.
- **Draft (unsaved "new request") tabs** → not tree nodes, so **not listed** (they are already
  open). Out of scope.
- **Settings tab** → not a tree node → not listed.
- **Unknown id passed to `revealNode`/`ancestorIds`** → no-op / `[]` (never throws).
- **Folder select opens its edit card** → the config editor (`editTarget`), not a request
  tab; a request select opens its request tab. `revealNode` handles the tree reveal for both.
- **Reveal when sidebar hidden** → the tree is unmounted, so the scroll-into-view seam is a
  harmless no-op; the selection/expansion still apply and show once the sidebar is toggled back.
  (No auto-unhide - YAGNI.)

## Dependencies

- Existing: `cmdk` (`^1.1.1`) `CommandDialog` primitives, `@tanstack/hotkeys` for hotkey
  formatting/binding, the shortcuts registry/resolve, the workspace context selection seam,
  `METHOD_COLOR`.
- No new packages.
```