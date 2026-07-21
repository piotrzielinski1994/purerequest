import { EditorView } from "@codemirror/view";
import {
  act,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";
import { RequestPane } from "@/components/workspace/request-pane";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import type { ConfigScope, RequestNode, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyBody, emptyParams } from "@/lib/workspace/model";

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

// Structured panels are draft + explicit-save: edits go into a draft and persist
// only on the save action (Mod+S), which routes saveActiveEditor -> fallback
// saveActiveRequest. This probe fires that path.
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

function renderPane(onTreeChange: OnTreeChange) {
  return render(
    <WorkspaceProvider
      tree={tree}
      initialActiveRequestId="req-1"
      initialOpenRequestIds={["req-1"]}
      onTreeChange={onTreeChange}
    >
      <SaveProbe />
      <RequestPane />
    </WorkspaceProvider>,
  );
}

const openTab = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const tablist = screen.getByRole("tablist", { name: /request sections/i });
  await user.click(within(tablist).getByRole("tab", { name }));
};

const fireSave = (user: ReturnType<typeof userEvent.setup>) =>
  user.click(screen.getByRole("button", { name: /fire save/i }));

const savedRequest = (onTreeChange: ReturnType<typeof vi.fn>): RequestNode => {
  const calls = onTreeChange.mock.calls;
  const tree = calls[calls.length - 1][0] as TreeNode[];
  const node = tree.find((n) => n.id === "req-1");
  if (node?.kind !== "request") {
    throw new Error("req-1 not found");
  }
  return node;
};

const savedConfig = (onTreeChange: ReturnType<typeof vi.fn>): ConfigScope =>
  savedRequest(onTreeChange).config;

describe("editable Headers/Params panel", () => {
  // config-grid - behavior: editing a header value updates the draft but does NOT
  // persist on blur; the save action then persists the edited value.
  it("should update the draft on blur and persist a header value edit only on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    const valueInput = screen.getByDisplayValue("application/json");
    await user.clear(valueInput);
    await user.type(valueInput, "text/plain");
    await user.tab();

    // no autosave on blur.
    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "text/plain" },
    ]);
  });

  // config-grid - behavior: typing into the trailing blank row materializes a new
  // header in the draft, persisted on save (no Add-row button needed).
  it("should persist a new header row typed into the trailing blank row on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    // one real row (Accept) + the trailing blank => the blank's key input is "key 2".
    await user.type(screen.getByLabelText("key 2"), "X-New");
    await user.type(screen.getByLabelText("value 2"), "yes");
    await user.tab();
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "application/json" },
      { key: "X-New", value: "yes" },
    ]);
  });

  // config-grid - behavior: a typed-but-not-blurred edit is flushed into the draft
  // when the panel unmounts (tab switch), so switching tabs never loses the last
  // keystroke; it persists on a later save.
  it("should keep a pending edit when switching tabs without blurring and persist it on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    await user.type(screen.getByLabelText("key 2"), "X-New");
    await user.type(screen.getByLabelText("value 2"), "yes");
    // No user.tab() / blur - switch straight to another tab (unmounts the panel).
    await openTab(user, "Vars");
    // switching tabs is not a save.
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "application/json" },
      { key: "X-New", value: "yes" },
    ]);
  });

  // config-grid - behavior: removing a row drops it from the draft, persisted on save.
  it("should persist removal of a param row on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Params");

    await user.click(screen.getByRole("button", { name: /remove page/i }));
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedRequest(onTreeChange).params.query).toEqual([]);
  });

  // config-grid - behavior: unchecking the row toggle records enabled:false in the
  // draft, persisted on save.
  it("should persist enabled:false when a header is toggled off and saved", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    await user.click(screen.getByRole("checkbox", { name: /enable accept/i }));
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "application/json", enabled: false },
    ]);
  });
});

describe("config grid {{var}} highlighting", () => {
  const tokenTree: TreeNode[] = [
    {
      kind: "request",
      id: "req-1",
      name: "Req",
      method: "GET",
      url: "https://api/get",
      body: emptyBody(),
      params: emptyParams(),
      config: {
        variables: [{ key: "token", value: "tok-123" }],
        headers: [{ key: "Authorization", value: "Bearer {{token}}" }],
      },
    },
  ];

  const renderTokens = (onTreeChange: OnTreeChange) =>
    render(
      <WorkspaceProvider
        tree={tokenTree}
        initialActiveRequestId="req-1"
        onTreeChange={onTreeChange}
      >
        <RequestPane />
      </WorkspaceProvider>,
    );

  // behavior: a {{var}} inside a header value is rendered as a colored token in
  // an overlay (like the URL bar), and a resolved variable is emerald.
  it("should color a {{var}} token in a header value", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderTokens(onTreeChange);
    await openTab(user, "Headers");

    const token = screen.getByText("{{token}}");
    expect(token.className).toContain("text-emerald-500");
  });

  // behavior: hovering the {{var}} token in a value shows its resolved value.
  it("should preview the resolved value when a value token is hovered", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderTokens(onTreeChange);
    await openTab(user, "Headers");

    await user.hover(screen.getByText("{{token}}"));

    // the hover card's editor input is labeled exactly "Value" (the grid value
    // cells are "value 1" etc).
    const input = await screen.findByRole("textbox", { name: /^value$/i });
    expect(input).toHaveValue("tok-123");
  });
});

describe("editable Vars panel", () => {
  // config-grid - behavior: editing a variable value persists it on save (Record form).
  it("should persist a variable value edit on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).variables).toEqual([
      { key: "token", value: "tok-999" },
    ]);
  });
});

describe("editable Auth panel", () => {
  const renderBasic = (onTreeChange: OnTreeChange) => {
    const basicTree: TreeNode[] = [
      {
        kind: "request",
        id: "req-1",
        name: "Req",
        method: "GET",
        url: "https://api/get",
        body: emptyBody(),
        params: emptyParams(),
        config: {
          auth: authOf({ active: "basic", username: "ada", password: "pw" }),
        },
      },
    ];
    return render(
      <WorkspaceProvider
        tree={basicTree}
        initialActiveRequestId="req-1"
        initialOpenRequestIds={["req-1"]}
        onTreeChange={onTreeChange}
      >
        <SaveProbe />
        <RequestPane />
      </WorkspaceProvider>,
    );
  };

  // config-grid - behavior: editing the bearer token persists it on save.
  it("should persist a bearer token edit on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Auth");

    const token = screen.getByLabelText(/token/i);
    await user.clear(token);
    await user.type(token, "new-token");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const savedAuth = savedConfig(onTreeChange).auth;
    expect(savedAuth?.active).toBe("bearer");
    expect(savedAuth?.types.bearer.token).toBe("new-token");
  });

  // config-grid - behavior: the auth fields render inside a grid (like Params),
  // with a label cell + value input per field.
  it("should render the auth fields in a grid", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderBasic(onTreeChange);
    await openTab(user, "Auth");

    const grid = screen.getByRole("grid", { name: /auth fields/i });
    expect(grid).toBeInTheDocument();
    expect(within(grid).getByLabelText(/username/i)).toBeInTheDocument();
    expect(within(grid).getByLabelText(/^password$/i)).toBeInTheDocument();
  });

  // config-grid - behavior: editing the basic username persists it on save.
  it("should persist a basic username edit on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderBasic(onTreeChange);
    await openTab(user, "Auth");

    const username = screen.getByLabelText(/username/i);
    await user.clear(username);
    await user.type(username, "grace");
    await user.tab();

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const savedAuth = savedConfig(onTreeChange).auth;
    expect(savedAuth?.active).toBe("basic");
    expect(savedAuth?.types.basic).toEqual({
      username: "grace",
      password: "pw",
    });
  });

  // config-grid - behavior: the password show/hide toggle still works in the grid.
  it("should toggle password visibility in the grid", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderBasic(onTreeChange);
    await openTab(user, "Auth");

    const password = screen.getByLabelText(/^password$/i);
    expect(password).toHaveAttribute("type", "password");
    await user.click(screen.getByRole("button", { name: /show password/i }));
    expect(password).toHaveAttribute("type", "text");
  });

  // The auth TYPE switch is a radix Select; jsdom can't open its portal-rendered
  // options (see docs/learnings.md), so the dropdown selection path is covered by
  // manual testing. The switch now just flips `active` while keeping every
  // `types` slot, so no field is lost - covered by the model-level test below.
});

// The script editor is a CodeMirror instance (not a textarea), so jsdom can't
// type into it - drive it the body-editor way: replace the doc via the live
// EditorView then fire a blur. With the explicit-save model the blur flushes the
// edit into the draft (no persist); a later save persists it. The aria-label is
// mirrored onto the .cm-content node, so getByLabelText still resolves it.
async function setScript(label: RegExp, text: string) {
  const content = screen.getByLabelText(label);
  const editorEl = content.closest(".cm-editor");
  const view = EditorView.findFromDOM(editorEl as HTMLElement);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  // Dispatch inside act so the onChange->setDraft update flushes BEFORE the blur
  // reads the draft (else the flush-on-blur sees the stale pre-edit value).
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
  fireEvent.blur(content);
}

// Type into the editor WITHOUT blurring (the tab-switch-loses-edit scenario).
async function typeScriptNoBlur(label: RegExp, text: string) {
  const content = screen.getByLabelText(label);
  const view = EditorView.findFromDOM(
    content.closest(".cm-editor") as HTMLElement,
  );
  if (!view) {
    throw new Error("live EditorView not found");
  }
  await act(async () => {
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: text },
    });
  });
}

describe("editable Script panel", () => {
  // config-grid - behavior: editing the pre-request script updates the draft (no
  // persist on blur) and persists it on save.
  it("should persist a pre-request script edit on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Script");

    await setScript(/pre-request/i, "console.log(1)");

    await Promise.resolve();
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).scripts?.pre).toBe("console.log(1)");
  });

  // behavior: a typed-but-not-blurred pre script is flushed into the draft when the
  // stage panel unmounts (switching Pre->Post), so a tab switch never loses the
  // edit; it persists on a later save.
  it("should keep a pending pre script when switching to the Post stage without blurring and persist it on save", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Script");

    await typeScriptNoBlur(/pre-request/i, "console.log('pending')");
    // No blur - switch the stage tab (unmounts the Pre panel).
    const stages = screen.getByRole("tablist", { name: /script stage/i });
    await user.click(within(stages).getByRole("tab", { name: "Post" }));
    expect(onTreeChange).not.toHaveBeenCalled();

    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).scripts?.pre).toBe(
      "console.log('pending')",
    );
  });

  // config-grid - behavior: editing the post-response script persists it on save
  // without clobbering the pre script.
  it("should persist a post-response script edit on save keeping pre", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Script");

    // the Script panel shows one stage at a time; switch to the Post tab first.
    const stages = screen.getByRole("tablist", { name: /script stage/i });
    await user.click(within(stages).getByRole("tab", { name: "Post" }));

    await setScript(/post-response/i, "after()");
    await fireSave(user);

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const scripts = savedConfig(onTreeChange).scripts;
    expect(scripts?.post).toBe("after()");
    expect(scripts?.pre).toBe("// pre");
  });
});
