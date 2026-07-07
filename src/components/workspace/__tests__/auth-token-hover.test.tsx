import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import { ToastProvider } from "@/components/ui/toast";
import type { TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "api",
    name: "api",
    config: { variables: [{ key: "token", value: "abc-123" }] },
    children: [
      {
        kind: "request",
        id: "api/get",
        name: "Get",
        method: "GET",
        url: "https://api/get",
        body: emptyBody(),
        params: emptyParams(),
        config: { auth: authOf({ active: "bearer", token: "{{token}}" }) },
      },
    ],
  },
];

function Probe() {
  const { setActiveRequest, setRequestTab } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => {
        setActiveRequest("api/get");
        setRequestTab("auth");
      }}
    >
      open auth
    </button>
  );
}

// The auth Bearer/Basic inputs used to be plain inputs with no token highlight
// or hover. They now go through the shared HighlightedInput, so a {{var}} in the
// token colors AND its hover card previews the resolved value.
describe("auth field {{token}} highlight + hover", () => {
  it("should color a token in the bearer field and preview its resolved value on hover", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <WorkspaceProvider
          tree={tree}
          initialActiveRequestId="api/get"
          initialOpenRequestIds={["api/get"]}
        >
          <Probe />
          <RequestPane />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    await user.click(screen.getByRole("button", { name: /open auth/i }));

    // The token renders as a colored chip (highlight overlay), not just raw text.
    const chip = await screen.findByText("{{token}}");
    expect(chip.className).toMatch(/text-(emerald|sky|amber|red)/);

    // Hovering it resolves the folder variable.
    await user.hover(chip);
    expect(await screen.findByDisplayValue("abc-123")).toBeInTheDocument();
  });
});
