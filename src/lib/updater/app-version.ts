import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";

// The version shown when running outside a Tauri host (dev browser / jsdom),
// where getVersion() would throw.
const FALLBACK_VERSION = "dev";

export function getAppVersion(): Promise<string> {
  if (!isTauri()) {
    return Promise.resolve(FALLBACK_VERSION);
  }
  return getVersion();
}
