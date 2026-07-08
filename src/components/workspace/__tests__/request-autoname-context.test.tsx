import { describe, it, expect } from "vitest";
import { render, screen, within, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { SidebarTree } from "@/components/workspace/sidebar-tree";
import { UrlBar } from "@/components/workspace/url-bar";
import { ToastProvider } from "@/components/ui/toast";
import { fixtureTree } from "./fixtures";

// A freshly created request auto-names itself from its URL until the user gives
// it a name (rename) or it is saved. An already-named request does NOT.

function AutoNameProbe() {
  const {
    activeRequest,
    activeRequestId,
    newRequest,
    setRequestUrl,
    setActiveRequest,
    commitRename,
    beginRename,
  } = useWorkspace();

  return (
    <div>
      <span data-testid="active-id">{activeRequestId ?? "none"}</span>
      <span data-testid="active-name">{activeRequest?.name ?? "none"}</span>
      <button type="button" onClick={() => newRequest()}>
        new request
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, "{{baseUrl}}/widgets/list");
          }
        }}
      >
        type url
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, "{{baseUrl}}/changed");
          }
        }}
      >
        type url again
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            commitRename(activeRequestId, "My Name");
          }
        }}
      >
        commit rename
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            beginRename(activeRequestId);
          }
        }}
      >
        begin rename
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, "https://");
          }
        }}
      >
        type prefix only
      </button>
      <button
        type="button"
        onClick={() => {
          if (activeRequestId !== null) {
            setRequestUrl(activeRequestId, "");
          }
        }}
      >
        clear url
      </button>
      <button type="button" onClick={() => setActiveRequest("req-profile")}>
        activate profile
      </button>
      <button
        type="button"
        onClick={() => setRequestUrl("req-profile", "{{baseUrl}}/should-not-rename")}
      >
        edit profile url
      </button>
    </div>
  );
}

function renderProbe() {
  return render(
    <ToastProvider>
      <WorkspaceProvider tree={fixtureTree}>
        <AutoNameProbe />
      </WorkspaceProvider>
    </ToastProvider>,
  );
}

describe("WorkspaceProvider request auto-name", () => {
  // behavior: a freshly created request is named "untitled" by default.
  it("should name a new request 'untitled' by default", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /new request/i }));

    expect(screen.getByTestId("active-name")).toHaveTextContent("untitled");
  });

  // behavior: typing a URL into a freshly created request sets its name to the
  // URL verbatim (full string, no path extraction).
  it("should set a new request's name from its URL verbatim while it is unnamed", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /new request/i }));
    await user.click(screen.getByRole("button", { name: /^type url$/i }));

    expect(screen.getByTestId("active-name")).toHaveTextContent(
      "{{baseUrl}}/widgets/list",
    );
  });

  // behavior (#2 fix): an in-progress URL (e.g. "https://") stays the name
  // verbatim - it does NOT reset to "untitled" mid-typing.
  it("should keep an in-progress URL verbatim as the name, not reset to untitled", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /new request/i }));
    await user.click(screen.getByRole("button", { name: /^type url$/i }));
    await user.click(screen.getByRole("button", { name: /type prefix only/i }));

    expect(screen.getByTestId("active-name")).toHaveTextContent("https://");
    expect(screen.getByTestId("active-name")).not.toHaveTextContent("untitled");
  });

  // behavior: clearing the URL falls back to the request's untitled name.
  it("should fall back to the untitled name if the URL is cleared", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /new request/i }));
    await user.click(screen.getByRole("button", { name: /^type url$/i }));
    await user.click(screen.getByRole("button", { name: /clear url/i }));

    expect(screen.getByTestId("active-name")).toHaveTextContent("untitled");
  });

  // behavior: the auto-name keeps tracking further URL edits (still unnamed).
  it("should keep tracking the URL while the new request stays unnamed", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /new request/i }));
    await user.click(screen.getByRole("button", { name: /^type url$/i }));
    await user.click(screen.getByRole("button", { name: /type url again/i }));

    expect(screen.getByTestId("active-name")).toHaveTextContent("/changed");
  });

  // behavior: once the user renames the request, URL edits no longer change the
  // name (the name is now established).
  it("should stop auto-naming after the request is renamed", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /new request/i }));
    await user.click(screen.getByRole("button", { name: /commit rename/i }));
    expect(screen.getByTestId("active-name")).toHaveTextContent("My Name");

    await user.click(screen.getByRole("button", { name: /type url again/i }));

    // name is unchanged - the URL no longer drives it.
    expect(screen.getByTestId("active-name")).toHaveTextContent("My Name");
  });

  // behavior: starting a manual rename (even without committing) ends auto-name.
  it("should stop auto-naming once the user begins a manual rename", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /new request/i }));
    await user.click(screen.getByRole("button", { name: /^type url$/i }));
    expect(screen.getByTestId("active-name")).toHaveTextContent("/widgets/list");

    await user.click(screen.getByRole("button", { name: /begin rename/i }));
    await user.click(screen.getByRole("button", { name: /type url again/i }));

    // begin-rename signals the user is naming it -> URL no longer drives it.
    expect(screen.getByTestId("active-name")).toHaveTextContent("/widgets/list");
  });

  // behavior: an already-saved (existing) request never auto-names from a URL edit.
  it("should not auto-name an already-saved request when its URL changes", async () => {
    const user = userEvent.setup();
    renderProbe();

    await user.click(screen.getByRole("button", { name: /activate profile/i }));
    expect(screen.getByTestId("active-name")).toHaveTextContent("profile");

    await user.click(screen.getByRole("button", { name: /edit profile url/i }));

    // the saved request keeps its name.
    expect(screen.getByTestId("active-name")).toHaveTextContent("profile");
  });
});

// Integration: drive the REAL sidebar + URL input (not a probe). This is the
// path the probe missed - the sidebar row reads the merged name, not the tree
// node, so typing into the URL must rename the visible tree row.
function NewRequestControl() {
  const { newRequest } = useWorkspace();
  return (
    <button type="button" onClick={() => newRequest()}>
      new request
    </button>
  );
}

describe("new request draft (not in the sidebar until saved)", () => {
  it("should open a draft tab without adding a row to the sidebar tree", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
          <NewRequestControl />
          <SidebarTree />
          <UrlBar />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    const rowsBefore = within(tree).getAllByRole("treeitem").length;

    await user.click(screen.getByRole("button", { name: /new request/i }));

    // the draft is NOT in the sidebar (no untitled row appears, row count unchanged).
    expect(
      within(tree).queryByRole("treeitem", { name: /untitled/i }),
    ).not.toBeInTheDocument();
    expect(within(tree).getAllByRole("treeitem").length).toBe(rowsBefore);

    // typing into the real URL input still drives the draft's name (no crash,
    // still no sidebar row until it is saved).
    const urlInput = screen.getByRole("textbox", { name: /url/i });
    await user.type(urlInput, "{{baseUrl}}/widgets");
    expect(within(tree).getAllByRole("treeitem").length).toBe(rowsBefore);
  });

  it("should focus the URL input when New request is chosen from the empty-area context menu", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
          <SidebarTree />
          <UrlBar />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    fireEvent.contextMenu(tree.parentElement as HTMLElement);
    await user.click(
      await screen.findByRole("menuitem", { name: /new request/i }),
    );

    const urlInput = await screen.findByRole("textbox", { name: /url/i });
    await waitFor(() => expect(urlInput).toHaveFocus());
  });

  it("should focus the URL input when New request is chosen from a folder context menu", async () => {
    const user = userEvent.setup();
    render(
      <ToastProvider>
        <WorkspaceProvider tree={fixtureTree} initialExpandedIds={[]}>
          <SidebarTree />
          <UrlBar />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    const tree = screen.getByRole("tree", { name: /collection/i });
    fireEvent.contextMenu(
      within(tree).getByRole("treeitem", { name: /auth/i }),
    );
    await user.click(
      await screen.findByRole("menuitem", { name: /new request/i }),
    );

    const urlInput = await screen.findByRole("textbox", { name: /url/i });
    await waitFor(() => expect(urlInput).toHaveFocus());
  });
});
