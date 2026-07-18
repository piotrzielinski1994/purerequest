import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import type { ResponseState } from "@/lib/http/model";
import type {
  FolderNode,
  RequestNode,
  TreeNode,
} from "@/lib/workspace/model";
import { emptyBody, emptyParams } from "@/lib/workspace/model";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";

// The script runner port + fake adapter don't exist yet: imported so RED fails
// on the missing module, not a typo.
import { createFakeScriptRunner } from "@/lib/scripts/fake-runner";
import type { ScriptApi, ScriptRunner } from "@/lib/scripts/model";

// ---- fixtures ---------------------------------------------------------------
// A folder defines `v` (so a {{v}} interpolation has a value) and holds a single
// request whose scripts.pre / scripts.post carry NON-EMPTY placeholders (the
// resolved-scripts guard only invokes the runner when the resolved code is
// non-empty; the fake ignores the code and runs its injected impl instead).

const makeTree = (scripts: { pre?: string; post?: string }): TreeNode[] => {
  const request: RequestNode = {
    kind: "request",
    id: "req-main",
    name: "main",
    method: "GET",
    url: "{{baseUrl}}/thing",
    body: emptyBody(),
    params: emptyParams(),
    config: { scripts },
  };
  const folder: FolderNode = {
    kind: "folder",
    id: "folder-root",
    name: "Root",
    config: {
      variables: [
        { key: "baseUrl", value: "https://api.example.com" },
        { key: "v", value: "vee" },
      ],
    },
    children: [request],
  };
  return [folder];
};

const findRequest = (nodes: TreeNode[], id: string): RequestNode | null => {
  for (const node of nodes) {
    if (node.id === id && node.kind === "request") {
      return node;
    }
    if (node.kind === "folder") {
      const found = findRequest(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

const findFolder = (nodes: TreeNode[], id: string): FolderNode | null => {
  for (const node of nodes) {
    if (node.id === id && node.kind === "folder") {
      return node;
    }
    if (node.kind === "folder") {
      const found = findFolder(node.children, id);
      if (found) {
        return found;
      }
    }
  }
  return null;
};

function describeState(state: ResponseState | undefined): string {
  if (!state) {
    return "none";
  }
  if (state.status === "success") {
    return `success:${state.response.status}`;
  }
  if (state.status === "error") {
    return `error:${state.message}`;
  }
  return state.status;
}

function Probe() {
  const { sendRequest, responseState, consoleLines } = useWorkspace();
  return (
    <div>
      <span data-testid="state">{describeState(responseState("req-main"))}</span>
      <span data-testid="console">{consoleLines.join("\n")}</span>
      <button type="button" onClick={() => sendRequest("req-main")}>
        send main
      </button>
    </div>
  );
}

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

type RenderOpts = {
  tree: TreeNode[];
  client: FakeHttpClient;
  scriptRunner: ScriptRunner;
  onTreeChange?: OnTreeChange;
};

function renderProbe({ tree, client, scriptRunner, onTreeChange }: RenderOpts) {
  return render(
    <WorkspaceProvider
      tree={tree}
      consoleLines={[]}
      initialExpandedIds={["folder-root"]}
      initialActiveRequestId="req-main"
      httpClient={client}
      scriptRunner={scriptRunner}
      onTreeChange={onTreeChange}
    >
      <Probe />
    </WorkspaceProvider>,
  );
}

describe("send loop - pre script wire mutation (TC-003 / AC-001)", () => {
  // behavior: a pre script that rewrites url + sets a header changes the wire,
  // and the set url is still {{var}}-interpolated downstream by buildHttpRequest.
  it("should send the wire with the pre-script-mutated, interpolated url and header", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.req?.setUrl("https://changed/{{v}}");
      api.req?.setHeader("X-A", "1");
    });
    renderProbe({
      tree: makeTree({ pre: "/* pre */" }),
      client,
      scriptRunner: runner,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(client.callCount).toBe(1));
    const wire = client.calls[0];
    expect(wire.url).toContain("https://changed/vee");
    expect(
      wire.headers.find((h) => h.key.toLowerCase() === "x-a")?.value,
    ).toBe("1");
  });
});

describe("send loop - pre setVar persistence + runtime (TC-004 / AC-002 / AC-003)", () => {
  // behavior: a pre setVar persists to the tree (onTreeChange spy) AND is visible
  // to this same send's interpolation (runtime layer).
  it("should persist the set var and reflect it in the same send's wire", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.purerequest.setVar("token", "abc");
      api.req?.setUrl("https://t/{{token}}");
    });
    renderProbe({
      tree: makeTree({ pre: "/* pre */" }),
      client,
      scriptRunner: runner,
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(client.callCount).toBe(1));
    // runtime layer: the same send's wire interpolates {{token}} -> abc.
    expect(client.calls[0].url).toContain("https://t/abc");

    // persisted: the latest tree handed to onTreeChange has token on the right
    // node (defined nowhere -> the request's own config.variables).
    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const persistedTree =
      onTreeChange.mock.calls[onTreeChange.mock.calls.length - 1][0];
    const reqVars = findRequest(persistedTree, "req-main")?.config.variables;
    const folderVars = findFolder(persistedTree, "folder-root")?.config
      .variables;
    const hasToken = (rows?: { key: string; value: string }[]) =>
      rows?.some((row) => row.key === "token" && row.value === "abc") ?? false;
    expect(hasToken(reqVars) || hasToken(folderVars)).toBe(true);
  });
});

describe("send loop - pre throws aborts the send (TC-005 / AC-005)", () => {
  // behavior: a throwing pre script aborts: client.send NOT called, response
  // state error with the message, a console line appended.
  it("should abort the send, set error state, and log a console line if pre throws", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const runner = createFakeScriptRunner(() => {
      throw new Error("pre boom");
    });
    renderProbe({
      tree: makeTree({ pre: "/* pre */" }),
      client,
      scriptRunner: runner,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toMatch(/^error:/),
    );
    expect(screen.getByTestId("state").textContent).toContain("pre boom");
    expect(client.callCount).toBe(0);
    expect(screen.getByTestId("console").textContent).toContain("pre boom");
  });
});

describe("send loop - post reads res + setVar (TC-006 / AC-004 / AC-006)", () => {
  // behavior: a post script reads res + setVar; the var persists and the response
  // state stays success.
  it("should persist a post setVar and keep the response success", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: true,
      response: {
        status: 200,
        timeMs: 3,
        sizeBytes: 9,
        body: '{"id":42}',
        headers: [{ key: "Content-Type", value: "application/json" }],
      },
    });
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const seen: { status?: number; id?: unknown } = {};
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      seen.status = api.res?.getStatus();
      const json = api.res?.getJson() as { id: number } | undefined;
      seen.id = json?.id;
      api.purerequest.setVar("id", String(json?.id));
    });
    renderProbe({
      tree: makeTree({ post: "/* post */" }),
      client,
      scriptRunner: runner,
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("success:200"),
    );
    expect(seen.status).toBe(200);
    expect(seen.id).toBe(42);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const persistedTree =
      onTreeChange.mock.calls[onTreeChange.mock.calls.length - 1][0];
    const reqVars = findRequest(persistedTree, "req-main")?.config.variables;
    const folderVars = findFolder(persistedTree, "folder-root")?.config
      .variables;
    const hasId = (rows?: { key: string; value: string }[]) =>
      rows?.some((row) => row.key === "id" && row.value === "42") ?? false;
    expect(hasId(reqVars) || hasId(folderVars)).toBe(true);
  });

  // behavior: a post script can read `req` (the sent request): getUrl returns the
  // interpolated url, getMethod the method - reflecting any pre mutation.
  it("should expose req to a post script with the interpolated sent url", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: true,
      response: {
        status: 200,
        timeMs: 1,
        sizeBytes: 2,
        body: "{}",
        headers: [],
      },
    });
    const seen: { url?: string; method?: string } = {};
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      seen.url = api.req?.getUrl();
      seen.method = api.req?.getMethod();
    });
    renderProbe({
      tree: makeTree({ post: "/* post */" }),
      client,
      scriptRunner: runner,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("success:200"),
    );
    expect(seen.url).toBe("https://api.example.com/thing");
    expect(seen.method).toBe("GET");
  });

  // behavior: a throwing post script keeps the success state and logs a console
  // error line (does not downgrade to error).
  it("should keep the response success and log a console line if post throws", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: true,
      response: {
        status: 200,
        timeMs: 3,
        sizeBytes: 0,
        body: "{}",
        headers: [],
      },
    });
    const runner = createFakeScriptRunner(() => {
      throw new Error("post boom");
    });
    renderProbe({
      tree: makeTree({ post: "/* post */" }),
      client,
      scriptRunner: runner,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("success:200"),
    );
    expect(screen.getByTestId("console").textContent).toContain("post boom");
  });
});

describe("send loop - console output (TC-007 / AC-007)", () => {
  // behavior: console.log inside a pre script appends a [pre]-prefixed line.
  it("should append a [pre]-prefixed console line for console.log in a pre script", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.console.log("hi");
    });
    renderProbe({
      tree: makeTree({ pre: "/* pre */" }),
      client,
      scriptRunner: runner,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => {
      const text = screen.getByTestId("console").textContent ?? "";
      expect(text).toContain("[pre]");
      expect(text).toContain("hi");
    });
  });

  // behavior: console.log inside a post script appends a [post]-prefixed line.
  it("should append a [post]-prefixed console line for console.log in a post script", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.console.log("howdy");
    });
    renderProbe({
      tree: makeTree({ post: "/* post */" }),
      client,
      scriptRunner: runner,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => {
      const text = screen.getByTestId("console").textContent ?? "";
      expect(text).toContain("[post]");
      expect(text).toContain("howdy");
    });
  });
});

describe("send loop - no scripts regression (TC-008 / AC-008)", () => {
  // behavior + side-effect-contract: an empty pre/post never invokes the runner
  // and the wire matches today's behavior (interpolated baseUrl, no extra header).
  it("should not invoke the runner and leave the wire unchanged if scripts are empty", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const run = vi.fn<ScriptRunner["run"]>(async () => ({ ok: true as const }));
    const runner: ScriptRunner = { run };
    renderProbe({
      tree: makeTree({ pre: "", post: "" }),
      client,
      scriptRunner: runner,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(client.callCount).toBe(1));
    expect(run).not.toHaveBeenCalled();
    expect(client.calls[0].url).toContain("https://api.example.com/thing");
    expect(
      client.calls[0].headers.find((h) => h.key.toLowerCase() === "x-a"),
    ).toBeUndefined();
  });

  // behavior: a whitespace-only script also skips the runner (the trim guard).
  it("should not invoke the runner if the script is whitespace only", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const run = vi.fn<ScriptRunner["run"]>(async () => ({ ok: true as const }));
    renderProbe({
      tree: makeTree({ pre: "   \n  ", post: "\t" }),
      client,
      scriptRunner: { run },
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(client.callCount).toBe(1));
    expect(run).not.toHaveBeenCalled();
  });
});

describe("send loop - edge cases (spec §9)", () => {
  // behavior: a pre script that switches the method to a bodyless one (GET) makes
  // buildHttpRequest null the body, even though the request had a body.
  it("should send a null body if a pre script switches the method to GET", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const request: RequestNode = {
      kind: "request",
      id: "req-main",
      name: "main",
      method: "POST",
      url: "{{baseUrl}}/thing",
      body: { active: "json", types: { json: '{"a":1}', form: [], multipart: [], graphql: { query: "", variables: "" } } },
      params: emptyParams(),
      config: { scripts: { pre: "/* pre */" } },
    };
    const tree: TreeNode[] = [
      {
        kind: "folder",
        id: "folder-root",
        name: "Root",
        config: {
          variables: [{ key: "baseUrl", value: "https://api.example.com" }],
        },
        children: [request],
      },
    ];
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.req?.setMethod("GET");
    });
    renderProbe({ tree, client, scriptRunner: runner });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(client.callCount).toBe(1));
    expect(client.calls[0].method).toBe("GET");
    expect(client.calls[0].body).toBeNull();
  });

  // behavior: many setVar calls in one script persist as ONE tree write (batched).
  it("should persist many setVars in a single tree write", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.purerequest.setVar("a", "1");
      api.purerequest.setVar("b", "2");
      api.purerequest.setVar("c", "3");
    });
    renderProbe({
      tree: makeTree({ pre: "/* pre */" }),
      client,
      scriptRunner: runner,
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    const persisted = onTreeChange.mock.calls[0][0];
    expect(
      findRequest(persisted, "req-main")?.config.variables,
    ).toEqual(
      expect.arrayContaining([
        { key: "a", value: "1" },
        { key: "b", value: "2" },
        { key: "c", value: "3" },
      ]),
    );
  });

  // behavior: console.clear() in a script wipes the Console panel, including
  // lines that existed before the send.
  it("should clear the console panel when a script calls console.clear", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient();
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.console.clear();
      api.console.log("after clear");
    });
    render(
      <WorkspaceProvider
        tree={makeTree({ pre: "/* pre */" })}
        consoleLines={["old line 1", "old line 2"]}
        initialExpandedIds={["folder-root"]}
        initialActiveRequestId="req-main"
        httpClient={client}
        scriptRunner={runner}
      >
        <Probe />
      </WorkspaceProvider>,
    );
    expect(screen.getByTestId("console").textContent).toContain("old line 1");

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() =>
      expect(screen.getByTestId("console").textContent).toContain("after clear"),
    );
    const text = screen.getByTestId("console").textContent ?? "";
    expect(text).not.toContain("old line 1");
    expect(text).not.toContain("old line 2");
  });

  // behavior: a post script that setVars then throws still persists the writes
  // recorded before the throw, and the response stays success.
  it("should persist a post setVar made before a later throw", async () => {
    const user = userEvent.setup();
    const client = createFakeHttpClient({
      ok: true,
      response: {
        status: 200,
        timeMs: 1,
        sizeBytes: 2,
        body: "{}",
        headers: [],
      },
    });
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    const runner = createFakeScriptRunner((api: ScriptApi) => {
      api.purerequest.setVar("saved", "yes");
      throw new Error("late boom");
    });
    renderProbe({
      tree: makeTree({ post: "/* post */" }),
      client,
      scriptRunner: runner,
      onTreeChange,
    });

    await user.click(screen.getByRole("button", { name: /send main/i }));

    await waitFor(() =>
      expect(screen.getByTestId("state").textContent).toBe("success:200"),
    );
    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const persisted =
      onTreeChange.mock.calls[onTreeChange.mock.calls.length - 1][0];
    expect(findRequest(persisted, "req-main")?.config.variables).toContainEqual({
      key: "saved",
      value: "yes",
    });
    expect(screen.getByTestId("console").textContent).toContain("late boom");
  });
});
