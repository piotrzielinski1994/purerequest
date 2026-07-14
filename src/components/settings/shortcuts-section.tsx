import { ShortcutRow } from "@/components/settings/shortcut-row";
import { useSettings } from "@/lib/settings/settings-context";
import { resolveShortcuts } from "@/lib/shortcuts/resolve";
import { SHORTCUT_ACTIONS } from "@/lib/shortcuts/registry";

export function ShortcutsSection() {
  const { settings } = useSettings();
  const effective = resolveShortcuts(settings.shortcuts);

  return (
    <section className="flex flex-col gap-1">
      <h2 className="text-lg font-medium">Keyboard Shortcuts</h2>
      <p className="text-sm text-muted-foreground">
        Press Add and type a combination to bind it; an action can have several.
        Remove the × on a binding to drop it (removing the last one disables the
        action). Escape cancels recording, so it cannot be assigned.
      </p>
      <div className="mt-2 divide-y">
        {SHORTCUT_ACTIONS.map((action) => (
          <ShortcutRow
            key={action.id}
            action={action}
            bindings={effective[action.id]}
            effective={effective}
            hasOverride={action.id in settings.shortcuts}
          />
        ))}
      </div>
    </section>
  );
}
