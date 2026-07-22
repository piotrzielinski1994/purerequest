import {
  ThemeProvider as BaseThemeProvider,
  type ThemeContextValue,
  useTheme as useBaseTheme,
  useThemeOptional as useBaseThemeOptional,
} from "@pziel/pureui";
import type { ReactNode } from "react";
import type { ThemeColors } from "@/lib/settings/settings";
import { useSettings } from "@/lib/settings/settings-context";
import { applyThemeVars } from "@/lib/theme/apply-vars";
import { applyDefaults } from "@/lib/theme/overrides";
import { DEFAULT_THEME_COLORS } from "@/lib/theme/theme-defaults";

const computeEffectiveColors = (colors: ThemeColors): ThemeColors =>
  applyDefaults(colors, DEFAULT_THEME_COLORS);

// Thin wrapper over pureui's generic ThemeProvider: wires this app's settings +
// color subsystem (savers, inline-var writer, defaults merge) into the shared
// provider that owns mode resolution and the `.dark` toggle.
export function ThemeProvider({ children }: { children: ReactNode }) {
  const { settings, saveThemeMode, saveThemeColors } = useSettings();
  return (
    <BaseThemeProvider<ThemeColors>
      mode={settings.theme.mode}
      colors={settings.theme.colors}
      setMode={saveThemeMode}
      setColors={saveThemeColors}
      computeEffectiveColors={computeEffectiveColors}
      applyVars={applyThemeVars}
    >
      {children}
    </BaseThemeProvider>
  );
}

// Re-typed to this app's ThemeColors so the 12 call sites keep their concrete
// context type without importing pureui's generic directly.
export function useTheme(): ThemeContextValue<ThemeColors> {
  return useBaseTheme<ThemeColors>();
}

export function useThemeOptional(): ThemeContextValue<ThemeColors> | null {
  return useBaseThemeOptional<ThemeColors>();
}
