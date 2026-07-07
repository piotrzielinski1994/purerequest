import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import type { TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";

const tree: TreeNode[] = [
  {
    kind: "request",
    id: "req",
    name: "Req",
    method: "GET",
    url: "{{token}}/get",
    body: emptyBody(),
    params: emptyParams(),
    config: {
      variables: [
        { key: "token", value: "tok-123" },
        { key: "scope", value: "read" },
      ],
    },
  },
  {
    kind: "request",
    id: "req-empty",
    name: "Empty",
    method: "GET",
    url: "https://api/get",
    body: emptyBody(),
    params: emptyParams(),
    config: {},
  },
];

function renderPane(initialActiveRequestId: string) {
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveRequestId={initialActiveRequestId}
    >
      <RequestPane />
    </WorkspaceProvider>,
  );
}

describe("RequestPane Vars tab", () => {
  // behavior: a Vars tab exists in the request sections
  it("should expose a Vars tab in the request sections", () => {
    renderPane("req");

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    expect(
      within(tablist).getByRole("tab", { name: "Vars" }),
    ).toBeInTheDocument();
  });

  // behavior: the Vars tab lists the request's own variables as editable inputs
  it("should list the request's own variables if the Vars tab is opened", async () => {
    const user = userEvent.setup();
    renderPane("req");

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Vars" }));

    expect(screen.getByDisplayValue("token")).toBeInTheDocument();
    expect(screen.getByDisplayValue("tok-123")).toBeInTheDocument();
    expect(screen.getByDisplayValue("scope")).toBeInTheDocument();
    expect(screen.getByDisplayValue("read")).toBeInTheDocument();
  });

  // behavior: an empty-variables request shows just the trailing blank row, not a crash
  it("should show an empty editable row if the request defines no variables", async () => {
    const user = userEvent.setup();
    renderPane("req-empty");

    const tablist = screen.getByRole("tablist", { name: /request sections/i });
    await user.click(within(tablist).getByRole("tab", { name: "Vars" }));

    // only the trailing blank row: one empty key + one empty value input.
    const inputs = screen.getAllByRole("textbox");
    expect(inputs).toHaveLength(2);
    inputs.forEach((input) => expect(input).toHaveValue(""));
  });
});
