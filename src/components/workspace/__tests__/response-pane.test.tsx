import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResponsePane } from "@/components/workspace/response-pane";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
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
    const fill = Array.from(node.querySelectorAll<HTMLElement>("*")).find(
      (element) => /%$/.test(element.style.width.trim()),
    );
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

type DissectionShape = NonNullable<RequestNode["response"]>["dissection"];

function dissectionTree(dissection?: DissectionShape): TreeNode[] {
  const request: RequestNode = {
    ...tokenRequest,
    id: "req-protocols",
    name: "protocols",
    response: {
      status: 200,
      timeMs: 142,
      sizeBytes: 36,
      body: '{ "ok": true }',
      headers: [{ key: "Content-Type", value: "application/json" }],
      ...(dissection ? { dissection } : {}),
    } as RequestNode["response"],
  };
  return [request];
}

async function openProtocolsTab(user: ReturnType<typeof userEvent.setup>) {
  const tablist = screen.getByRole("tablist", { name: /response sections/i });
  await user.click(within(tablist).getByRole("tab", { name: /protocols/i }));
  return screen.getByRole("tabpanel");
}

// Every layer + segment renders collapsed by default; expanding a layer reveals its nested segment
// headers, so a second pass is needed to open those too.
async function expandAll(
  user: ReturnType<typeof userEvent.setup>,
  panel: HTMLElement,
) {
  for (let pass = 0; pass < 3; pass += 1) {
    const collapsed = within(panel).queryAllByRole("button", {
      expanded: false,
    });
    if (collapsed.length === 0) {
      break;
    }
    for (const button of collapsed) {
      await user.click(button);
    }
  }
}

function renderProtocols(dissection?: DissectionShape) {
  return render(
    <WorkspaceProvider
      tree={dissectionTree(dissection)}
      initialActiveRequestId="req-protocols"
    >
      <ResponsePane />
    </WorkspaceProvider>,
  );
}

const h2FrameDissection: DissectionShape = {
  layers: [
    {
      osi: 3,
      name: "Network (IP)",
      summary: "IP addresses (header bytes need packet capture)",
      reach: "facts",
      fields: [
        {
          label: "Remote address",
          value: "93.184.216.34",
          meaning: "The server's IP address, resolved from the host name.",
        },
      ],
      segments: [],
    },
    {
      osi: 7,
      name: "Application (HTTP/2)",
      summary: "1 message(s) decoded",
      reach: "decoded",
      fields: [
        {
          label: "Framing",
          value: "Binary frames",
          meaning: "Length-prefixed binary frames.",
        },
      ],
      segments: [
        {
          title: "HTTP/2 frame (sent): HEADERS, stream 1",
          hex: "00 00 00 01 05 00 00 00 01",
          byteLen: 9,
          truncated: false,
          fields: [
            {
              label: "Type",
              value: "HEADERS (1)",
              meaning: "HEADERS carries the compressed header block.",
              byteOffset: 3,
              byteLength: 1,
            },
            {
              label: "Flags",
              value: "0x05  00000101",
              meaning: "Per-type boolean flags.",
              byteOffset: 4,
              byteLength: 1,
              children: [
                {
                  label: "END_STREAM",
                  value: "1 (set)",
                  meaning: "Last frame for the stream.",
                  byteOffset: 4,
                  byteLength: 1,
                  bitOffset: 7,
                  bitLength: 1,
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};

describe("ResponsePane - Protocols tab", () => {
  // behavior: renders each layer, its facts, and its byte-backed segments (title + hex + fields).
  it("should render layers, facts, and byte-backed segments if a dissection is present", async () => {
    const user = userEvent.setup();
    renderProtocols(h2FrameDissection);

    const tablist = screen.getByRole("tablist", { name: /response sections/i });
    expect(
      within(tablist).getByRole("tab", { name: /protocols/i }),
    ).toBeInTheDocument();

    const panel = await openProtocolsTab(user);

    // Layer headers are always present; their bodies start collapsed.
    expect(within(panel).getByText("Network (IP)")).toBeInTheDocument();
    expect(within(panel).getByText("Application (HTTP/2)")).toBeInTheDocument();

    await expandAll(user, panel);

    expect(within(panel).getByText("93.184.216.34")).toBeInTheDocument();
    expect(
      within(panel).getByText(/HTTP\/2 frame \(sent\): HEADERS, stream 1/),
    ).toBeInTheDocument();
    // The frame's decoded fields render as clickable tree rows.
    expect(within(panel).getByText("HEADERS (1)")).toBeInTheDocument();
    expect(within(panel).getByText("Type")).toBeInTheDocument();
    // The nested flag bit is present with its bit-position label.
    expect(within(panel).getByText("END_STREAM")).toBeInTheDocument();
    expect(within(panel).getByText(/bit 7/)).toBeInTheDocument();
  });

  // behavior: clicking a field row highlights exactly the bytes it covers in the hex view.
  it("should highlight the field's byte range in the hex view when a field is selected", async () => {
    const user = userEvent.setup();
    renderProtocols(h2FrameDissection);

    const panel = await openProtocolsTab(user);
    await expandAll(user, panel);

    // Click the "Type" field (byteOffset 3, byteLength 1 -> only the 4th hex byte "01" is lit).
    await user.click(within(panel).getByText("Type"));

    const litBytes = Array.from(
      panel.querySelectorAll<HTMLElement>("span.bg-foreground.text-background"),
    ).map((element) => element.textContent);
    expect(litBytes).toEqual(["01"]);
  });

  // behavior: every layer section starts collapsed, so no segment body shows until expanded.
  it("should start every layer section collapsed by default", async () => {
    const user = userEvent.setup();
    renderProtocols(h2FrameDissection);

    const panel = await openProtocolsTab(user);

    // Layer header present, body hidden.
    expect(within(panel).getByText("Application (HTTP/2)")).toBeInTheDocument();
    expect(
      within(panel).queryByText(/HTTP\/2 frame \(sent\): HEADERS, stream 1/),
    ).toBeNull();
    // No section renders expanded initially.
    expect(
      within(panel).queryAllByRole("button", { expanded: true }),
    ).toHaveLength(0);
  });

  // behavior: a layer header expands/collapses its body.
  it("should expand and collapse a layer section when its header is clicked", async () => {
    const user = userEvent.setup();
    renderProtocols(h2FrameDissection);

    const panel = await openProtocolsTab(user);

    // Expand the HTTP/2 layer via its header (collapsed aria-expanded button carrying the name).
    const header = within(panel)
      .getAllByRole("button", { expanded: false })
      .find((button) => button.textContent?.includes("HTTP/2"));
    expect(header).toBeDefined();
    await user.click(header as HTMLElement);

    // Its nested segment header now shows.
    expect(
      within(panel).getByText(/HTTP\/2 frame \(sent\): HEADERS, stream 1/),
    ).toBeInTheDocument();

    // Collapse again -> body hidden.
    await user.click(header as HTMLElement);
    expect(
      within(panel).queryByText(/HTTP\/2 frame \(sent\): HEADERS, stream 1/),
    ).toBeNull();
  });

  // behavior: with no dissection the tab shows the empty state.
  it("should show the empty state if the dissection is absent", async () => {
    const user = userEvent.setup();
    renderProtocols();

    const panel = await openProtocolsTab(user);

    expect(
      within(panel).getByText(/no protocol dissection for this response\./i),
    ).toBeInTheDocument();
  });
});
