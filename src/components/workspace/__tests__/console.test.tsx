import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { Console } from "@/components/workspace/console";
import { fixtureTree } from "./fixtures";

describe("Console", () => {
  // AC-012 — behavior
  it("should render each console log line", () => {
    const consoleLines = [
      "[12:00:00] Ready.",
      "[12:00:01] Loaded mock collection.",
      "[12:00:02] No active request.",
    ];

    render(
      <WorkspaceProvider
        tree={fixtureTree}
        consoleLines={consoleLines}
        initialExpandedIds={[]}
      >
        <Console />
      </WorkspaceProvider>,
    );

    // Lines render as token-colored spans (numbers/strings get their own span),
    // so a line is split across nodes - assert via the list items' textContent.
    const region = screen.getByRole("region", { name: /console/i });
    const rendered = within(region)
      .getAllByRole("listitem")
      .map((li) => li.textContent);
    consoleLines.forEach((line) => {
      expect(rendered).toContain(line);
    });
  });
});
