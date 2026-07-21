import type { ThemeMode } from "@/lib/settings/settings";
import { resolveEffectiveMode } from "@/lib/theme/effective-mode";

const LABEL: Record<ThemeMode, string> = {
  light: "Light",
  dark: "Dark",
  system: "System",
};

// The toast shown when the theme is toggled. For `system` it spells out the
// resolved scheme so switching System->Dark on an already-dark OS still reads as
// a clear, distinct message.
export function themeToggleMessage(
  mode: ThemeMode,
  prefersDark: boolean,
): string {
  if (mode === "system") {
    return `Theme: System (${resolveEffectiveMode("system", prefersDark)})`;
  }
  return `Theme: ${LABEL[mode]}`;
}
