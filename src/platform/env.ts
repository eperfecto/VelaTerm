//! Platform adapter environment detection (single source of truth).
//!
//! Answer consistently which shell/access mode is active. New code must read `env` (or `platform.env`) rather
//! than duplicating checks such as `__TAURI_INTERNALS__ in window`. Legacy references to isTauri/isRemoteWindow
//! from `ipc/transport.ts` can migrate here gradually because both derive from the same values.
//!
//! For now, three base booleans still come from `transport.ts`, where 21 legacy references remain. This module
//! derives kind, isElectron, and hasNativeHost on top to form the unified public view.

import { isElectronShell, isMac, isRemoteWindow, isTauri } from "../ipc/transport";
import type { PlatformEnv, PlatformKind } from "./types";

/**
 * Whether the app runs inside the Electron shell.
 *
 * The Electron shell was not yet implemented when this detection point was reserved (overall plan §3.2 / phase
 * 2). Its preload bridge injects `window.__VLX_ELECTRON__`, with `Electron/` in the UA as a fallback.
 */
export const isElectron: boolean =
  typeof window !== "undefined" &&
  (isElectronShell ||
    (typeof navigator !== "undefined" && /Electron\//.test(navigator.userAgent || "")));

/** Derive shell kind: Electron first, then Tauri, otherwise remote browser access. */
function deriveKind(): PlatformKind {
  if (isElectron) return "electron";
  if (isTauri) return "tauri";
  return "browser";
}

/**
 * Whether this is a development run, using a unified cross-shell signal:
 * - Tauri/browser: `import.meta.env.DEV` is true while the Vite development server runs.
 * - Electron: the frontend always loads bundled output (DEV remains false), so read the main-process signal
 *   injected through preload.
 *   `__VLX_ELECTRON_DEV__`（= `!app.isPackaged`）。
 */
export const isDev: boolean =
  !!import.meta.env?.DEV ||
  (typeof window !== "undefined" &&
    !!(window as unknown as { __VLX_ELECTRON_DEV__?: boolean }).__VLX_ELECTRON_DEV__);

/** Unified public environment view. */
export const env: PlatformEnv = {
  kind: deriveKind(),
  isTauri,
  isElectron,
  // Anything outside Tauri/Electron uses browser transport, including remote-connection windows (isTauri=false over WS).
  isBrowser: !isTauri && !isElectron,
  isRemoteWindow,
  // Main windows, remote-connection windows, and Electron can use local native capabilities.
  hasNativeHost: isTauri || isElectron || isRemoteWindow,
  hasBuiltinBrowser: isTauri || isElectron || isRemoteWindow,
  isDev,
  isMac,
};
