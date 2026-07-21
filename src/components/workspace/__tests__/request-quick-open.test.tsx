import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { RequestQuickOpen } from "@/components/workspace/request-quick-open";
import type { QuickOpenEntry } from "@/lib/workspace/quick-open";

const entries: QuickOpenEntry[] = [
  {
    id: "req-alpha",
    kind: "request",
    name: "alpha",
    breadcrumb: "Auth",
    method: "GET",
    url: "https://api.test/alpha",
  },
  {
    id: "req-bravo",
    kind: "request",
    name: "bravo",
    breadcrumb: "",
    method: "POST",
    url: "https://api.test/bravo",
  },
  {
    id: "folder-charlie",
    kind: "folder",
    name: "charlie",
    breadcrumb: "",
  },
];

describe("RequestQuickOpen", () => {
  // AC-005, TC-005 — behavior: one row per supplied entry.
  it("should render a row per supplied entry", async () => {
    render(
      <RequestQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={vi.fn()}
      />,
    );

    for (const entry of entries) {
      expect(await screen.findByText(entry.name)).toBeInTheDocument();
    }
  });

  // AC-005, TC-005 — behavior: live filtering narrows to the matching row.
  it("should filter rows to the match if a query is typed", async () => {
    const user = userEvent.setup();
    render(
      <RequestQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText("alpha");

    await user.type(screen.getByRole("combobox"), "alpha");

    await waitFor(() => {
      expect(screen.queryByText("bravo")).not.toBeInTheDocument();
    });
    expect(screen.getByText("alpha")).toBeInTheDocument();
    expect(screen.queryByText("charlie")).not.toBeInTheDocument();
  });

  // AC-005, TC-005 — behavior: an empty result shows the empty-state message.
  it("should show the empty state if the query matches nothing", async () => {
    const user = userEvent.setup();
    render(
      <RequestQuickOpen
        open
        onOpenChange={vi.fn()}
        entries={entries}
        onSelect={vi.fn()}
      />,
    );
    await screen.findByText("alpha");

    await user.type(screen.getByRole("combobox"), "zzzz");

    expect(
      await screen.findByText(/no matching requests/i),
    ).toBeInTheDocument();
    expect(screen.queryByText("alpha")).not.toBeInTheDocument();
  });

  // AC-006, TC-006 — side-effect-contract: Enter on the highlighted row selects
  // its id and closes the dialog.
  it("should select the highlighted entry's id and close if Enter is pressed", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RequestQuickOpen
        open
        onOpenChange={onOpenChange}
        entries={entries}
        onSelect={onSelect}
      />,
    );
    await screen.findByText("alpha");

    // Narrow to a single row so it is the highlighted one, then run it.
    await user.type(screen.getByRole("combobox"), "alpha");
    await screen.findByText("alpha");
    await user.keyboard("{Enter}");

    expect(onSelect).toHaveBeenCalledWith("req-alpha");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  // AC-006/AC-007, TC-006 — side-effect-contract: clicking a row selects its id
  // and closes the dialog.
  it("should select the clicked entry's id and close if a row is clicked", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <RequestQuickOpen
        open
        onOpenChange={onOpenChange}
        entries={entries}
        onSelect={onSelect}
      />,
    );

    await user.click(await screen.findByText("bravo"));

    expect(onSelect).toHaveBeenCalledWith("req-bravo");
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
