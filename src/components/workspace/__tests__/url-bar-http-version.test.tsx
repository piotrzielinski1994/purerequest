import { describe, it, expect } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { UrlBar } from "@/components/workspace/url-bar";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { fixtureTree, tokenRequest } from "./fixtures";

const h3Request = {
  ...tokenRequest,
  id: "req-h3",
  name: "h3",
  httpVersion: "h3",
} as RequestNode;

const h3Tree: TreeNode[] = [h3Request];

describe("UrlBar - HTTP version selector (TC-010, AC-004)", () => {
  // TC-010, AC-004 - behavior: the URL bar renders a version selector control
  // beside the method select, defaulting to the Auto label for a request with no
  // stored version (req-token is auto).
  it("should render an HTTP version selector showing Auto for an auto request", () => {
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
    const version = within(bar).getByRole("combobox", {
      name: /http version/i,
    });
    expect(version).toHaveTextContent(/auto/i);
  });

  // TC-010, AC-004 - behavior: the trigger reflects the active request's STORED
  // version (an h3 request shows the HTTP/3 label).
  it("should reflect a stored h3 version on the version trigger", () => {
    render(
      <WorkspaceProvider tree={h3Tree} initialActiveRequestId="req-h3">
        <UrlBar />
      </WorkspaceProvider>,
    );

    const bar = screen.getByRole("group", { name: /url bar/i });
    const version = within(bar).getByRole("combobox", {
      name: /http version/i,
    });
    expect(version).toHaveTextContent(/http\/3/i);
  });

  // TC-010, AC-004 - behavior: picking HTTP/3 sets the active request's version,
  // so the trigger reflects HTTP/3 (mirrors how the Method select test asserts the
  // observable outcome of a pick).
  it("should set the active request version to HTTP/3 if the HTTP/3 option is picked", async () => {
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
    await user.click(
      within(bar).getByRole("combobox", { name: /http version/i }),
    );

    const option = await screen.findByRole("option", { name: /http\/3/i });
    await user.click(option);

    await waitFor(() =>
      expect(
        within(bar).getByRole("combobox", { name: /http version/i }),
      ).toHaveTextContent(/http\/3/i),
    );
  });
});
