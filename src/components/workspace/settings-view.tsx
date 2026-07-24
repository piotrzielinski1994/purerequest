import {
  ScrollArea,
  ShortcutsSection,
  Tabs,
  TabsContent,
  TabsList,
  TabsTrigger,
  useUpdater,
} from "@pziel/pureui";
import { EnvSection } from "@/components/settings/env-section";
import { ThemeSection } from "@/components/settings/theme-section";
import { UpdatesSection } from "@/components/settings/updates-section";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/settings-context";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";
import { findConflict, resolveShortcuts } from "@/lib/shortcuts/resolve";

function ShortcutSettings() {
  const {
    settings,
    addShortcut,
    removeShortcut,
    replaceShortcut,
    resetShortcut,
  } = useSettings();

  return (
    <ShortcutsSection
      actions={SHORTCUT_ACTIONS}
      effective={resolveShortcuts(settings.shortcuts)}
      overrides={settings.shortcuts}
      store={{
        add: addShortcut,
        remove: removeShortcut,
        replace: replaceShortcut,
        reset: resetShortcut,
      }}
      findConflict={findConflict}
      help={
        <>
          Press Add and type a combination to bind it; an action can have
          several. Remove the × on a binding to drop it (removing the last one
          disables the action). Escape cancels recording, so it cannot be
          assigned.
        </>
      }
    />
  );
}

// The Settings content: a section sub-bar (Theme / Env / Shortcuts) mirroring the
// request-pane tab strip, with the active section persisted per-installation. The
// sub-bar is fixed; each section owns its own fill/scroll (like the folder pane's
// tabs) so a long section body can never push the bar off-screen.
export function SettingsView() {
  const { settings, saveSettingsSection } = useSettings();
  const { controller, getVersion } = useUpdater();
  const stored = settings.settingsSection;
  // Coerce any stale/invalid persisted value to the first section.
  const section: SettingsSection =
    stored && SETTINGS_SECTIONS.includes(stored) ? stored : "theme";

  return (
    <Tabs
      value={section}
      onValueChange={(next) => saveSettingsSection(next as SettingsSection)}
      className="flex h-full flex-col gap-0"
    >
      <div className="flex h-10.25 items-stretch overflow-x-auto border-b bg-muted/30">
        <TabsList aria-label="Settings sections" className={PANE_TABS_LIST}>
          <TabsTrigger value="theme" className={PANE_TABS_TRIGGER}>
            Theme
          </TabsTrigger>
          <TabsTrigger value="env" className={PANE_TABS_TRIGGER}>
            Env
          </TabsTrigger>
          <TabsTrigger value="shortcuts" className={PANE_TABS_TRIGGER}>
            Shortcuts
          </TabsTrigger>
          <TabsTrigger value="updates" className={PANE_TABS_TRIGGER}>
            Updates
          </TabsTrigger>
        </TabsList>
      </div>
      <TabsContent value="theme" className="min-h-0 flex-1">
        <ThemeSection />
      </TabsContent>
      <TabsContent value="env" className="min-h-0 flex-1">
        <EnvSection />
      </TabsContent>
      <TabsContent value="shortcuts" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="max-w-3xl p-6">
            <ShortcutSettings />
          </div>
        </ScrollArea>
      </TabsContent>
      <TabsContent value="updates" className="min-h-0 flex-1">
        <ScrollArea className="h-full">
          <div className="max-w-3xl p-6">
            <UpdatesSection controller={controller} getVersion={getVersion} />
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
