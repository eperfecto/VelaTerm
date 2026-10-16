//! Low-saturation outline file icons for the Files panel, reusing components/Icons.tsx and coloring by type.
//!
//! - Replaces the removed vscode-icons packages with project-native outlines and muted `--c-*`
//!   colors from vlinx.css for a consistent dark-theme appearance.
//! - `fileIcon(name, isDir, open)` maps exact names before extensions. Directories switch between
//!   folder and folderOpen; unmatched files fall back to file and faint.
//! - `icon` names keys in Icons.tsx and `color` names a vlinx.css variable. Apply color to the outer
//!   element because the icons stroke with currentColor; see RightPanel's renderFileIcon.

import type { IconName } from "../../icons/names";

// Muted type colors, backed by light- and dark-theme `--c-*` variables in vlinx.css.
const BLUE = "var(--c-blue)";
const YELLOW = "var(--c-yellow)";
const CYAN = "var(--c-cyan)";
const MAG = "var(--c-mag)";
const RED = "var(--c-red)";
const GREEN = "var(--c-green)";
const DIM = "var(--c-dim)";
const FAINT = "var(--c-faint)";

export interface FileIconSpec {
  /** Icon name from icons/names.ts. */
  icon: IconName;
  /** CSS color from a vlinx.css `--c-*` variable. */
  color: string;
}

// Lowercase extension without a dot -> icon and color.
const EXT: Record<string, FileIconSpec> = {
  // ── Languages (code icon) ──
  ts: { icon: "code", color: BLUE }, mts: { icon: "code", color: BLUE }, cts: { icon: "code", color: BLUE },
  tsx: { icon: "code", color: BLUE },
  js: { icon: "code", color: YELLOW }, mjs: { icon: "code", color: YELLOW }, cjs: { icon: "code", color: YELLOW },
  jsx: { icon: "code", color: YELLOW },
  rs: { icon: "code", color: RED },
  py: { icon: "code", color: BLUE },
  go: { icon: "code", color: CYAN },
  java: { icon: "code", color: RED }, kt: { icon: "code", color: RED }, kts: { icon: "code", color: RED },
  c: { icon: "code", color: BLUE }, h: { icon: "code", color: BLUE },
  cpp: { icon: "code", color: BLUE }, cc: { icon: "code", color: BLUE }, hpp: { icon: "code", color: BLUE },
  rb: { icon: "code", color: RED }, php: { icon: "code", color: MAG }, swift: { icon: "code", color: RED },
  lua: { icon: "code", color: BLUE },
  vue: { icon: "code", color: GREEN }, svelte: { icon: "code", color: RED },
  sh: { icon: "code", color: GREEN }, bash: { icon: "code", color: GREEN }, zsh: { icon: "code", color: GREEN }, fish: { icon: "code", color: GREEN },
  ps1: { icon: "code", color: BLUE },
  // ── Data and configuration ──
  json: { icon: "braces", color: YELLOW }, jsonc: { icon: "braces", color: YELLOW }, json5: { icon: "braces", color: YELLOW },
  yaml: { icon: "braces", color: MAG }, yml: { icon: "braces", color: MAG },
  toml: { icon: "hash", color: MAG }, ini: { icon: "hash", color: DIM },
  conf: { icon: "hash", color: DIM }, cfg: { icon: "hash", color: DIM }, properties: { icon: "hash", color: DIM }, env: { icon: "hash", color: DIM },
  xml: { icon: "code", color: DIM },
  sql: { icon: "database", color: BLUE }, db: { icon: "database", color: DIM }, sqlite: { icon: "database", color: DIM }, sqlite3: { icon: "database", color: DIM },
  // ── Styles ──
  css: { icon: "hash", color: BLUE }, scss: { icon: "hash", color: MAG }, sass: { icon: "hash", color: MAG },
  less: { icon: "hash", color: BLUE }, styl: { icon: "hash", color: GREEN },
  // ── Markup and documents ──
  html: { icon: "code", color: RED }, htm: { icon: "code", color: RED },
  md: { icon: "docLines", color: BLUE }, mdx: { icon: "docLines", color: BLUE }, markdown: { icon: "docLines", color: BLUE },
  txt: { icon: "docLines", color: FAINT }, text: { icon: "docLines", color: FAINT }, log: { icon: "docLines", color: FAINT },
  // ── Media ──
  pdf: { icon: "docLines", color: RED },
  doc: { icon: "docLines", color: BLUE }, docx: { icon: "docLines", color: BLUE }, odt: { icon: "docLines", color: BLUE }, rtf: { icon: "docLines", color: BLUE },
  xls: { icon: "spreadsheet", color: GREEN }, xlsx: { icon: "spreadsheet", color: GREEN }, csv: { icon: "spreadsheet", color: GREEN }, ods: { icon: "spreadsheet", color: GREEN },
  ppt: { icon: "presentation", color: RED }, pptx: { icon: "presentation", color: RED }, odp: { icon: "presentation", color: RED },
  mp3: { icon: "music", color: MAG }, wav: { icon: "music", color: MAG }, flac: { icon: "music", color: MAG }, m4a: { icon: "music", color: MAG }, ogg: { icon: "music", color: MAG },
  mp4: { icon: "video", color: MAG }, mov: { icon: "video", color: MAG }, webm: { icon: "video", color: MAG }, mkv: { icon: "video", color: MAG }, avi: { icon: "video", color: MAG },
  tif: { icon: "image", color: GREEN }, tiff: { icon: "image", color: GREEN }, heic: { icon: "image", color: GREEN },
  svg: { icon: "image", color: GREEN },
  png: { icon: "image", color: GREEN }, jpg: { icon: "image", color: GREEN }, jpeg: { icon: "image", color: GREEN },
  gif: { icon: "image", color: GREEN }, webp: { icon: "image", color: GREEN }, bmp: { icon: "image", color: GREEN },
  ico: { icon: "image", color: GREEN }, avif: { icon: "image", color: GREEN },
  ttf: { icon: "font", color: MAG }, otf: { icon: "font", color: MAG }, woff: { icon: "font", color: MAG }, woff2: { icon: "font", color: MAG }, eot: { icon: "font", color: MAG },
  // ── Archives ──
  zip: { icon: "fileArchive", color: DIM }, tar: { icon: "fileArchive", color: DIM }, gz: { icon: "fileArchive", color: DIM }, tgz: { icon: "fileArchive", color: DIM },
  rar: { icon: "fileArchive", color: DIM }, "7z": { icon: "fileArchive", color: DIM }, bz2: { icon: "fileArchive", color: DIM }, xz: { icon: "fileArchive", color: DIM }, zst: { icon: "fileArchive", color: DIM },
};

// Lowercase exact filename -> icon and color; special names take precedence over extensions.
const NAME: Record<string, FileIconSpec> = {
  "package.json": { icon: "braces", color: YELLOW },
  "package-lock.json": { icon: "lock", color: DIM },
  "pnpm-lock.yaml": { icon: "lock", color: DIM },
  "yarn.lock": { icon: "lock", color: DIM },
  "cargo.toml": { icon: "braces", color: RED },
  "cargo.lock": { icon: "lock", color: DIM },
  "tsconfig.json": { icon: "braces", color: CYAN },
  "tsconfig.node.json": { icon: "braces", color: CYAN },
  dockerfile: { icon: "code", color: CYAN },
  makefile: { icon: "hash", color: DIM },
  ".gitignore": { icon: "git", color: FAINT },
  ".gitattributes": { icon: "git", color: FAINT },
  ".gitmodules": { icon: "git", color: FAINT },
  "readme.md": { icon: "docLines", color: BLUE },
  license: { icon: "file", color: DIM },
  "license.md": { icon: "file", color: DIM },
};

const DIR_CLOSED: FileIconSpec = { icon: "folder", color: DIM };
const DIR_OPEN: FileIconSpec = { icon: "folderOpen", color: DIM };
const DEFAULT_FILE: FileIconSpec = { icon: "file", color: FAINT };

/** Return an outline icon and muted color; directories switch between folder and folderOpen. */
export function fileIcon(name: string, isDir: boolean, open = false): FileIconSpec {
  if (isDir) return open ? DIR_OPEN : DIR_CLOSED;
  const lower = name.toLowerCase();
  if (NAME[lower]) return NAME[lower];
  if (lower.endsWith(".d.ts")) return { icon: "code", color: BLUE };
  const dot = lower.lastIndexOf(".");
  const ext = dot > 0 ? lower.slice(dot + 1) : "";
  return EXT[ext] ?? DEFAULT_FILE;
}
