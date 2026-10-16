import type React from "react";
import type { I18nKey } from "../i18n";
import type { IconName } from "./names";

export interface IconGlyph {
  node: React.ReactNode;
  /** Solid variant used when a caller passes `fill`; stroke themes fill `node` instead. */
  filledNode?: React.ReactNode;
  /** Source markup the SVG parser had to drop; tests require this to be absent. */
  issues?: string[];
}

export interface IconTheme {
  id: string;
  label: I18nKey;
  viewBox: string;
  /** Stroke themes honour the `sw` prop; fill themes ignore it. */
  mode: "stroke" | "fill";
  icons: Partial<Record<IconName, IconGlyph>>;
}

/** The fallback theme must draw every icon, which TypeScript checks through this type. */
export interface CompleteIconTheme extends IconTheme {
  icons: Record<IconName, IconGlyph>;
}
