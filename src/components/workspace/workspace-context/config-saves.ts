import type { PersistApi } from "@/components/workspace/workspace-context/persist";
import type { WorkspaceInternals } from "@/components/workspace/workspace-context/types";
import type { ConfigScope } from "@/lib/workspace/model";
import { updateNodeConfig } from "@/lib/workspace/update-config";
import { updateFolderDotenv } from "@/lib/workspace/update-folder-dotenv";
import {
  setFolderEnvironmentColors,
  updateFolderEnvColor,
} from "@/lib/workspace/update-folder-env-color";

export type ConfigSavesApi = {
  saveNodeConfig: (id: string, config: ConfigScope) => void;
  saveFolder: (id: string, config: ConfigScope, dotenv: string) => void;
  saveFolderConfigDoc: (
    id: string,
    config: ConfigScope,
    colors: Record<string, string>,
  ) => void;
  setFolderEnvColor: (
    folderId: string,
    env: string,
    color: string | null,
  ) => void;
};

export function createConfigSaves(
  internals: WorkspaceInternals,
  persistTree: PersistApi["persistTree"],
): ConfigSavesApi {
  const { tree } = internals;

  const saveNodeConfig = (id: string, config: ConfigScope) =>
    persistTree(updateNodeConfig(tree, id, config), "config");

  // Folder Settings JSON save: the doc merges env colors into `environments`, so
  // persist BOTH the folder's config AND its whole env-color map in one write
  // (the JSON editor is the one place both are edited together).
  const saveFolderConfigDoc = (
    id: string,
    config: ConfigScope,
    colors: Record<string, string>,
  ) =>
    persistTree(
      setFolderEnvironmentColors(
        updateNodeConfig(tree, id, config),
        id,
        colors,
      ),
      "config",
    );

  // Folder pane save: persist the folder's config AND its own `.env` in ONE
  // tree write so the Env tab's two sub-views can't clobber each other.
  const saveFolder = (id: string, config: ConfigScope, dotenv: string) =>
    persistTree(
      updateFolderDotenv(updateNodeConfig(tree, id, config), id, dotenv),
      "config",
    );

  // Live color write: persists immediately (outside the folder pane Cmd+S draft)
  // so the border updates on pick and a color change never clobbers unsaved var
  // edits buffered in the draft.
  const setFolderEnvColor = (
    folderId: string,
    env: string,
    color: string | null,
  ) => persistTree(updateFolderEnvColor(tree, folderId, env, color), "accent");

  return { saveNodeConfig, saveFolder, saveFolderConfigDoc, setFolderEnvColor };
}
