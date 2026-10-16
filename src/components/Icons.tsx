//! Themed UI icons: <Icons.terminal size={14} /> for a fixed icon, <Icon name={name} /> when the name is data.
//! The active icon theme picks the drawing; see src/icons/README.md.

import React from "react";
import { useActiveIconTheme } from "../icons/activeTheme";
import { ICON_NAMES, type IconName } from "../icons/names";
import { resolveIcon, type IconThemeId } from "../icons/registry";

export type { IconName } from "../icons/names";

const DEFAULT_ICON_SIZE = 16;
const DEFAULT_STROKE_WIDTH = 1.5;

export interface IconProps extends Omit<React.SVGProps<SVGSVGElement>, "fill"> {
  size?: number;
  /** Stroke width; ignored by fill themes. */
  sw?: number;
  /** When true, fill rather than stroke the icon, overriding SVGProps' string-valued fill. */
  fill?: boolean;
}

function renderIcon(
  themeId: IconThemeId,
  name: IconName,
  { size = DEFAULT_ICON_SIZE, sw = DEFAULT_STROKE_WIDTH, fill = false, ...p }: IconProps,
) {
  const { theme, glyph } = resolveIcon(themeId, name);
  if (theme.mode === "fill") {
    return (
      <svg width={size} height={size} viewBox={theme.viewBox} fill="currentColor" {...p}>
        {fill && glyph.filledNode ? glyph.filledNode : glyph.node}
      </svg>
    );
  }
  return (
    <svg
      width={size}
      height={size}
      viewBox={theme.viewBox}
      fill={fill ? "currentColor" : "none"}
      stroke={fill ? "none" : "currentColor"}
      strokeWidth={sw}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...p}
    >
      {glyph.node}
    </svg>
  );
}

/** Renders `name` in the active theme, or in `theme` when given (the theme picker previews each theme). */
export function Icon({ name, theme, ...props }: IconProps & { name: IconName; theme?: IconThemeId }) {
  const active = useActiveIconTheme((s) => s.id);
  return renderIcon(theme ?? active, name, props);
}

type IconComponent = (props: IconProps) => React.ReactElement;

function themedIcon(name: IconName): IconComponent {
  const ThemedIcon = (props: IconProps) => renderIcon(useActiveIconTheme((s) => s.id), name, props);
  ThemedIcon.displayName = `Icons.${name}`;
  return ThemedIcon;
}

const Icons = Object.fromEntries(ICON_NAMES.map((name) => [name, themedIcon(name)])) as Record<IconName, IconComponent>;

export default Icons;
export { Icons };
