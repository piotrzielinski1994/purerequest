import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequestPane } from "@/components/workspace/request-pane";
import { UrlBar } from "@/components/workspace/url-bar";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { KeyValue, RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const requestWith = (
  overrides: Partial<RequestNode> & { query?: KeyValue[] },
): TreeNode[] => {
  const { query, params, ...rest } = overrides;
  return [
    {
      kind: "request",
      id: "req-1",
      name: "Req",
      method: "GET",
      url: "https://api.com/get",
      body: emptyBody(),
      config: {},
      ...rest,
      params: params ?? { path: [], query: query ?? [] },
    },
  ];
};

function SaveProbe() {
  const { saveActiveEditor, saveActiveRequest } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => {
        if (!saveActiveEditor()) {
          saveActiveRequest();
        }
      }}
    >
      fire save
    </button>
  );
}

function renderPane(
  tree: TreeNode[],
  onTreeChange: OnTreeChange = vi.fn().mockResolvedValue({ ok: true }),
) {
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveRequestId="req-1"
      initialOpenRequestIds={["req-1"]}
      onTreeChange={onTreeChange}
    >
      <SaveProbe />
      <UrlBar />
      <RequestPane />
    </WorkspaceProvider>,
  );
}

const fireSave = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /fire save/i }));

const savedRequest = (onTreeChange: ReturnType<typeof vi.fn>): RequestNode => {
  const calls = onTreeChange.mock.calls;
  const tree = calls[calls.length - 1][0] as TreeNode[];
  const node = tree.find((n) => n.id === "req-1");
  if (node?.kind !== "request") {
    throw new Error("req-1 not found in persisted tree");
  }
  return node;
};

describe("URL -> Query grid (AC-011, AC-014)", () => {
  // AC-011 - behavior: typing ?qwe=123 into the URL adds an enabled grid row.
  it("should add an enabled Query row when ?key=value is typed into the URL", async () => {
    const user = userEvent.setup();
    renderPane(requestWith({}));

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    await user.clear(urlInput);
    await user.type(urlInput, "https://api.com/get?qwe=123");

    // Query is the default sub-view; the typed param shows up as a row.
    expect(screen.getByDisplayValue("qwe")).toBeInTheDocument();
    expect(screen.getByDisplayValue("123")).toBeInTheDocument();
  });

  // AC-011 - side-effect-contract: the added row persists to params.query on save.
  it("should persist a url-typed query param into params.query on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(requestWith({}), onTreeChange);

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    await user.clear(urlInput);
    await user.type(urlInput, "https://api.com/get?qwe=123");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequest(onTreeChange).params.query).toEqual([
      { key: "qwe", value: "123", enabled: true },
    ]);
  });

  // AC-014 - behavior: removing an enabled key from the URL disables its row (kept).
  it("should disable a query row (keep its value) when its key is removed from the URL", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(
      requestWith({
        url: "https://api.com/get?qwe=123",
        query: [{ key: "qwe", value: "123", enabled: true }],
      }),
      onTreeChange,
    );

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    await user.clear(urlInput);
    await user.type(urlInput, "https://api.com/get");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequest(onTreeChange).params.query).toEqual([
      { key: "qwe", value: "123", enabled: false },
    ]);
  });
});

describe("Query grid -> URL (AC-012, AC-013)", () => {
  // AC-013 - side-effect-contract: unchecking a query row removes it from the URL.
  it("should remove a param from the URL when its Query row is disabled", async () => {
    const user = userEvent.setup();
    renderPane(
      requestWith({
        url: "https://api.com/get?qwe=123",
        query: [{ key: "qwe", value: "123", enabled: true }],
      }),
    );

    await user.click(screen.getByRole("checkbox", { name: /enable qwe/i }));

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    expect(urlInput).toHaveValue("https://api.com/get");
  });

  // AC-012 - side-effect-contract: editing a Query row value rewrites the URL query.
  it("should rewrite the URL query when a Query row value is edited", async () => {
    const user = userEvent.setup();
    renderPane(
      requestWith({
        url: "https://api.com/get?qwe=123",
        query: [{ key: "qwe", value: "123", enabled: true }],
      }),
    );

    // first value cell holds "123"; change it to "9".
    const valueCell = screen.getByLabelText("value 1");
    await user.clear(valueCell);
    await user.type(valueCell, "9");

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    expect(urlInput).toHaveValue("https://api.com/get?qwe=9");
  });
});

describe("Query sync leaves path + :pathParams alone (AC-012, AC-016)", () => {
  // AC-012 - behavior: rewriting the query keeps the path and a :pathParam intact.
  it("should preserve a :pathParam segment when a Query row rewrites the URL", async () => {
    const user = userEvent.setup();
    renderPane(
      requestWith({
        url: "https://api.com/users/:id?qwe=123",
        query: [{ key: "qwe", value: "123", enabled: true }],
      }),
    );

    await user.click(screen.getByRole("checkbox", { name: /enable qwe/i }));

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    expect(urlInput).toHaveValue("https://api.com/users/:id");
  });
});
