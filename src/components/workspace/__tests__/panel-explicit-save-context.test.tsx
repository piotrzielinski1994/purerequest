import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { toast } from "sonner";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import { ContentHeader } from "@/components/workspace/content-header";
import { CloseConfirmDialog } from "@/components/workspace/close-confirm-dialog";
import type { ConfigScope, RequestNode, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody } from "@/lib/workspace/model";

vi.mock("sonner", () => ({
  toast: Object.assign(vi.fn(), {
    error: vi.fn(),
    success: vi.fn(),
    loading: vi.fn(),
    dismiss: vi.fn(),
  }),
  Toaster: () => null,
}));

const mockToast = vi.mocked(toast);

const toastCallsMatching = (pattern: RegExp): string[] =>
  mockToast.mock.calls.map((c) => String(c[0])).filter((m) => pattern.test(m));

const toastFired = (pattern: RegExp): boolean =>
  toastCallsMatching(pattern).length > 0;

beforeEach(() => {
  vi.clearAllMocks();
});

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const baseConfig: ConfigScope = {
  variables: [{ key: "token", value: "tok-123" }],
  headers: [{ key: "Accept", value: "application/json" }],
  auth: authOf({ active: "bearer", token: "secret" }),
  scripts: { pre: "// pre", post: "" },
};

const tree: TreeNode[] = [
  {
    kind: "request",
    id: "req-1",
    name: "Req",
    method: "GET",
    url: "https://api/get",
    body: emptyBody(),
    params: { path: [], query: [{ key: "page", value: "1" }] },
    config: baseConfig,
  },
];

// The real Mod+S handler calls `saveActive` (editor save -> request save ->
// always-toast on clean state) - drive that exact entry point.
function SaveProbe() {
  const { saveActive } = useWorkspace();
  return (
    <button type="button" onClick={saveActive}>
      fire save
    </button>
  );
}

function renderPane(
  onTreeChange: OnTreeChange,
  initialTree: TreeNode[] = tree,
) {
  return render(
    <WorkspaceProvider
      tree={initialTree}
      initialActiveRequestId="req-1"
      initialOpenRequestIds={["req-1"]}
      onTreeChange={onTreeChange}
    >
      <ContentHeader />
      <SaveProbe />
      <RequestPane />
      <CloseConfirmDialog />
    </WorkspaceProvider>,
  );
}

const openSubTab = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const tablist = screen.getByRole("tablist", { name: /request sections/i });
  await user.click(within(tablist).getByRole("tab", { name }));
};

const fireSave = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /fire save/i }));

// The dirty dot lives on the request's tab in the ContentHeader (the "Open
// requests" tablist), labeled "Unsaved changes" - same marker the existing
// content-header tests assert.
const dirtyDot = () => {
  const tablist = screen.getByRole("tablist", { name: /open requests/i });
  return within(tablist).queryByLabelText(/unsaved changes/i);
};

const savedRequest = (onTreeChange: ReturnType<typeof vi.fn>): RequestNode => {
  const calls = onTreeChange.mock.calls;
  const lastTree = calls[calls.length - 1][0] as TreeNode[];
  const node = lastTree.find((n) => n.id === "req-1");
  if (!node || node.kind !== "request") {
    throw new Error("req-1 not found in persisted tree");
  }
  return node;
};

const savedConfig = (onTreeChange: ReturnType<typeof vi.fn>): ConfigScope =>
  savedRequest(onTreeChange).config;

describe("request structured panels - no autosave on blur (AC-001)", () => {
  // behavior: editing a Header value and blurring it leaves it in a draft and
  // does NOT persist (no onTreeChange call) - persist only happens on Cmd+S.
  it("should NOT call onTreeChange if a header value is edited and blurred", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Headers");

    const valueInput = screen.getByDisplayValue("application/json");
    await user.clear(valueInput);
    await user.type(valueInput, "text/plain");
    await user.tab();

    // give any (incorrect) autosave a chance to fire before asserting it didn't.
    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();
  });

  // behavior: editing a Var value and blurring it does not persist on blur.
  it("should NOT call onTreeChange if a variable value is edited and blurred", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();
  });

  // behavior: editing the Auth bearer token and blurring it does not persist.
  it("should NOT call onTreeChange if the bearer token is edited and blurred", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Auth");

    const token = screen.getByLabelText(/token/i);
    await user.clear(token);
    await user.type(token, "new-token");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();
  });
});

describe("request structured panels - Cmd+S persists + toast (AC-002)", () => {
  // side-effect-contract: firing the save action after an Auth edit persists the
  // whole request via onTreeChange with the edited auth config, and shows "Saved".
  it("should persist the edited auth config and show a Saved toast if the save action fires", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Auth");

    const token = screen.getByLabelText(/token/i);
    await user.clear(token);
    await user.type(token, "new-token");
    await user.tab();

    // nothing persisted yet - persistence happens AT the save action, not on blur.
    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    expect(savedConfig(onTreeChange).auth?.active).toBe("bearer");
    expect(savedConfig(onTreeChange).auth?.types.bearer).toEqual({
      token: "new-token",
    });
    await waitFor(() => expect(toastFired(/saved/i)).toBe(true));
  });

  // side-effect-contract: the save action persists the latest edit even when the
  // field is STILL FOCUSED (no blur first) - structured inputs commit on change,
  // so Cmd+S never reads a stale pre-edit value. Pins the "Cmd+S does nothing on
  // the Auth tab" bug where the token edit was stuck in the input's local buffer.
  it("should persist the edited auth token if the save fires while the token field is still focused", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Auth");

    const token = screen.getByLabelText(/token/i);
    await user.clear(token);
    await user.type(token, "focused-token");
    // NO blur / tab-away - the cell keeps focus, exactly like pressing Cmd+S
    // right after typing.
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    expect(savedConfig(onTreeChange).auth?.active).toBe("bearer");
    expect(savedConfig(onTreeChange).auth?.types.bearer).toEqual({
      token: "focused-token",
    });
  });

  // side-effect-contract: same focused-save guarantee for the key-value grid
  // (Vars/Headers/Params) - typing a value then Cmd+S without blur persists it.
  it("should persist a Vars edit if the save fires while the value cell is still focused", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "focused-value");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    expect(savedConfig(onTreeChange).variables).toEqual([
      { key: "token", value: "focused-value" },
    ]);
  });
});

describe("request structured panels - Cmd+S always toasts", () => {
  // behavior: Cmd+S on a CLEAN request (nothing edited) still shows the "Saved"
  // toast (UX: the shortcut always confirms) but does NOT persist (no tree write).
  it("should show a Saved toast but not persist if the save fires with no changes", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Auth");

    await fireSave(user);

    await waitFor(() => expect(toastFired(/saved/i)).toBe(true));
    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();
  });

  // side-effect-contract: Cmd+S on the raw-JSON Raw sub-tab with NO edits
  // must NOT hit the disk (no onTreeChange) - it should be as instant as a clean
  // structured-tab save. Pins the "noticeable lag before the toast on Settings"
  // bug, where the active editor's save() persisted unconditionally and the toast
  // waited on the tree-write round-trip even though nothing changed.
  it("should show a Saved toast but not persist if a clean Raw tab is saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Raw");
    await waitFor(() => {
      expect(document.querySelector(".cm-editor")).not.toBeNull();
    });

    await fireSave(user);

    await waitFor(() => expect(toastFired(/saved/i)).toBe(true));
    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();
  });

  // side-effect-contract: a dirty save toasts "Saved" OPTIMISTICALLY - the
  // confirmation shows immediately, before the (slow) disk write resolves. Pins
  // the "save mules before the toast" lag: the toast must not wait on onTreeChange.
  it("should show the Saved toast immediately on a dirty save without waiting for the disk write", async () => {
    const user = userEvent.setup();
    // a persist promise we deliberately never resolve - the toast must appear anyway.
    const onTreeChange = vi
      .fn<OnTreeChange>()
      .mockReturnValue(new Promise<never>(() => {}));
    renderPane(onTreeChange);
    await openSubTab(user, "Headers");

    const valueInput = screen.getByDisplayValue("application/json");
    await user.clear(valueInput);
    await user.type(valueInput, "text/plain");
    await fireSave(user);

    await waitFor(() => expect(toastFired(/^saved$/i)).toBe(true));
    expect(onTreeChange).toHaveBeenCalledTimes(1);
  });

  // side-effect-contract: an optimistic save that the disk REJECTS still surfaces
  // the failure (a "Save failed" toast) after the write settles, so the user is
  // never silently left with an unpersisted change.
  it("should surface a Save failed toast if the background write rejects", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi
      .fn<OnTreeChange>()
      .mockResolvedValue({ ok: false, error: "disk full" });
    renderPane(onTreeChange);
    await openSubTab(user, "Headers");

    const valueInput = screen.getByDisplayValue("application/json");
    await user.clear(valueInput);
    await user.type(valueInput, "text/plain");
    await fireSave(user);

    await waitFor(() => expect(toastFired(/save failed/i)).toBe(true));
  });

  // side-effect-contract: a dirty save shows the SUCCESS toast EXACTLY ONCE - the
  // optimistic toast fires, and a resolved-ok write does not add a second one.
  it("should show the Saved toast exactly once on a dirty save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Headers");

    const valueInput = screen.getByDisplayValue("application/json");
    await user.clear(valueInput);
    await user.type(valueInput, "text/plain");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(toastCallsMatching(/^saved$/i)).toHaveLength(1));
  });
});

describe("request structured panels - dirty dot (AC-003)", () => {
  // behavior: editing a structured panel marks the request tab dirty; firing the
  // save action clears the dot.
  it("should show the dirty dot after an edit and clear it after the save action", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Headers");

    expect(dirtyDot()).not.toBeInTheDocument();

    const valueInput = screen.getByDisplayValue("application/json");
    await user.clear(valueInput);
    await user.type(valueInput, "text/plain");
    await user.tab();

    await waitFor(() => expect(dirtyDot()).toBeInTheDocument());

    await fireSave(user);

    await waitFor(() => expect(dirtyDot()).not.toBeInTheDocument());
  });
});

describe("request structured panels - switch keeps draft (AC-004)", () => {
  // behavior: editing a Var, switching to Auth and back keeps the edited value in
  // the input, keeps the dirty dot, and never autosaves (no onTreeChange call).
  it("should keep the draft and stay dirty without persisting if the sub-tab is switched away and back", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();

    await openSubTab(user, "Auth");
    await openSubTab(user, "Vars");

    // edit retained in the draft.
    expect(screen.getByDisplayValue("tok-999")).toBeInTheDocument();
    // still dirty, still nothing persisted.
    expect(dirtyDot()).toBeInTheDocument();
    expect(onTreeChange).not.toHaveBeenCalled();
  });
});

describe("request structured panels - revert clears dirty (AC-005)", () => {
  // behavior: editing a Var then typing it back to the on-disk value clears the
  // dirty dot (deep-equal compare of draft config vs saved config).
  it("should clear the dirty dot if an edited value is reverted to its on-disk value", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();
    await waitFor(() => expect(dirtyDot()).toBeInTheDocument());

    const edited = screen.getByDisplayValue("tok-999");
    await user.clear(edited);
    await user.type(edited, "tok-123");
    await user.tab();

    await waitFor(() => expect(dirtyDot()).not.toBeInTheDocument());
    expect(onTreeChange).not.toHaveBeenCalled();
  });
});

describe("request structured panels - close-while-dirty confirms (AC-006)", () => {
  // behavior: closing a request with an unsaved structured edit opens the
  // existing confirm dialog instead of closing the tab.
  it("should open the confirm dialog if a request with an unsaved param edit is closed", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Params");

    const valueInput = screen.getByDisplayValue("1");
    await user.clear(valueInput);
    await user.type(valueInput, "2");
    await user.tab();
    await waitFor(() => expect(dirtyDot()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /close req/i }));

    const dialog = await screen.findByRole("dialog");
    expect(
      within(dialog).getByRole("heading", { name: /unsaved changes/i }),
    ).toBeInTheDocument();
  });

  // side-effect-contract: the confirm dialog's Save persists the edited param
  // config via onTreeChange, then closes the tab.
  it("should persist the edited config and close the tab if the dialog Save is used", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Params");

    const valueInput = screen.getByDisplayValue("1");
    await user.clear(valueInput);
    await user.type(valueInput, "2");
    await user.tab();
    await waitFor(() => expect(dirtyDot()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /close req/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /^save$/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequest(onTreeChange).params.query).toEqual([
      { key: "page", value: "2" },
    ]);
    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
  });

  // side-effect-contract: the confirm dialog's Discard drops the draft (no
  // onTreeChange) and closes the tab.
  it("should drop the draft without persisting if the dialog Discard is used", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openSubTab(user, "Params");

    const valueInput = screen.getByDisplayValue("1");
    await user.clear(valueInput);
    await user.type(valueInput, "2");
    await user.tab();
    await waitFor(() => expect(dirtyDot()).toBeInTheDocument());

    await user.click(screen.getByRole("button", { name: /close req/i }));
    await screen.findByRole("dialog");
    await user.click(screen.getByRole("button", { name: /discard/i }));

    await waitFor(() =>
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument(),
    );
    expect(onTreeChange).not.toHaveBeenCalled();
  });
});
