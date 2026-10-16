import React from "react";
import type { IconGlyph } from "./types";

const TAG_RE = /<\/?([a-z][\w:-]*)\b((?:[^>"']|"[^"]*"|'[^']*')*)>/gi;
const ATTR_RE = /([a-z][\w:-]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/gi;
// The outer <svg> is replaced by the icon component; these carry no drawing of their own.
const IGNORED_TAGS = new Set(["svg", "title", "desc"]);
const PATH_ATTRS = new Set(["d", "fill-rule", "clip-rule"]);

export interface ParsedSvg {
  paths: { d: string; fillRule?: string; clipRule?: string }[];
  /** Markup this parser cannot draw; anything listed would be silently missing from the icon. */
  unsupported: string[];
}

function attributes(source: string): Record<string, string> {
  const attrs: Record<string, string> = {};
  for (const [, name, double, single] of source.matchAll(ATTR_RE)) attrs[name.toLowerCase()] = double ?? single;
  return attrs;
}

/** Monochrome icon sets draw with currentColor, so only path geometry is kept; any other markup is reported. */
export function parseSvg(raw: string): ParsedSvg {
  const parsed: ParsedSvg = { paths: [], unsupported: [] };
  for (const [tagSource, rawTag, rawAttrs] of raw.matchAll(TAG_RE)) {
    const tag = rawTag.toLowerCase();
    if (tagSource.startsWith("</") || IGNORED_TAGS.has(tag)) continue;
    if (tag !== "path") {
      parsed.unsupported.push(tag);
      continue;
    }
    const attrs = attributes(rawAttrs);
    const extra = Object.keys(attrs).filter((name) => !PATH_ATTRS.has(name));
    if (extra.length) parsed.unsupported.push(...extra.map((name) => `path[${name}]`));
    else if (!attrs.d?.trim()) parsed.unsupported.push("path[empty d]");
    else parsed.paths.push({ d: attrs.d, fillRule: attrs["fill-rule"], clipRule: attrs["clip-rule"] });
  }
  if (!parsed.paths.length) parsed.unsupported.push("no paths");
  return parsed;
}

function toNode({ paths }: ParsedSvg): React.ReactElement[] {
  return paths.map(({ d, fillRule, clipRule }, key) =>
    React.createElement("path", {
      key,
      d,
      fillRule: fillRule as React.SVGAttributes<SVGPathElement>["fillRule"],
      clipRule,
    }),
  );
}

export function svgGlyph(raw: string, filledRaw?: string): IconGlyph {
  const outline = parseSvg(raw);
  const filled = filledRaw === undefined ? undefined : parseSvg(filledRaw);
  const issues = [...outline.unsupported, ...(filled?.unsupported ?? [])];
  return {
    node: toNode(outline),
    filledNode: filled && toNode(filled),
    ...(issues.length ? { issues } : {}),
  };
}
