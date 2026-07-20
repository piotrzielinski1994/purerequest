import { describe, it, expect, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import { UrlBar } from "@/components/workspace/url-bar";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { emptyBody } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const requestWith = (
  overrides: Partial<RequestNode> & { pathParams?: Record<string, string> },
): TreeNode[] => {
  const { pathParams, params, ...rest } = overrides;
  return [
    {
      kind: "request",
      id: "req-1",
      name: "Req",
      method: "GET",
      url: "https://api.com/users/:id/posts/:postId",
      body: emptyBody(),
      config: {},
      ...rest,
      params: params ?? {
        path: Object.entries(pathParams ?? {}).map(([key, value]) => ({
          key,
          value,
        })),
        query: [{ key: "page", value: "1" }],
      },
    },
  ];
};

// Mirrors editable-config-panels.test.tsx: a draft-then-save probe fires the
// Cmd+S path (saveActiveEditor -> fallback saveActiveRequest) so persistence is
// observable on onTreeChange.
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
  if (!node || node.kind !== "request") {
    throw new Error("req-1 not found in persisted tree");
  }
  return node;
};

describe("Params sub-bar (AC-001, TC-001)", () => {
  // AC-001, TC-001 - behavior: the Params tab shows a Path/Query sub-bar with Query
  // selected by default (today's single-tab behaviour).
  it("should show a Path/Query sub-bar with Query selected by default on the Params tab", () => {
    renderPane(requestWith({}));

    const path = screen.getByRole("tab", { name: "Path" });
    const query = screen.getByRole("tab", { name: "Query" });
    expect(path).toBeInTheDocument();
    expect(query).toBeInTheDocument();
    expect(query).toHaveAttribute("aria-selected", "true");
    expect(path).toHaveAttribute("aria-selected", "false");

    // Query sub-view renders the existing config.params row.
    expect(screen.getByDisplayValue("page")).toBeInTheDocument();
  });

  // AC-001, TC-001 - behavior: clicking Path switches to the Path grid, clicking
  // Query switches back.
  it("should switch to the Path sub-view on click and back to Query", async () => {
    const user = userEvent.setup();
    renderPane(requestWith({}));

    await user.click(screen.getByRole("tab", { name: "Path" }));
    expect(screen.getByDisplayValue("id")).toBeInTheDocument();
    expect(screen.queryByDisplayValue("page")).not.toBeInTheDocument();

    await user.click(screen.getByRole("tab", { name: "Query" }));
    expect(screen.getByDisplayValue("page")).toBeInTheDocument();
  });
});

describe("Query sub-view unchanged (AC-002, TC-002)", () => {
  // AC-002, TC-002 - side-effect-contract: toggling a query row off records
  // enabled:false in params.query on save (the existing Params behaviour).
  it("should persist enabled:false on params.query when a query row is toggled off and saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(requestWith({}), onTreeChange);

    await user.click(screen.getByRole("checkbox", { name: /enable page/i }));
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequest(onTreeChange).params.query).toEqual([
      { key: "page", value: "1", enabled: false },
    ]);
  });
});

describe("Path sub-view is an editable grid (AC-003)", () => {
  // AC-003 - behavior: the Path sub-view lists a row per :name in the URL in
  // first-appearance order, with EDITABLE key cells (not read-only).
  it("should list a row per :name in first-appearance order with editable key cells", async () => {
    const user = userEvent.setup();
    renderPane(requestWith({}));

    await user.click(screen.getByRole("tab", { name: "Path" }));

    const idKey = screen.getByDisplayValue("id");
    const postIdKey = screen.getByDisplayValue("postId");
    expect(idKey).toBeInTheDocument();
    expect(postIdKey).toBeInTheDocument();
    expect(idKey.compareDocumentPosition(postIdKey)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    // keys are editable now (the grid is a definition surface, not URL-locked).
    expect(idKey).not.toHaveAttribute("readonly");
    expect(postIdKey).not.toHaveAttribute("readonly");
  });

  // AC-003 - behavior: a seeded pathParams value shows in the editable value cell.
  it("should show a seeded path-param value in its editable value cell", async () => {
    const user = userEvent.setup();
    renderPane(requestWith({ pathParams: { id: "42" } }));

    await user.click(screen.getByRole("tab", { name: "Path" }));

    expect(screen.getByDisplayValue("42")).toBeInTheDocument();
  });

  // AC-003, TC-009 - behavior: a URL with no :name still shows the editable grid
  // (a trailing blank row), NOT an empty-state hint.
  it("should show the editable grid (no hint) if the url has no path params", async () => {
    const user = userEvent.setup();
    renderPane(requestWith({ url: "https://api.com/health" }));

    await user.click(screen.getByRole("tab", { name: "Path" }));

    expect(screen.queryByText(/no path parameters/i)).not.toBeInTheDocument();
    // a blank key cell (the trailing add row) is present.
    expect(screen.getByPlaceholderText("key")).toBeInTheDocument();
  });
});

describe("Path grid define + persist (AC-004, TC-002b, TC-004)", () => {
  // AC-004, TC-004 - side-effect-contract: editing a path-param value stores it as
  // params.path[name] on the request, persisted on save.
  it("should persist a path-param value edit as params.path[name] on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(requestWith({}), onTreeChange);

    await user.click(screen.getByRole("tab", { name: "Path" }));

    // :id is the first row, so its value cell is "value 1" (positional label,
    // mirrors editable-config-panels conventions).
    await user.type(screen.getByLabelText("value 1"), "42");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequest(onTreeChange).params.path).toContainEqual({
      key: "id",
      value: "42",
    });
  });

  // AC-003, AC-004, AC-005, TC-002b - side-effect-contract: a param defined purely
  // in the grid (key+value typed into the blank row) persists, and the URL is NOT
  // modified by the grid edit.
  it("should persist a grid-defined path param without touching the URL", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(requestWith({ url: "https://api.com/health" }), onTreeChange);

    await user.click(screen.getByRole("tab", { name: "Path" }));
    await user.type(screen.getByPlaceholderText("key"), "token");
    await user.type(screen.getByLabelText("value 1"), "abc");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const saved = savedRequest(onTreeChange);
    expect(saved.params.path).toContainEqual({ key: "token", value: "abc" });
    expect(saved.url).toBe("https://api.com/health");
  });
});

describe("URL drives Path rows + delta prune (AC-005, TC-003, TC-005)", () => {
  // AC-005, TC-003 - behavior: typing a :name into the URL adds its row; removing a
  // :name drops its row.
  it("should add a Path row when a :name is typed into the URL and drop it when removed", async () => {
    const user = userEvent.setup();
    renderPane(requestWith({ url: "https://api.com/users/:id" }));

    await user.click(screen.getByRole("tab", { name: "Path" }));
    expect(screen.getByDisplayValue("id")).toBeInTheDocument();

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    await user.clear(urlInput);
    await user.type(urlInput, "https://api.com/users/:id/:slug");
    expect(screen.getByDisplayValue("slug")).toBeInTheDocument();

    await user.clear(urlInput);
    await user.type(urlInput, "https://api.com/users/:slug");
    expect(screen.queryByDisplayValue("id")).not.toBeInTheDocument();
    expect(screen.getByDisplayValue("slug")).toBeInTheDocument();
  });

  // AC-005, E-6, TC-005 - side-effect-contract: removing a :name from the URL prunes
  // ONLY that param; a grid-only param (no :name in the URL) survives.
  it("should prune a url-removed param on save but keep a grid-only param", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(
      requestWith({
        url: "https://api.com/users/:id",
        pathParams: { id: "42", limit: "5" },
      }),
      onTreeChange,
    );

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    await user.clear(urlInput);
    await user.type(urlInput, "https://api.com/users");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const saved = savedRequest(onTreeChange);
    expect(saved.params.path.map((row) => row.key)).not.toContain("id");
    expect(saved.params.path).toContainEqual({ key: "limit", value: "5" });
  });
});

describe("Define-ahead-of-use (AC-010, E-8, TC-013)", () => {
  // AC-010, E-8, TC-013 - behavior: a value defined in the grid before its :name
  // exists in the URL is preserved when the :name is later added to the URL.
  it("should preserve a grid-defined value when its :name is later added to the URL", async () => {
    const user = userEvent.setup();
    renderPane(
      requestWith({ url: "https://api.com/users", pathParams: { id: "42" } }),
    );

    await user.click(screen.getByRole("tab", { name: "Path" }));
    // grid-only param shows even though the URL has no :id.
    expect(screen.getByDisplayValue("42")).toBeInTheDocument();

    const urlInput = screen.getByRole("textbox", { name: /url/i });
    await user.clear(urlInput);
    await user.type(urlInput, "https://api.com/users/:id");

    // the value 42 survived the URL add (not blanked).
    expect(screen.getByDisplayValue("42")).toBeInTheDocument();
  });
});
