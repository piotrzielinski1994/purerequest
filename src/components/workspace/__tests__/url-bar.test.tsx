import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { UrlBar } from "@/components/workspace/url-bar";
import { ToastProvider } from "@/components/ui/toast";
import { fixtureTree } from "./fixtures";

function NewRequestButton() {
  const { newRequest } = useWorkspace();
  return (
    <button type="button" onClick={() => newRequest()}>
      new request
    </button>
  );
}

describe("UrlBar", () => {
  // AC-008 — behavior
  it("should show the active request's method and url", () => {
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <UrlBar />
      </WorkspaceProvider>,
    );

    const bar = screen.getByRole("group", { name: /url bar/i });
    expect(within(bar).getByText("POST")).toBeInTheDocument();

    const urlBox = within(bar).getByRole("textbox", { name: /url/i });
    expect(urlBox).toHaveValue("{{baseUrl}}/oauth/token");

    expect(
      within(bar).getByRole("button", { name: /send/i }),
    ).toBeInTheDocument();
  });

  // AC-008, E-1 — behavior
  it("should show an empty state when no request is active", () => {
    render(
      <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
        <UrlBar />
      </WorkspaceProvider>,
    );

    const bar = screen.getByRole("group", { name: /url bar/i });
    expect(within(bar).getByText(/no request selected/i)).toBeInTheDocument();
  });

  // TC-001, AC-002 - behavior: the method dropdown lists QUERY as a selectable
  // option, and selecting it sets the active request's method to QUERY (the
  // trigger reflects the new method).
  it("should list QUERY in the method dropdown and set the method to QUERY when picked", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <UrlBar />
      </WorkspaceProvider>,
    );

    const bar = screen.getByRole("group", { name: /url bar/i });
    await user.click(within(bar).getByRole("combobox", { name: /method/i }));

    const option = await screen.findByRole("option", { name: "QUERY" });
    await user.click(option);

    await waitFor(() =>
      expect(
        within(bar).getByRole("combobox", { name: /method/i }),
      ).toHaveTextContent("QUERY"),
    );
  });

  // TC-001, AC-003 - behavior: once QUERY is the active method, the trigger
  // carries the teal color class from METHOD_COLOR.
  it("should give the method trigger a teal color class when QUERY is active", async () => {
    const user = userEvent.setup();
    render(
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-token"
      >
        <UrlBar />
      </WorkspaceProvider>,
    );

    const bar = screen.getByRole("group", { name: /url bar/i });
    await user.click(within(bar).getByRole("combobox", { name: /method/i }));
    await user.click(await screen.findByRole("option", { name: "QUERY" }));

    await waitFor(() =>
      expect(
        within(bar).getByRole("combobox", { name: /method/i }).className,
      ).toContain("teal"),
    );
  });

  // behavior: creating the FIRST request from the empty state focuses the URL
  // input (the input mounts fresh on create, so the focus must still land).
  it("should focus the URL input when the first request is created from the empty state", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <WorkspaceProvider tree={[]}>
          <NewRequestButton />
          <UrlBar />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    // empty state: no URL input yet.
    expect(screen.queryByRole("textbox", { name: /url/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole("button", { name: /new request/i }));

    const urlBox = await screen.findByRole("textbox", { name: /url/i });
    await waitFor(() => expect(urlBox).toHaveFocus());
  });
});
