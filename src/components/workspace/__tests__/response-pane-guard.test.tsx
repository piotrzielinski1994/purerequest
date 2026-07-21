import { EditorView } from "@codemirror/view";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { ResponsePane } from "@/components/workspace/response-pane";
import {
  useWorkspace,
  WorkspaceProvider,
} from "@/components/workspace/workspace-context";
import { RESPONSE_RENDER_LIMIT_BYTES } from "@/lib/http/format";
import type { RequestResponse } from "@/lib/workspace/model";
import { createFakeHttpClient, type FakeHttpClient } from "./fake-http-client";
import { fixtureTree } from "./fixtures";

function responseBodyText(): string {
  const editorEl = document.querySelector<HTMLElement>(".cm-editor");
  if (!editorEl) {
    throw new Error(".cm-editor not found");
  }
  const view = EditorView.findFromDOM(editorEl);
  if (!view) {
    throw new Error("live EditorView not found");
  }
  return view.state.doc.toString();
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

function renderWithResponse(response: RequestResponse) {
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

async function clickSend(user: ReturnType<typeof userEvent.setup>) {
  await user.click(screen.getByRole("button", { name: /probe send/i }));
}

const SMALL_BODY = JSON.stringify({ args: { foo: "bar" } }, null, 2);

describe("ResponsePane - formatted status row", () => {
  // AC-004 - behavior: the status row shows the formatted size, "512B" (no space).
  it("should show the size formatted with a unit and no space if a response lands", async () => {
    const user = renderWithResponse({
      status: 200,
      timeMs: 142,
      sizeBytes: 512,
      body: SMALL_BODY,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText("200");
    expect(screen.getByText("512B")).toBeInTheDocument();
    expect(screen.queryByText("512 B")).not.toBeInTheDocument();
  });

  // AC-004 - behavior: the status row shows the formatted time, e.g. "142ms".
  it("should show the duration formatted as 142ms if the time is sub-second", async () => {
    const user = renderWithResponse({
      status: 200,
      timeMs: 142,
      sizeBytes: 512,
      body: SMALL_BODY,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText("200");
    expect(screen.getByText("142ms")).toBeInTheDocument();
  });

  // AC-004 - behavior: a kilobyte-range size renders as KB, not raw bytes.
  it("should show the size as 2.0KB if the response is 2048 bytes", async () => {
    const user = renderWithResponse({
      status: 200,
      timeMs: 1523,
      sizeBytes: 2048,
      body: SMALL_BODY,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText("200");
    expect(screen.getByText("2.0KB")).toBeInTheDocument();
    expect(screen.getByText("1.52s")).toBeInTheDocument();
  });
});

describe("ResponsePane - big-body render guard", () => {
  // TC-004, AC-005 - behavior: a body over the limit shows a size notice.
  it("should show a too-large notice if the body exceeds the render limit", async () => {
    const hugeBody = "x".repeat(RESPONSE_RENDER_LIMIT_BYTES + 1);
    const user = renderWithResponse({
      status: 200,
      timeMs: 5,
      sizeBytes: hugeBody.length,
      body: hugeBody,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText("200");
    expect(
      screen.getByText(/too large|showing the first/i),
    ).toBeInTheDocument();
  });

  // TC-004, AC-005 - behavior: the filter input is gone for an over-limit body.
  it("should hide the filter input if the body exceeds the render limit", async () => {
    const hugeBody = "x".repeat(RESPONSE_RENDER_LIMIT_BYTES + 1);
    const user = renderWithResponse({
      status: 200,
      timeMs: 5,
      sizeBytes: hugeBody.length,
      body: hugeBody,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText(/too large|showing the first/i);
    expect(
      screen.queryByRole("textbox", { name: /filter response/i }),
    ).not.toBeInTheDocument();
  });

  // TC-004, AC-005 - behavior: the full huge string is not fed into the viewer.
  it("should not hand the full string to the viewer if the body exceeds the render limit", async () => {
    const hugeBody = "x".repeat(RESPONSE_RENDER_LIMIT_BYTES + 1);
    const user = renderWithResponse({
      status: 200,
      timeMs: 5,
      sizeBytes: hugeBody.length,
      body: hugeBody,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText(/too large|showing the first/i);
    // The full string must never reach the viewer: the JSON editor is not
    // mounted at all for an over-limit body, and the preview that IS rendered is
    // bounded to the render limit, shorter than the body.
    expect(document.querySelector(".cm-editor")).toBeNull();
    const preview = document.querySelector<HTMLElement>("pre");
    expect(preview).not.toBeNull();
    expect((preview?.textContent ?? "").length).toBeLessThan(hugeBody.length);
    expect((preview?.textContent ?? "").length).toBeLessThanOrEqual(
      RESPONSE_RENDER_LIMIT_BYTES,
    );
  });

  // TC-004, AC-005 - behavior: a body just under the limit renders fully + filter.
  it("should render the full body with the filter if the body is just under the limit", async () => {
    const underBody = JSON.stringify({
      blob: "y".repeat(RESPONSE_RENDER_LIMIT_BYTES - 1024),
    });
    const user = renderWithResponse({
      status: 200,
      timeMs: 5,
      sizeBytes: underBody.length,
      body: underBody,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText("200");
    expect(
      screen.getByRole("textbox", { name: /filter response/i }),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(responseBodyText().length).toBeGreaterThan(1024),
    );
  });

  // TC-005, AC-005 - behavior: a body exactly at the limit renders fully (inclusive).
  it("should render the full body with the filter if the body is exactly at the limit", async () => {
    const atBody = JSON.stringify({ b: "" });
    const overhead = atBody.length;
    const padded = "z".repeat(RESPONSE_RENDER_LIMIT_BYTES - overhead);
    const exactBody = JSON.stringify({ b: padded });
    expect(exactBody.length).toBe(RESPONSE_RENDER_LIMIT_BYTES);
    const user = renderWithResponse({
      status: 200,
      timeMs: 5,
      sizeBytes: exactBody.length,
      body: exactBody,
      headers: [],
    });

    await clickSend(user);

    await screen.findByText("200");
    expect(
      screen.getByRole("textbox", { name: /filter response/i }),
    ).toBeInTheDocument();
    expect(
      screen.queryByText(/too large|showing the first/i),
    ).not.toBeInTheDocument();
  });
});
