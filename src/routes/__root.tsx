import {
  createAppVersionGetter,
  createNoopUpdateController,
  createNoopWindowController,
  createUpdateController,
  UpdateChecker,
  UpdaterProvider,
} from "@pziel/pureui";
import { createRootRoute, Link, Outlet } from "@tanstack/react-router";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { relaunch } from "@tauri-apps/plugin-process";
import { check } from "@tauri-apps/plugin-updater";
import { useState } from "react";
import { Toaster } from "@/components/ui/sonner";
import { isDevBrowser } from "@/lib/runtime/environment";
import { createInMemorySettingsStore } from "@/lib/settings/in-memory-store";
import { DEFAULT_SETTINGS } from "@/lib/settings/settings";
import { SettingsProvider } from "@/lib/settings/settings-context";
import { createTauriSettingsStore } from "@/lib/settings/tauri-store";
import { ThemeProvider } from "@/lib/theme/theme-context";
import { createSonnerUpdateToastSink } from "@/lib/updater/update-toast-sink";
import { createWindowController } from "@/lib/window/window-controller";
import { WindowFullscreenSync } from "@/lib/window/window-fullscreen-sync";
import { DEMO_WORKSPACE_PATH } from "@/lib/workspace/demo-seed";

function createSettingsStore() {
  if (isDevBrowser()) {
    return createInMemorySettingsStore({
      ...DEFAULT_SETTINGS,
      workspacePath: DEMO_WORKSPACE_PATH,
    });
  }
  return createTauriSettingsStore();
}

function createWindowControllerForEnv() {
  // Only the real Tauri host has a window to drive; the dev-browser AND the
  // jsdom test env (both non-Tauri) get the noop, so getCurrentWindow() - which
  // throws without a Tauri host - is never called outside the native build.
  return isTauri() ? createWindowController() : createNoopWindowController();
}

function createUpdateControllerForEnv() {
  // Same guard as the window controller: only the native host talks to the
  // updater/process plugins; dev-browser and jsdom get the noop (no network,
  // no plugin calls). The Tauri bindings are injected because pureui declares
  // no @tauri-apps dep.
  return isTauri()
    ? createUpdateController({ check, relaunch })
    : createNoopUpdateController();
}

const getAppVersion = createAppVersionGetter({ isTauri, getVersion });

function RootLayout() {
  const [settingsStore] = useState(createSettingsStore);
  const [windowController] = useState(createWindowControllerForEnv);
  const [updateController] = useState(createUpdateControllerForEnv);
  const [updateToastSink] = useState(createSonnerUpdateToastSink);

  return (
    <SettingsProvider store={settingsStore}>
      <WindowFullscreenSync controller={windowController} />
      <ThemeProvider>
        <UpdaterProvider
          controller={updateController}
          getVersion={getAppVersion}
        >
          <UpdateChecker controller={updateController} sink={updateToastSink} />
          <Outlet />
          <Toaster />
        </UpdaterProvider>
      </ThemeProvider>
    </SettingsProvider>
  );
}

function NotFound() {
  return (
    <div className="p-6">
      <h1 className="text-xl font-semibold">404 - Not found</h1>
      <p className="text-muted-foreground">
        The page you are looking for does not exist.
      </p>
      <Link to="/" className="underline">
        Go home
      </Link>
    </div>
  );
}

export const rootRoute = createRootRoute({
  component: RootLayout,
  notFoundComponent: NotFound,
});
