import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { RequestPane } from "@/components/workspace/request-pane";
import { authForType } from "@/components/workspace/config-panels";
import { ToastProvider } from "@/components/ui/toast";
import type { ConfigScope, TreeNode } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

const baseConfig: ConfigScope = {
  variables: { token: "tok-123" },
  headers: [{ key: "Accept", value: "application/json" }],
  params: [{ key: "page", value: "1" }],
  auth: { type: "bearer", token: "secret" },
  scripts: { pre: "// pre", post: "" },
};

const tree: TreeNode[] = [
  {
    kind: "request",
    id: "req-1",
    name: "Req",
    method: "GET",
    url: "https://api/get",
    body: "",
    config: baseConfig,
  },
];

function renderPane(onTreeChange: OnTreeChange) {
  return render(
    <ToastProvider>
      <WorkspaceProvider
        tree={tree}
        initialActiveRequestId="req-1"
        onTreeChange={onTreeChange}
      >
        <RequestPane />
      </WorkspaceProvider>
    </ToastProvider>,
  );
}

const openTab = async (
  user: ReturnType<typeof userEvent.setup>,
  name: string,
) => {
  const tablist = screen.getByRole("tablist", { name: /request sections/i });
  await user.click(within(tablist).getByRole("tab", { name }));
};

const savedConfig = (onTreeChange: ReturnType<typeof vi.fn>): ConfigScope => {
  const calls = onTreeChange.mock.calls;
  const tree = calls[calls.length - 1][0] as TreeNode[];
  const node = tree.find((n) => n.id === "req-1");
  if (!node || node.kind !== "request") {
    throw new Error("req-1 not found");
  }
  return node.config;
};

describe("editable Headers/Params panel", () => {
  // config-grid - behavior: editing a header value commits on blur via saveNodeConfig.
  it("should persist a header value edit on blur", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    const valueInput = screen.getByDisplayValue("application/json");
    await user.clear(valueInput);
    await user.type(valueInput, "text/plain");
    await user.tab();

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "text/plain" },
    ]);
  });

  // config-grid - behavior: typing into the trailing blank row materializes a new
  // header (no Add-row button needed).
  it("should persist a new header row typed into the trailing blank row", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    // one real row (Accept) + the trailing blank => the blank's key input is "key 2".
    await user.type(screen.getByLabelText("key 2"), "X-New");
    await user.type(screen.getByLabelText("value 2"), "yes");
    await user.tab();

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "application/json" },
      { key: "X-New", value: "yes" },
    ]);
  });

  // config-grid - behavior: a typed-but-not-blurred edit is flushed when the
  // panel unmounts (tab switch), so switching tabs never loses the last keystroke.
  it("should persist a pending edit when switching tabs without blurring", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    await user.type(screen.getByLabelText("key 2"), "X-New");
    await user.type(screen.getByLabelText("value 2"), "yes");
    // No user.tab() / blur - switch straight to another tab (unmounts the panel).
    await openTab(user, "Vars");

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "application/json" },
      { key: "X-New", value: "yes" },
    ]);
  });

  // config-grid - behavior: removing a row drops it from the saved config.
  it("should persist removal of a param row", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Params");

    await user.click(screen.getByRole("button", { name: /remove page/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).params).toEqual([]);
  });

  // config-grid - behavior: unchecking the row toggle persists enabled:false.
  it("should persist enabled:false when a header is toggled off", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Headers");

    await user.click(screen.getByRole("checkbox", { name: /enable accept/i }));

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).headers).toEqual([
      { key: "Accept", value: "application/json", enabled: false },
    ]);
  });
});

describe("editable Vars panel", () => {
  // config-grid - behavior: editing a variable value persists it (Record form).
  it("should persist a variable value edit on blur", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Vars");

    const valueInput = screen.getByDisplayValue("tok-123");
    await user.clear(valueInput);
    await user.type(valueInput, "tok-999");
    await user.tab();

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).variables).toEqual({ token: "tok-999" });
  });
});

describe("editable Auth panel", () => {
  // config-grid - behavior: editing the bearer token persists it.
  it("should persist a bearer token edit on blur", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Auth");

    const token = screen.getByLabelText(/token/i);
    await user.clear(token);
    await user.type(token, "new-token");
    await user.tab();

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).auth).toEqual({
      type: "bearer",
      token: "new-token",
    });
  });

  // The auth TYPE switch is a radix Select; jsdom can't open its portal-rendered
  // options (see docs/learnings.md), so the dropdown selection path is covered by
  // manual testing. The seeding logic behind it is unit-tested via authForType
  // below; the per-type field edits (bearer token above) are exercised as inputs.
  it("should seed empty fields for the chosen auth type", () => {
    expect(authForType("none")).toEqual({ type: "none" });
    expect(authForType("inherit")).toEqual({ type: "inherit" });
    expect(authForType("bearer")).toEqual({ type: "bearer", token: "" });
    expect(authForType("basic")).toEqual({
      type: "basic",
      username: "",
      password: "",
    });
  });
});

describe("editable Script panel", () => {
  // config-grid - behavior: editing the pre-request script persists it.
  it("should persist a pre-request script edit on blur", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Script");

    const pre = screen.getByLabelText(/pre-request/i);
    await user.clear(pre);
    await user.type(pre, "console.log(1)");
    await user.tab();

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    expect(savedConfig(onTreeChange).scripts?.pre).toBe("console.log(1)");
  });

  // config-grid - behavior: editing the post-response script persists it without
  // clobbering the pre script.
  it("should persist a post-response script edit on blur keeping pre", async () => {
    const user = userEvent.setup();
    const onTreeChange = vi.fn<OnTreeChange>().mockResolvedValue({ ok: true });
    renderPane(onTreeChange);
    await openTab(user, "Script");

    const post = screen.getByLabelText(/post-response/i);
    await user.type(post, "after()");
    await user.tab();

    await waitFor(() => expect(onTreeChange).toHaveBeenCalled());
    const scripts = savedConfig(onTreeChange).scripts;
    expect(scripts?.post).toBe("after()");
    expect(scripts?.pre).toBe("// pre");
  });
});
