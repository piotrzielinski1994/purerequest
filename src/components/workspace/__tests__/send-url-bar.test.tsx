import { act, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { UrlBar } from "@/components/workspace/url-bar";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";
import { fixtureTree } from "./fixtures";

function ActiveUrlReadout() {
  const { activeRequest } = useWorkspace();
  return (
    <span data-testid="active-url">{`[${activeRequest?.url ?? "none"}]`}</span>
  );
}

function renderBar(
  client: FakeHttpClient,
  initialActiveRequestId = "req-token",
) {
  return render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={["folder-auth", "folder-oauth"]}
      initialActiveRequestId={initialActiveRequestId}
      httpClient={client}
    >
      <UrlBar />
      <ActiveUrlReadout />
    </WorkspaceProvider>,
  );
}

describe("UrlBar editable url", () => {
  // AC-001 — behavior: URL is an editable textbox.
  it("should expose the URL as an editable text input seeded with the active url", () => {
    renderBar(createFakeHttpClient());

    const bar = screen.getByRole("group", { name: /url bar/i });
    const urlBox = within(bar).getByRole("textbox", { name: /url/i });

    expect(urlBox).toHaveValue("{{baseUrl}}/oauth/token");
    expect(urlBox).not.toHaveAttribute("aria-readonly", "true");
  });

  // AC-001, TC-003 — behavior: typing updates the active request url.
  it("should update the active request url as the user types", async () => {
    const user = userEvent.setup();
    renderBar(createFakeHttpClient());

    const bar = screen.getByRole("group", { name: /url bar/i });
    const urlBox = within(bar).getByRole("textbox", { name: /url/i });

    await user.clear(urlBox);
    await user.type(urlBox, "https://typed.example.com/x");

    expect(screen.getByTestId("active-url")).toHaveTextContent(
      "[https://typed.example.com/x]",
    );
  });
});

describe("UrlBar Send button", () => {
  // AC-003 — side-effect-contract: Send triggers the http client.
  it("should send the active request when Send is clicked", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderBar(client);

    const bar = screen.getByRole("group", { name: /url bar/i });
    await user.click(within(bar).getByRole("button", { name: /send/i }));

    await waitFor(() => {
      expect(client.callCount).toBe(1);
    });
  });

  // AC-001 - behavior: Send becomes Stop while in flight, then returns to Send.
  it("should swap Send for Stop while the request is in flight", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient(undefined, { manual: true });
    renderBar(client);

    const bar = screen.getByRole("group", { name: /url bar/i });
    await user.click(within(bar).getByRole("button", { name: /^send$/i }));

    await waitFor(() => {
      expect(
        within(bar).getByRole("button", { name: /stop/i }),
      ).toBeInTheDocument();
    });
    expect(
      within(bar).queryByRole("button", { name: /^send$/i }),
    ).not.toBeInTheDocument();

    await act(async () => {
      client.resolveNext();
    });

    await waitFor(() => {
      expect(
        within(bar).getByRole("button", { name: /^send$/i }),
      ).toBeInTheDocument();
    });
  });
});
