import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { ConfigEditorForm } from "@/components/workspace/config-editor";
import { WorkspaceProvider } from "@/components/workspace/workspace-context";

// Regression: the Settings / folder / request raw-JSON config editor used the
// default basicSetup (line numbers ON) while every other editor turns them off.
// All editors now go through the shared CodeEditor wrapper, which pins
// lineNumbers:false - so the config editor must show NO line-number gutter.
describe("config editor gutter", () => {
  it("should not render a line-number gutter in the config editor", () => {
    const { container } = render(
      <WorkspaceProvider tree={[]}>
        <ConfigEditorForm
          id="folder-1"
          config={{ variables: [{ key: "a", value: "1" }] }}
        />
      </WorkspaceProvider>,
    );

    expect(container.querySelector(".cm-lineNumbers")).toBeNull();
  });
});
