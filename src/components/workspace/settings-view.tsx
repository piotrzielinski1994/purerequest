import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  PANE_TABS_LIST,
  PANE_TABS_TRIGGER,
} from "@/components/workspace/pane-tabs";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ThemeSection } from "@/components/settings/theme-section";
import { EnvSection } from "@/components/settings/env-section";
import { ShortcutsSection } from "@/components/settings/shortcuts-section";
import { useSettings } from "@/lib/settings/settings-context";
import {
  SETTINGS_SECTIONS,
  type SettingsSection,
} from "@/lib/settings/settings";

// The Settings content: a section sub-bar (Theme / Env / Shortcuts) mirroring the
// request-pane tab strip, with the active section persisted per-installation. The
// sub-bar is fixed; each section owns its own fill/scroll (like the folder pane's
// tabs) so a long section body can never push the bar off-screen.
export function SettingsView() {
  const { settings, saveSettingsSection } = useSettings();
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
            <ShortcutsSection />
          </div>
        </ScrollArea>
      </TabsContent>
    </Tabs>
  );
}
