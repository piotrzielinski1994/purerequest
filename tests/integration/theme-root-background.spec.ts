import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

// Regression: the app chrome relies on a themed background LAYER. The panes are
// transparent down to the app root, and the index.html inline guard paints the
// document `#000` (anti-white-flash). That guard is UNLAYERED, so it out-ranks
// the `@layer base` `body { background: var(--background) }` rule in Tailwind v4
// (layered < unlayered) - which left LIGHT mode showing the black guard through
// every pane. The fix: the mount node itself carries the `bg-background` /
// `text-foreground` utilities so the theme var is painted per-mode above the guard.
describe("index.html app-root background", () => {
  const html = readFileSync(resolve(process.cwd(), "index.html"), "utf8");
  const rootTag = html.match(/<div id="root"[^>]*>/)?.[0] ?? "";

  it("should give the mount node the themed background utility so light mode is not painted by the black flash-guard", () => {
    expect(rootTag).toContain("bg-background");
  });

  it("should give the mount node the themed foreground utility", () => {
    expect(rootTag).toContain("text-foreground");
  });
});
