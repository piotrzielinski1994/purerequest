import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { Content } from "@/components/workspace/content";
import { ResponsePane } from "@/components/workspace/response-pane";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { RESPONSE_RENDER_LIMIT_BYTES } from "@/lib/http/format";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import type { RequestResponse } from "@/lib/workspace/model";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";
import { fixtureTree } from "./fixtures";

function OpenSettingsButton() {
  const { openSettings } = useWorkspace();
  return (
    <button type="button" onClick={() => openSettings()}>
      open settings
    </button>
  );
}

function renderContent() {
  const store = createInMemorySettingsStore({
    ...DEFAULT_SETTINGS,
    shortcuts: {},
  });
  render(
    <SettingsProvider store={store}>
      <WorkspaceProvider
        tree={fixtureTree}
        initialExpandedIds={["folder-auth", "folder-oauth"]}
        initialActiveRequestId="req-profile"
      >
        <OpenSettingsButton />
        <Content />
      </WorkspaceProvider>
    </SettingsProvider>,
  );
  return userEvent.setup();
}

function SendButton() {
  const { activeRequestId, sendRequest } = useWorkspace();
  return (
    <button
      type="button"
      onClick={() => {
        if (activeRequestId !== null) {
          sendRequest(activeRequestId);
        }
      }}
    >
      probe send
    </button>
  );
}

function renderResponseWith(response: RequestResponse) {
  const client: FakeHttpClient = createFakeHttpClient({ ok: true, response });
  render(
    <WorkspaceProvider
      tree={fixtureTree}
      initialExpandedIds={["folder-auth", "folder-oauth"]}
      initialActiveRequestId="req-token"
      httpClient={client}
    >
      <SendButton />
      <ResponsePane />
    </WorkspaceProvider>,
  );
  return userEvent.setup();
}

function isInsideScrollArea(el: Element | null): boolean {
  return el?.closest('[data-slot="scroll-area"]') != null;
}

describe("Settings body routes through ScrollArea (AC-003)", () => {
  // TC-004 - behavior: the settings scroll container is a ScrollArea, not a bare overflow-auto div.
  it("should render the settings body inside a data-slot scroll-area if settings is active", async () => {
    const user = renderContent();

    await user.click(
      await screen.findByRole("button", { name: /open settings/i }),
    );
    await user.click(await screen.findByRole("tab", { name: /shortcut/i }));

    const heading = await screen.findByRole("heading", {
      name: /keyboard shortcuts/i,
    });
    expect(isInsideScrollArea(heading)).toBe(true);
  });

  // TC-004 - side-effect-contract: the old bare overflow-auto container is gone.
  it("should not wrap the settings body in a bare overflow-auto div if settings is active", async () => {
    const user = renderContent();

    await user.click(
      await screen.findByRole("button", { name: /open settings/i }),
    );
    await user.click(await screen.findByRole("tab", { name: /shortcut/i }));

    const heading = await screen.findByRole("heading", {
      name: /keyboard shortcuts/i,
    });
    // Walk up from the heading: the scroll container must be a scroll-area
    // viewport, not a plain <div class="... overflow-auto ..."> that owns the
    // native bar.
    const bareOverflow = heading.closest("div.overflow-auto");
    const isBareOverflowOutsideScrollArea =
      bareOverflow != null && !isInsideScrollArea(bareOverflow);
    expect(isBareOverflowOutsideScrollArea).toBe(false);
  });
});

describe("TooLargeBody routes through ScrollArea (AC-003)", () => {
  // TC-005 - behavior: the over-limit preview <pre> sits inside a ScrollArea.
  it("should render the too-large preview pre inside a data-slot scroll-area if the body exceeds the limit", async () => {
    const hugeBody = "x".repeat(RESPONSE_RENDER_LIMIT_BYTES + 1);
    const user = renderResponseWith({
      status: 200,
      timeMs: 5,
      sizeBytes: hugeBody.length,
      body: hugeBody,
      headers: [],
    });

    await user.click(screen.getByRole("button", { name: /probe send/i }));

    await screen.findByText(/too large|showing the first/i);
    const preview = document.querySelector<HTMLElement>("pre");
    expect(preview).not.toBeNull();
    expect(isInsideScrollArea(preview)).toBe(true);
  });
});

describe("ResponseBody JSON viewer routes through ScrollArea (AC-003)", () => {
  // TC-006 - behavior: the JSON-viewer wrapper for an under-limit body is a ScrollArea.
  it("should render the JSON viewer wrapper as a data-slot scroll-area if the body is valid JSON under the limit", async () => {
    const smallBody = JSON.stringify({ args: { foo: "bar" } }, null, 2);
    const user = renderResponseWith({
      status: 200,
      timeMs: 5,
      sizeBytes: smallBody.length,
      body: smallBody,
      headers: [],
    });

    await user.click(screen.getByRole("button", { name: /probe send/i }));

    await screen.findByText("200");
    const editor = await screen.findByText(
      (_, node) => node?.classList.contains("cm-editor") ?? false,
    );
    expect(isInsideScrollArea(editor)).toBe(true);
  });
});
