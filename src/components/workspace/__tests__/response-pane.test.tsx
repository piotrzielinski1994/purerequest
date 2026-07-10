import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ResponsePane } from "@/components/workspace/response-pane";
import { formatDuration } from "@/lib/http/format";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { fixtureTree, tokenRequest } from "./fixtures";

describe("ResponsePane", () => {
  // AC-010 — behavior
  it("should show the response status and time", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <ResponsePane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /response sections/i });
    expect(
      within(tablist).getByRole("tab", { name: "Response" }),
    ).toBeInTheDocument();
    expect(
      within(tablist).getByRole("tab", { name: "Headers" }),
    ).toBeInTheDocument();

    expect(screen.getByText("200")).toBeInTheDocument();
    expect(screen.getByText(/142\s*ms/)).toBeInTheDocument();

    // Response panel visible by default: shows the response body.
    expect(screen.getByText(/access_token/)).toBeInTheDocument();
  });

  // AC-010 — behavior
  it("should show response headers after clicking the Headers tab", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <ResponsePane />
      </WorkspaceProvider>,
    );

    const tablist = screen.getByRole("tablist", { name: /response sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Headers" }));

    expect(screen.getByText("X-Response-Header")).toBeInTheDocument();
    expect(screen.getByText("resp-value")).toBeInTheDocument();
  });
});

type ResponseTimingsShape = {
  dnsMs: number;
  connectMs: number;
  waitingMs: number;
  downloadMs: number;
};

// Build a single-request tree whose active request carries the given response
// (optionally with timings) so the idle fallback renders it into the pane.
function timingTree(
  timeMs: number,
  timings?: ResponseTimingsShape,
): TreeNode[] {
  const request: RequestNode = {
    ...tokenRequest,
    id: "req-timing",
    name: "timing",
    response: {
      status: 200,
      timeMs,
      sizeBytes: 36,
      body: '{ "ok": true }',
      headers: [{ key: "Content-Type", value: "application/json" }],
      ...(timings ? { timings } : {}),
    } as RequestNode["response"],
  };
  return [request];
}

function renderTiming(timeMs: number, timings?: ResponseTimingsShape) {
  return render(
    <WorkspaceProvider
      tree={timingTree(timeMs, timings)}
      initialActiveRequestId="req-timing"
    >
      <ResponsePane />
    </WorkspaceProvider>,
  );
}

async function openTimingTab(user: ReturnType<typeof userEvent.setup>) {
  const tablist = screen.getByRole("tablist", { name: /response sections/i });
  await user.click(within(tablist).getByRole("tab", { name: /timing/i }));
  return screen.getByRole("tabpanel");
}

// Walk up from a phase label until an ancestor holds a descendant with an inline
// percentage width - the proportional bar fill - and return that width as a number.
function barWidthPercent(panel: HTMLElement, label: string): number {
  const labelEl = within(panel).getByText(label);
  let node: HTMLElement | null = labelEl.parentElement;
  while (node) {
    const fill = Array.from(
      node.querySelectorAll<HTMLElement>("*"),
    ).find((element) => /%$/.test(element.style.width.trim()));
    if (fill) {
      return Number.parseFloat(fill.style.width);
    }
    node = node.parentElement;
  }
  throw new Error(`no bar width found for ${label}`);
}

describe("ResponsePane - Timing tab", () => {
  // TC-005, AC-008 - behavior: the Timing tab renders a labelled ms row per phase
  // plus a Total row equal to timeMs.
  it("should render a per-phase row and a Total equal to timeMs if timings are present", async () => {
    const user = userEvent.setup();
    renderTiming(142, {
      dnsMs: 12,
      connectMs: 34,
      waitingMs: 88,
      downloadMs: 8,
    });

    const tablist = screen.getByRole("tablist", { name: /response sections/i });
    expect(
      within(tablist).getByRole("tab", { name: /timing/i }),
    ).toBeInTheDocument();

    const panel = await openTimingTab(user);

    expect(within(panel).getByText("DNS")).toBeInTheDocument();
    expect(within(panel).getByText("Connect")).toBeInTheDocument();
    expect(within(panel).getByText("Waiting")).toBeInTheDocument();
    expect(within(panel).getByText("Download")).toBeInTheDocument();

    expect(within(panel).getByText("12ms")).toBeInTheDocument();
    expect(within(panel).getByText("34ms")).toBeInTheDocument();
    expect(within(panel).getByText("88ms")).toBeInTheDocument();
    expect(within(panel).getByText("8ms")).toBeInTheDocument();

    expect(within(panel).getByText(/total/i)).toBeInTheDocument();
    expect(within(panel).getByText(formatDuration(142))).toBeInTheDocument();
  });

  // TC-006, AC-009/011 - behavior: a dominant phase renders a wider bar than a
  // smaller phase, and a zero-ms phase still renders its labelled row.
  it("should render a wider bar for a dominant phase and still show a zero-ms row", async () => {
    const user = userEvent.setup();
    renderTiming(915, {
      dnsMs: 5,
      connectMs: 10,
      waitingMs: 900,
      downloadMs: 0,
    });

    const panel = await openTimingTab(user);

    expect(within(panel).getByText("Download")).toBeInTheDocument();
    expect(within(panel).getByText("0ms")).toBeInTheDocument();

    expect(barWidthPercent(panel, "Waiting")).toBeGreaterThan(
      barWidthPercent(panel, "Connect"),
    );
  });

  // TC-007, AC-010 - behavior: with no timings the tab shows the empty state and
  // never renders NaN.
  it("should show the empty state and no NaN if timings are absent", async () => {
    const user = userEvent.setup();
    renderTiming(142);

    const panel = await openTimingTab(user);

    expect(
      within(panel).getByText(/no timing data for this response\./i),
    ).toBeInTheDocument();
    expect(within(panel).queryByText(/NaN/)).toBeNull();
  });
});
