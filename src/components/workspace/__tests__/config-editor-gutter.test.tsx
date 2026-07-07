import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import { ConfigEditorForm } from "@/components/workspace/config-editor";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";
import { ToastProvider } from "@/components/ui/toast";

// Regression: the Settings / folder / request raw-JSON config editor used the
// default basicSetup (line numbers ON) while every other editor turns them off.
// All editors now go through the shared CodeEditor wrapper, which pins
// lineNumbers:false - so the config editor must show NO line-number gutter.
describe("config editor gutter", () => {
  it("should not render a line-number gutter in the config editor", () => {
    const { container } = render(
      <ToastProvider>
        <WorkspaceProvider tree={[]}>
          <ConfigEditorForm
            id="folder-1"
            config={{ variables: [{ key: "a", value: "1" }] }}
          />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
  });
});
