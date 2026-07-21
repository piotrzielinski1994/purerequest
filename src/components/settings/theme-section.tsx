import { Button } from "@/components/ui/button";
import { RawJsonEditor } from "@/components/workspace/config-editor";
import { themeColorsJsonSchema } from "@/lib/config-schema/json-schemas";
import type {
  ThemeColorOverrides,
  ThemeColors,
  ThemeMode,
} from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/settings-context";
import { applyDefaults, diffOverrides } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

const MODES: { id: ThemeMode; label: string }[] = [
  { id: "light", label: "Light" },
  { id: "dark", label: "Dark" },
  { id: "system", label: "System" },
];

function isOverridesShape(value: unknown): value is ThemeColorOverrides {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return false;
  }
  const record = value as { tokens?: unknown; editor?: unknown };
  const isMap = (slot: unknown) =>
    typeof slot === "object" && slot !== null && !Array.isArray(slot);
  return isMap(record.tokens) && isMap(record.editor);
}

function parseThemeColors(text: string): ThemeColors | null {
  try {
    const parsed: unknown = JSON.parse(text);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    const record = parsed as { light?: unknown; dark?: unknown };
    if (!isOverridesShape(record.light) || !isOverridesShape(record.dark)) {
      return null;
    }
    return parsed as ThemeColors;
  } catch {
    return null;
  }
}

function ColorEditor() {
  const { settings, saveThemeColors } = useSettings();
  const effective = applyDefaults(settings.theme.colors, DEFAULT_THEME_COLORS);

  return (
    <RawJsonEditor
      id="theme-colors"
      saved={JSON.stringify(effective, null, 2)}
      parse={parseThemeColors}
      onSave={(parsed) =>
        saveThemeColors(diffOverrides(parsed, DEFAULT_THEME_COLORS))
      }
      commit={(_parsed, tree) => tree}
      schema={themeColorsJsonSchema}
    />
  );
}

// Fills the section body: fixed top matter (mode + copy), then the color editor
// grows to consume the rest of the height (no fixed cap - matches the request/
// folder editors that fill their pane).
export function ThemeSection() {
  const { settings, saveThemeMode } = useSettings();
  const mode = settings.theme.mode;

  return (
    <section className="flex h-full min-h-0 flex-col gap-1 p-6">
      <h2 className="text-lg font-medium">Theme</h2>
      <p className="text-sm text-muted-foreground">
        Choose the app appearance, or follow your OS preference.
      </p>
      <div className="mt-2 flex">
        {MODES.map((option) => {
          const isActive = mode === option.id;
          return (
            <Button
              key={option.id}
              type="button"
              variant={isActive ? "default" : "outline"}
              aria-pressed={isActive}
              className="border-0 border-l border-l-border first:border-l-0"
              onClick={() => saveThemeMode(option.id)}
            >
              {option.label}
            </Button>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-muted-foreground">
        Customize colors per mode. Each token shows its current value; edit a
        value to override it, or set it back to the default to clear the
        override. Save with the save shortcut.
      </p>
      <div className="mt-2 min-h-0 flex-1 border border-border">
        <ColorEditor />
      </div>
    </section>
  );
}
