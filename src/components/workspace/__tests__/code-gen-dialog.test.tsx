import { describe, it, expect, vi } from "vitest";
import { render, screen, within, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EditorView } from "@codemirror/view";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { WorkspaceLayout } from "@/components/workspace/workspace-layout";
import { ToastProvider } from "@/components/ui/toast";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import type { RequestNode, TreeNode } from "@/lib/workspace/model";
import { authOf, emptyParams } from "@/lib/workspace/model";

type OnTreeChange = (
  tree: TreeNode[],
) => Promise<{ ok: true } | { ok: false; error: string }>;

// A POST request with a JSON body so the curl preview carries a --data-raw arg
// and the fetch preview carries a body. Mirrors curl-import-export.test.tsx.
const postWithBody: RequestNode = {
  kind: "request",
  id: "req-post",
  name: "create-widget",
  method: "POST",
  url: "https://api.example.com/widgets",
  body: {
    active: "json",
    types: {
      json: '{"name":"foo"}',
      form: [],
      multipart: [],
      graphql: { query: "", variables: "" },
    },
  },
  params: emptyParams(),
  config: {
    headers: [{ key: "X-Trace", value: "abc" }],
    auth: authOf({ active: "none" }),
  },
};

const exportTree: TreeNode[] = [postWithBody];

function renderShell(
  opts: {
    initialActiveRequestId?: string;
    onTreeChange?: OnTreeChange;
  } = {},
) {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  return render(
    <SettingsProvider store={store}>
      <ToastProvider>
        <WorkspaceProvider
          tree={exportTree}
          consoleLines={["[12:00:00] Ready."]}
          initialActiveRequestId={opts.initialActiveRequestId}
          onTreeChange={opts.onTreeChange}
        >
          <WorkspaceLayout />
        </WorkspaceProvider>
      </ToastProvider>
    </SettingsProvider>,
  );
}

async function runPaletteCommand(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
) {
  await user.keyboard("{Control>}k{/Control}");
  const dialog = await screen.findByRole("dialog");
  await user.click(within(dialog).getByText(name));
}

// Read the live preview text from the code-gen dialog's read-only CodeMirror
// surface (asserting the visible preview, not an implementation detail). CM6
// exposes the live view via findFromDOM; the doc string is the previewed code.
function previewCode(dialog: HTMLElement): string {
  const editorEl = dialog.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error("preview .cm-editor not found in dialog");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live preview EditorView not found");
  }
  return view.state.doc.toString();
}

// Open the palette, run Copy as code, and return the opened code-gen dialog
// (resolved via the Language select's enclosing dialog once the palette closes).
async function openCodeGen(
  user: ReturnType<typeof userEvent.setup>,
): Promise<HTMLElement> {
  await runPaletteCommand(user, /copy as code/i);
  const trigger = await screen.findByRole("combobox", { name: /language/i });
  const dialog = trigger.closest('[role="dialog"]');
  if (!dialog) {
    throw new Error("Language select is not inside a dialog");
  }
  return dialog as HTMLElement;
}

describe("Copy as code - palette command (AC-001)", () => {
  // AC-001, TC-007 - behavior: the palette lists "Copy as code" and no longer
  // lists the old "Copy as cURL" command.
  it("should list Copy as code and not Copy as cURL in the command palette", async () => {
    const user = userEvent.setup();
    renderShell({ initialActiveRequestId: "req-post" });
    await screen.findByRole("region", { name: /console/i });

    await user.keyboard("{Control>}k{/Control}");
    const dialog = await screen.findByRole("dialog");

    expect(within(dialog).getByText(/copy as code/i)).toBeInTheDocument();
    expect(within(dialog).queryByText(/copy as curl/i)).not.toBeInTheDocument();
  });
});

describe("Copy as code dialog - open + preview (AC-002, AC-003, AC-004)", () => {
  // AC-002/003/004, TC-007 - behavior: running the command with an active
  // request opens a dialog with a Language select defaulting to cURL and a
  // preview of the curl string.
  it("should open a dialog with a Language select defaulting to cURL and a curl preview", async () => {
    const user = userEvent.setup();
    renderShell({ initialActiveRequestId: "req-post" });
    await screen.findByRole("region", { name: /console/i });

    const dialog = await openCodeGen(user);

    // language select present + defaulting to cURL.
    const trigger = within(dialog).getByRole("combobox", { name: /language/i });
    expect(trigger).toHaveTextContent(/curl/i);

    // preview shows the generated curl for the active request's resolved wire.
    await waitFor(() => {
      expect(previewCode(dialog).startsWith("curl ")).toBe(true);
    });
    const code = previewCode(dialog);
    expect(code).toContain("-X POST");
    expect(code).toContain("--data-raw");
  });
});

describe("Copy as code dialog - Copy (AC-006)", () => {
  // AC-006, TC-007 - side-effect-contract: Copy writes the previewed curl to
  // the clipboard, toasts "Copied as cURL", and closes the dialog.
  it("should write the previewed curl to the clipboard, toast, and close on Copy", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderShell({ initialActiveRequestId: "req-post" });
    await screen.findByRole("region", { name: /console/i });

    const dialog = await openCodeGen(user);
    await waitFor(() => {
      expect(previewCode(dialog).startsWith("curl ")).toBe(true);
    });
    const previewed = previewCode(dialog);

    await user.click(within(dialog).getByRole("button", { name: /^copy$/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    // the clipboard gets exactly what the preview showed.
    expect(writeText.mock.calls[0][0]).toBe(previewed);
    expect(await screen.findByText(/copied as curl/i)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });

    writeText.mockRestore();
  });
});

describe("Copy as code dialog - switch language (AC-005)", () => {
  // AC-005, TC-008 - behavior + side-effect-contract: switching to
  // "JavaScript - fetch" changes the preview to a fetch(...) string, and Copy
  // then writes that fetch string.
  it("should switch the preview to a fetch string and copy it if JavaScript - fetch is selected", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderShell({ initialActiveRequestId: "req-post" });
    await screen.findByRole("region", { name: /console/i });

    const dialog = await openCodeGen(user);
    await waitFor(() => {
      expect(previewCode(dialog).startsWith("curl ")).toBe(true);
    });

    // open the Language select and pick fetch (options render in a portal).
    await user.click(within(dialog).getByRole("combobox", { name: /language/i }));
    await user.click(
      await screen.findByRole("option", { name: /javascript - fetch/i }),
    );

    // preview switches to a fetch call.
    await waitFor(() => {
      expect(previewCode(dialog)).toContain("fetch(");
    });
    const previewed = previewCode(dialog);
    expect(previewed).not.toContain("curl -X");

    await user.click(within(dialog).getByRole("button", { name: /^copy$/i }));

    await waitFor(() => {
      expect(writeText).toHaveBeenCalledTimes(1);
    });
    expect(writeText.mock.calls[0][0]).toBe(previewed);
    expect(writeText.mock.calls[0][0]).toContain("fetch(");

    writeText.mockRestore();
  });
});

describe("Copy as code - no active request (AC-002)", () => {
  // AC-002, TC-009 - side-effect-contract: running the command with no active
  // request opens no dialog and writes nothing to the clipboard.
  it("should open no dialog and write nothing if there is no active request", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderShell({});
    await screen.findByRole("region", { name: /console/i });

    await runPaletteCommand(user, /copy as code/i);

    // give any async path a chance, then assert nothing opened and nothing wrote.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(
      screen.queryByRole("combobox", { name: /language/i }),
    ).not.toBeInTheDocument();
    expect(writeText).not.toHaveBeenCalled();

    writeText.mockRestore();
  });
});

describe("Copy as code dialog - Cancel (AC-007)", () => {
  // AC-007, TC-010 - side-effect-contract: opening the dialog then Cancel writes
  // nothing to the clipboard and closes the dialog.
  it("should write nothing to the clipboard if the dialog is cancelled", async () => {
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    renderShell({ initialActiveRequestId: "req-post" });
    await screen.findByRole("region", { name: /console/i });

    const dialog = await openCodeGen(user);
    await user.click(within(dialog).getByRole("button", { name: /cancel/i }));

    await waitFor(() => {
      expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    });
    expect(writeText).not.toHaveBeenCalled();

    writeText.mockRestore();
  });
});
