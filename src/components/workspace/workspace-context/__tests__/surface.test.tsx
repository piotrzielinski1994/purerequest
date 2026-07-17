import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";

import {
  WorkspaceProvider,
  useWorkspace,
} from "@/components/workspace/workspace-context";
import { ToastProvider } from "@/components/ui/toast";

// The full public member set of the context value. This pins the surface so the
// module split can't silently drop, rename, or add a member.
const EXPECTED_MEMBERS = [
  "tree",
  "isWorkspaceWritable",
  "consoleLines",
  "clearConsole",
  "expandedFolderIds",
  "selectedNodeId",
  "selectedIds",
  "openRequestIds",
  "activeRequestId",
  "activeRequestTab",
  "activeResponseTab",
  "requestsById",
  "activeRequest",
  "effectiveConfig",
  "responseState",
  "environmentNames",
  "activeEnvironment",
  "setActiveEnvironment",
  "processEnv",
  "rootProcessEnv",
  "envText",
  "editTarget",
  "isEditorActive",
  "openConfigEditor",
  "closeEditor",
  "saveNodeConfig",
  "saveFolder",
  "saveFolderConfigDoc",
  "setFolderEnvColor",
  "activeAccentColor",
  "saveRequestNode",
  "saveActiveRequest",
  "saveActive",
  "dirtyRequestIds",
  "saveEnv",
  "setTokenValue",
  "revealTokenSource",
  "revealTarget",
  "paramsReveal",
  "registerActiveEditor",
  "saveActiveEditor",
  "editorDirty",
  "pendingClose",
  "popupCanSave",
  "requestCloseRequest",
  "requestCloseOthers",
  "requestCloseAll",
  "requestCloseEditor",
  "confirmPendingClose",
  "savePendingClose",
  "cancelPendingClose",
  "isSettingsOpen",
  "isSettingsActive",
  "toggleFolder",
  "collapseAllFolders",
  "expandAllFolders",
  "selectNode",
  "focusNode",
  "revealNode",
  "revealRowId",
  "consumeRevealRow",
  "selectInTree",
  "clearSelection",
  "setActiveRequest",
  "reorderRequests",
  "moveNode",
  "moveNodes",
  "closeRequest",
  "closeAllRequests",
  "renamingNodeId",
  "beginRename",
  "commitRename",
  "cancelRename",
  "newFolder",
  "duplicateNode",
  "pendingDelete",
  "requestDeleteNode",
  "confirmPendingDelete",
  "cancelPendingDelete",
  "setRequestBody",
  "setRequestBodyMode",
  "setRequestForm",
  "setRequestGraphqlQuery",
  "setRequestGraphqlVariables",
  "setRequestUrl",
  "setRequestMethod",
  "setRequestPathParams",
  "setRequestQueryParams",
  "setRequestConfig",
  "sendRequest",
  "cancelRequest",
  "setRequestTab",
  "setResponseTab",
  "openSettings",
  "closeSettings",
  "newRequest",
  "resolveActiveWire",
  "isCodeGenOpen",
  "openCodeGen",
  "closeCodeGen",
  "isCurlImportOpen",
  "openCurlImport",
  "closeCurlImport",
  "importCurl",
  "importBruno",
  "importPostman",
  "importOpenapi",
  "exportBruno",
  "focusUrlNonce",
  "pendingPanelFocus",
  "requestPanelFocus",
  "consumePanelFocus",
  "registerPanelGroup",
  "getPanelGroup",
] as const;

describe("workspace-context public surface", () => {
  it("should expose exactly the expected member set from useWorkspace", () => {
    let captured: ReturnType<typeof useWorkspace> | null = null;
    function Probe() {
      captured = useWorkspace();
      return null;
    }
    render(
      <ToastProvider>
        <WorkspaceProvider>
          <Probe />
        </WorkspaceProvider>
      </ToastProvider>,
    );

    expect(captured).not.toBeNull();
    const value = captured as unknown as Record<string, unknown>;
    expect(Object.keys(value).sort()).toEqual([...EXPECTED_MEMBERS].sort());
  });
});
