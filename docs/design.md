# Design

UI design rules for this app. Entries are about *visual language and interaction*, not domain logic. Read this before any UI change.

## Corners

- **No rounded corners. Anywhere.** Sharp edges only. The radius token is pinned to zero (`--radius: 0rem` and every `--radius-{sm,md,lg,xl}: 0rem`) - never raise it.
- Do not use `rounded-*` utilities (`rounded`, `rounded-sm/md/lg/full/xs`, ...). If a UI primitive (e.g. shadcn) ships with a `rounded-*` class, strip it.
- Treat any rounded corner as a defect.

## Borders & dividers

- **Dividers are 1px. Never thicken, brighten, or colour on hover or drag.** A resize handle (sidebar split, console split, editor/results split) is a `w-px`/`h-px` line in `bg-border`.
- Give a thin divider a larger **invisible** hit area instead of a visible thick bar: an `::after` overlay (`after:absolute after:inset-y-0 after:left-1/2 after:w-2 after:-translate-x-1/2` for a vertical handle) catches the pointer while the visible line stays 1px.
- Cursor signals affordance (`cursor-col-resize` / `cursor-row-resize`), not thickness.
- Borders use the `border`/`border-border` token, 1px. Don't introduce heavier borders for emphasis - use background/spacing instead.

## Scrollbars

- **One scrollbar treatment everywhere: thin, square, semi-transparent, macOS-style.** Never the raw OS bar.
- Prefer the shared `ScrollArea` (`src/components/ui/scroll-area.tsx`) for any scrollable region - it overlays (no layout gutter) and auto-hides (`type="hover"`), the macOS feel. Thin track (`w-1.5`/`h-1.5`), `bg-foreground/20` thumb (hover `/30`).
- Surfaces that own their own scroller and can't host a `ScrollArea` (CodeMirror `.cm-scroller`, the Radix Select / cmdk Command popovers) fall back to the global `::-webkit-scrollbar` + `scrollbar-*` rule in `index.css`, tuned to match (8px, transparent track, `--foreground`-derived thumb).
- **The thumb is square - no rounding** (the Corners rule wins over the macOS pill). "macOS-style" is delivered via thin + semi-transparent + overlay + auto-hide, not radius.
- The content-header tab strip is the one region left on the native/global bar (a `ScrollArea` would break its `@dnd-kit` drag math).

## Tables / grids

- One grid component, reused everywhere a result set is shown. All grids look identical: same row height, padding, header treatment, single-line cells (`overflow-hidden text-ellipsis whitespace-nowrap`), resizable columns.
- Headers always render, even for an empty result, so the column structure stays visible; show an empty-state message ("No rows.") beneath the header row, not instead of it.
- NULL renders as a dim `[NULL]`, visually distinct from an empty string.
- Edited/dirty cells get a subtle highlight (`bg-amber-500/15`), applied identically in every view (list and single-record).

## Adding & removing items

- **Adding a NAMED item is a `+` button that opens a modal** - never an always-visible inline name field + separate "Add" button sitting in a bar. The trigger is a single icon button (`<Plus className="size-4" />`, `aria-label="Add <thing>"`); the modal (reuse the `Dialog` primitive, mirror `curl-import-dialog.tsx`) holds the name field (`autoFocus`, Enter submits) + an **Add** / **Cancel** footer (Add disabled while the name is empty or a duplicate). This is the convention for every "create a named X" affordance (environments, and any future named collection). The key->value grid's own trailing blank row is the exception - that's row-entry, not a named item, and stays inline.
- **Removing an item is a `Trash2` icon button** (`aria-label="Delete <thing> <name>"`), shown only when the item is actually deletable in the current scope. In a bar it sits flush like any other bar control (`h-full border-0 border-r border-r-border`); in a grid row it's the trailing delete cell. A destructive multi-child delete (e.g. a non-empty folder) confirms via a dialog first; a single leaf deletes immediately.

## Density & typography

- Compact, keyboard-first, IDE-like. Rows and controls are single-line and tight (`py-1`/`py-1.5`, `text-xs`/`text-sm`).
- Monospace (`font-mono`) for data, SQL, identifiers, and anything tabular. UI chrome (labels, buttons, tabs) uses the default sans stack.
- Muted foreground (`text-muted-foreground`) for secondary text (column headers, hints, timestamps); full foreground for primary content.

## Color & status

- Theme via CSS tokens (`bg-background`, `bg-muted/30`, `text-foreground`, `border-border`), not hard-coded colors, so light/dark both work. The theme is **user-selectable** (light / dark / system) and **per-mode customizable** (Settings -> Theme): mode lives in `settings.json`, custom token overrides in `theme.json`, applied as inline CSS vars on `<html>` over the `:root`/`.dark` defaults in `index.css`. The `.dark` class is live (was dead before themes shipped). Always use the tokens, never hard-coded hex - that's what lets a user's custom colors and the mode switch take effect. CodeMirror editors theme via the `useEditorExtensions` hook (color-driven factories in `editor-theme.ts`), not hardcoded hex.
- Status colors: success green (`text-green-600 dark:text-green-400`), error/destructive red (`text-red-600 dark:text-red-400`). A destructive action button (e.g. Disconnect) is filled red.
- Status dots are a small `size-2` filled circle, right-aligned, never with a text label leaking into an accessible name (give the row an explicit `aria-label`).

## Layout

- Resizable splits at the shell level (sidebar|content, content|console). Inside a tab panel, a split must be hand-rolled (the `react-resizable-panels` group breaks tab-switching) but still obey the 1px-divider rule.
- Tabs are flat, square, separated by 1px borders; the active tab reads via `bg-background` + full foreground, inactive via muted foreground.
- Buttons in a thin bar (toolbar / editor header / URL bar) **fill the bar's full height** (`h-full`, square, no margin), divided from siblings by a 1px border (`border-l`/`border-r`), not floating chips with their own height/padding. The bar height is the button height.
- All bar buttons share one size: the `Button` default (`text-sm`, `px-4`) - do NOT shrink some to `text-xs` or re-pad them. Add only `h-full rounded-none border-0 border-l` (+ optional `border-l-border`); keep everything else from the default so Send/Save/Close read identically across every bar.
- **NO SPACING INSIDE A BAR. EVER.** A bar (tab strip, sub-bar, toolbar, picker row - any horizontal control strip) has **zero gap and zero outer padding**. Controls sit flush, each one `h-full` (or `h-full!` to beat a primitive's fixed height) and separated ONLY by a 1px border (`border-r border-r-border`). Forbidden in a bar: `gap-*`, `p-*`/`px-*`/`py-*` on the bar container, `h-8`/`h-9`-style fixed control heights, and standalone bordered "chip" controls. The canonical bar container is `flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30` (mirror the existing section/script/auth sub-bars in `config-panels.tsx`/`folder-pane.tsx`); a control inside it is `h-full ... border-0 border-r border-r-border bg-transparent`. If a new bar control reads as a floating box with air around it, it is a defect - rebuild it flush.

## Accessibility

- Interactive affordances that are purely visual (resize handles, status dots) are `aria-hidden` or carry an explicit non-leaking label so they don't pollute the accessible name of their container (treeitem, columnheader).
- Inputs opt out of browser autofill noise: `autoComplete="off"`, `autoCorrect="off"`, `autoCapitalize="off"`, `spellCheck={false}`, plus `data-1p-ignore` / `data-lpignore` for password managers.
