//! Command/event wrappers for built-in browser tabs (architecture document §17).
//!
//! **Desktop-shell only**: the built-in browser is a native child view created by the window host process,
//! implemented through Rust `Window::add_child` in Tauri and main-process `WebContentsView` in Electron. This thin
//! wrapper delegates nine commands plus state subscription to platform adapter `platform.browser`, preserving the
//! public signatures used by `BrowserView.tsx`. `env` selects the implementation at runtime.
//!
//! Callers gate on `env.hasBuiltinBrowser`: desktop shells and remote-connection windows (which route these
//! commands natively to their local window); plain browser clients render no entry point or commands.
//!
//! Exception: `setBrowserUrl` **does not use** `platform.browser`. Persisting a node's last URL is a database write
//! routed through transport/WS (sidecar), so it still invokes `set_browser_url` directly.

import { platform } from "../platform";
import type {
  BrowserPopupPayload,
  BrowserRect,
  BrowserStatePayload,
  UnlistenFn,
} from "../platform";
import { invoke } from "./transport";

export type { BrowserPopupPayload, BrowserRect, BrowserStatePayload };

/** Create a child view over the placeholder; repeated calls for one tabId are idempotent and only update bounds. */
export function browserOpen(tabId: string, url: string, rect: BrowserRect): Promise<void> {
  return platform.browser.open(tabId, url, rect);
}

/** Navigate from normalized address-bar input: add HTTPS to domains, search terms, reject invalid schemes. */
export function browserNavigate(tabId: string, input: string): Promise<void> {
  return platform.browser.navigate(tabId, input);
}

export function browserBack(tabId: string): Promise<void> {
  return platform.browser.back(tabId);
}

export function browserForward(tabId: string): Promise<void> {
  return platform.browser.forward(tabId);
}

export function browserReload(tabId: string): Promise<void> {
  return platform.browser.reload(tabId);
}

export function browserStop(tabId: string): Promise<void> {
  return platform.browser.stop(tabId);
}

/** Synchronize placeholder position/size when ResizeObserver or the window reports a change. */
export function browserSetBounds(tabId: string, rect: BrowserRect): Promise<void> {
  return platform.browser.setBounds(tabId, rect);
}

/** Show/hide on tab switches; hidden page processes remain alive, continuing audio/video and JavaScript. */
export function browserSetVisible(tabId: string, visible: boolean): Promise<void> {
  return platform.browser.setVisible(tabId, visible);
}

/** Close and destroy the child view; silently idempotent when the tab is already closed. */
export function browserClose(tabId: string): Promise<void> {
  return platform.browser.close(tabId);
}

/**
 * Persist the last visited URL for a browser page node (tree node with kind=browser). Called with debounce by
 * store applyBrowserState and meaningful only when tab ID equals node ID. Uses **transport** for the database
 * write (Electron/remote reach the sidecar over WS), not platform.browser.
 */
export function setBrowserUrl(id: string, url: string): Promise<void> {
  return invoke("set_browser_url", { id, url });
}

/** Listen for URL/title/loading changes from one browser tab. */
export function onBrowserState(
  tabId: string,
  cb: (state: BrowserStatePayload) => void,
): Promise<UnlistenFn> {
  return platform.browser.onState(tabId, cb);
}

/** Listen for new-window requests from one browser tab; the caller opens them as new app browser tabs. */
export function onBrowserPopup(
  tabId: string,
  cb: (popup: BrowserPopupPayload) => void,
): Promise<UnlistenFn> {
  return platform.browser.onPopup(tabId, cb);
}
