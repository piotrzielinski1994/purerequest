import type { WindowController } from "@pziel/pureui";
import { useWindowFullscreenSync } from "@pziel/pureui";
import { useSettings } from "@/lib/settings/settings-context";

// Mount-only bridge: feeds the persisted `windowFullscreen` flag + its saver into
// the sync hook. Renders nothing. Lives inside the SettingsProvider.
export function WindowFullscreenSync({
  controller,
}: {
  controller: WindowController;
}) {
  const { settings, saveWindowFullscreen } = useSettings();
  useWindowFullscreenSync({
    controller,
    saved: settings.windowFullscreen,
    onSave: saveWindowFullscreen,
  });
  return null;
}
