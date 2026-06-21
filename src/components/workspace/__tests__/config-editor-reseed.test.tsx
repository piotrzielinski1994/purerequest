import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import {
  ConfigEditorForm,
  RequestSettingsForm,
} from "@/components/workspace/config-editor";
import type { ConfigScope, RequestNode } from "@/lib/workspace/model";

function editorText(): string {
  const surface = document.querySelector<HTMLElement>(".cm-content");
  if (!surface) {
    throw new Error("editor surface (.cm-content) not found");
  }
  return surface.textContent ?? "";
}

const makeRequest = (config: ConfigScope): RequestNode => ({
  kind: "request",
  id: "req-1",
  name: "Req",
  method: "GET",
  url: "https://api/get",
  body: "",
  config,
});

describe("RequestSettingsForm re-seed", () => {
  // bug: the Settings editor used a once-only useState initializer, so when the
  // request prop changed identity-stably (same id, new config landed from a
  // sibling panel's save) the editor kept showing the stale snapshot until a
  // remount. It must re-seed from the new request on the same mount.
  it("should reflect the request's new config without a remount", () => {
    const { rerender } = render(
      <WorkspaceProvider tree={[makeRequest({})]} initialActiveRequestId="req-1">
        <RequestSettingsForm request={makeRequest({})} />
      </WorkspaceProvider>,
    );

    expect(editorText()).not.toContain("X-Seeded");

    rerender(
      <WorkspaceProvider tree={[makeRequest({})]} initialActiveRequestId="req-1">
        <RequestSettingsForm
          request={makeRequest({ headers: [{ key: "X-Seeded", value: "1" }] })}
        />
      </WorkspaceProvider>,
    );

    expect(editorText()).toContain("X-Seeded");
  });
});

describe("ConfigEditorForm re-seed", () => {
  // Same once-only-initializer bug on the folder config editor.
  it("should reflect a new config without a remount", () => {
    const { rerender } = render(
      <WorkspaceProvider
        tree={[makeRequest({})]}
        initialActiveRequestId="req-1"
      >
        <ConfigEditorForm id="folder-1" config={{}} />
      </WorkspaceProvider>,
    );

    expect(editorText()).not.toContain("X-Folder");

    rerender(
      <WorkspaceProvider
        tree={[makeRequest({})]}
        initialActiveRequestId="req-1"
      >
        <ConfigEditorForm
          id="folder-1"
          config={{ headers: [{ key: "X-Folder", value: "1" }] }}
        />
      </WorkspaceProvider>,
    );

    expect(editorText()).toContain("X-Folder");
  });
});
