import type {
  AppTokenName,
  ThemeColorOverrides,
} from "@/lib/settings/settings";
import { APP_TOKENS } from "@/lib/theme/theme-defaults";

function cssVarName(token: AppTokenName): string {
  return `--${token}`;
}

// Apply the active mode's app-token overrides as inline CSS vars on `el`. An
// inline var beats both the `:root` and `.dark` stylesheet rules, so only the
// overridden tokens need writing; every app-token var NOT present in `colors` is
// cleared so a stale override from a previous mode/colors doesn't linger. `mode`
// is accepted for caller symmetry (the active effective mode) but the var names
// are mode-agnostic.
export function applyThemeVars(
  el: HTMLElement,
  _mode: "light" | "dark",
  colors: ThemeColorOverrides,
): void {
  for (const token of APP_TOKENS) {
    const value = colors.tokens[token];
    if (value === undefined) {
      el.style.removeProperty(cssVarName(token));
      continue;
    }
    el.style.setProperty(cssVarName(token), value);
  }
}
