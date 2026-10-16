import type { SessionKind } from "../types";

/** Session kinds whose terminal title (OSC 0/2) renames the session. Plain shells are excluded because they
 * rewrite the title on every prompt and would clobber names like "dev server". */
const TITLE_RENAMES_KINDS: SessionKind[] = ["claude"];

/** Titles an agent sets before it has a topic; they are not a rename. */
const DEFAULT_TITLES = new Set(["Claude Code"]);

const MAX_NAME_LENGTH = 80;

/** Claude's status glyphs: ✳ and similar stars when idle, a braille spinner while working. */
const STATUS_PREFIX = /^[\s\u2733\u2800-\u28FF✻✽✶✢]+/u;

/**
 * Turns a terminal title into a session name, or null when the title should not rename the session.
 * Claude prefixes its title with a status glyph; it is stripped so the name stays stable while the status
 * changes.
 */
export function sessionNameFromTitle(kind: SessionKind, title: string): string | null {
  if (!TITLE_RENAMES_KINDS.includes(kind)) return null;
  const stripped = title.replace(STATUS_PREFIX, "").trim();
  // Cap by code points so an emoji is never split into a lone surrogate.
  const name = Array.from(stripped).slice(0, MAX_NAME_LENGTH).join("").trim();
  if (!name || DEFAULT_TITLES.has(name)) return null;
  return name;
}
