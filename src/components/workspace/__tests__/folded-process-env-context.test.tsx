import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { FolderNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const tree: TreeNode[] = [
  {
    kind: "folder",
    id: "api",
    name: "api",
    config: {},
    dotenv: "TOKEN=api",
    children: [
      {
        kind: "request",
        id: "api/get",
        name: "Get",
        method: "GET",
        url: "https://api/get?t={{process.env.TOKEN}}",
        body: emptyBody(),
        params: emptyParams(),
        config: {},
      },
    ],
  },
  {
    kind: "request",
    id: "root-get",
    name: "RootGet",
    method: "GET",
    url: "https://root/get?t={{process.env.TOKEN}}",
    body: emptyBody(),
    params: emptyParams(),
    config: {},
  },
];

function SendProbe() {
  const {
    sendRequest,
    setTokenValue,
    openConfigEditor,
    revealTokenSource,
    revealTarget,
    editTarget,
    activeRequestId,
  } = useWorkspace();
  return (
    <div>
      <span data-testid="reveal-folder">
        {revealTarget?.folderId ?? "none"}
      </span>
      <span data-testid="reveal-view">{revealTarget?.view ?? "none"}</span>
      <span data-testid="edit-target">{editTarget?.id ?? "none"}</span>
      <span data-testid="active-request">{activeRequestId ?? "none"}</span>
      <button type="button" onClick={() => sendRequest("api/get")}>
        send api
      </button>
      <button type="button" onClick={() => sendRequest("root-get")}>
        send root
      </button>
      <button
        type="button"
        onClick={() => setTokenValue({ kind: "dotenv", key: "TOKEN" }, "api2")}
      >
        edit token in api request
      </button>
      <button type="button" onClick={() => openConfigEditor("api")}>
        open api folder
      </button>
      <button
        type="button"
        onClick={() => setTokenValue({ kind: "dotenv", key: "TOKEN" }, "api3")}
      >
        edit token in api folder
      </button>
      <button
        type="button"
        onClick={() => revealTokenSource({ kind: "dotenv", key: "TOKEN" })}
      >
        reveal token source
      </button>
    </div>
  );
}

function renderProbe(
  client: FakeHttpClient,
  onTreeChange: OnTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({
    ok: true,
  }),
  initialActiveRequestId = "api/get",
) {
  return render(
    <WorkspaceProvider
      tree={tree}
      httpClient={client}
      processEnv={{ TOKEN: "root" }}
      envText="TOKEN=root"
      initialActiveRequestId={initialActiveRequestId}
      initialOpenRequestIds={[initialActiveRequestId]}
      onTreeChange={onTreeChange}
    >
      <SendProbe />
    </WorkspaceProvider>,
  );
}

describe("send uses the request's folded process env (AC-004)", () => {
  // AC-004, TC-001 - behavior: a request inside a folder with its own .env sends
  // with the FOLDED env (folder TOKEN=api overrides the root TOKEN=root).
  it("should interpolate the folder .env value into the wire URL if the request is in that folder", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client);

    await user.click(screen.getByRole("button", { name: /send api/i }));

    await waitFor(() => expect(client.callCount).toBe(1));
    expect(client.calls[0].url).toContain("t=api");
  });

  // AC-004, TC-001 - behavior: a request at workspace root resolves only the root
  // .env, so the wire URL carries TOKEN=root.
  it("should interpolate the root .env value if the request is at workspace root", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    renderProbe(client);

    await user.click(screen.getByRole("button", { name: /send root/i }));

    await waitFor(() => expect(client.callCount).toBe(1));
    expect(client.calls[0].url).toContain("t=root");
  });
});

describe("inline token edit targets the owning .env (AC-010)", () => {
  // AC-010, TC-007 - side-effect-contract: editing a process.env token from inside
  // an api request writes to the FOLDER .env (api/.env), not the root .env.
  it("should write the edited process.env value into the owning folder dotenv", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe(createFakeHttpClient(), onTreeChange);

    await user.click(
      screen.getByRole("button", { name: /edit token in api request/i }),
    );

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const calls = onTreeChange.mock.calls;
    const lastTree = calls[calls.length - 1][0] as TreeNode[];
    const apiFolder = lastTree.find(
      (n): n is FolderNode => n.kind === "folder" && n.id === "api",
    );
    expect(apiFolder?.dotenv ?? "").toContain("TOKEN=api2");
  });

  // side-effect-contract: editing a process.env token while the api FOLDER pane
  // is the active editor (no active request) writes to that folder's .env, not
  // the root .env - the owner resolves from the active scope, not activeRequestId.
  it("should write to the folder dotenv when the folder pane is the active editor", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderProbe(createFakeHttpClient(), onTreeChange, "root-get");

    await user.click(screen.getByRole("button", { name: /open api folder/i }));
    await user.click(
      screen.getByRole("button", { name: /edit token in api folder/i }),
    );

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const calls = onTreeChange.mock.calls;
    const lastTree = calls[calls.length - 1][0] as TreeNode[];
    const apiFolder = lastTree.find(
      (n): n is FolderNode => n.kind === "folder" && n.id === "api",
    );
    expect(apiFolder?.dotenv ?? "").toContain("TOKEN=api3");
  });
});

describe("reveal token source targets the owning folder (folder pane)", () => {
  // side-effect-contract: the token popup "Edit"/go-to-source, fired while the
  // api folder pane is active, reveals THAT folder's Env > .env - not Settings
  // (root .env). Owner must resolve from the active scope, not activeRequestId.
  it("should reveal the owning folder dotenv when the folder pane is active", async () => {
    const user = userEvent.setup();
    renderProbe(createFakeHttpClient(), undefined, "root-get");

    await user.click(screen.getByRole("button", { name: /open api folder/i }));
    await user.click(
      screen.getByRole("button", { name: /reveal token source/i }),
    );

    await waitFor(() =>
      expect(screen.getByTestId("reveal-folder")).toHaveTextContent("api"),
    );
    expect(screen.getByTestId("reveal-view")).toHaveTextContent("dotenv");
    expect(screen.getByTestId("edit-target")).toHaveTextContent("api");
    // never bounced to the Settings tab.
    expect(screen.getByTestId("active-request")).not.toHaveTextContent(
      "__settings__",
    );
  });
});
