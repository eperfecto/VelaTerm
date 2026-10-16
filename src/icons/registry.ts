import { classicTheme } from "./themes/classic";
import { fluentTheme } from "./themes/fluent";
import { materialTheme } from "./themes/material";
import type { IconName } from "./names";
import type { IconGlyph, IconTheme } from "./types";

export const ICON_THEMES = {
  classic: classicTheme,
  material: materialTheme,
  fluent: fluentTheme,
} satisfies Record<string, IconTheme>;

export type IconThemeId = keyof typeof ICON_THEMES;
export const ICON_THEME_IDS = Object.keys(ICON_THEMES) as IconThemeId[];
export const DEFAULT_ICON_THEME: IconThemeId = "classic";

export function normalizeIconTheme(value: unknown): IconThemeId {
  return typeof value === "string" && Object.prototype.hasOwnProperty.call(ICON_THEMES, value)
    ? (value as IconThemeId)
    : DEFAULT_ICON_THEME;
}

/** Returns the theme that actually draws `name`, so a Classic fallback keeps Classic's viewBox and stroke. */
export function resolveGlyph(theme: IconTheme, name: IconName): { theme: IconTheme; glyph: IconGlyph } {
  const glyph = theme.icons[name];
  return glyph ? { theme, glyph } : { theme: classicTheme, glyph: classicTheme.icons[name] };
}

export function resolveIcon(themeId: IconThemeId, name: IconName) {
  return resolveGlyph(ICON_THEMES[themeId] ?? classicTheme, name);
}
