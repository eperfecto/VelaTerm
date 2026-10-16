//! The icon theme in effect for this window, kept apart from termStore so icons and the screenshot overlay can
//! subscribe without importing the application store. applyVisual keeps it in sync with settings.

import { create } from "zustand";
import { normalizeIconTheme, type IconThemeId } from "./registry";

// Same key as store/settings SETTINGS_KEY; importing that module would pull the settings sync stack in here.
const SETTINGS_KEY = "vlx-settings";

/** Reads the persisted choice synchronously so the first paint already uses it. */
export function readStoredIconTheme(): IconThemeId {
  try {
    return normalizeIconTheme(JSON.parse(localStorage.getItem(SETTINGS_KEY) ?? "{}")?.iconTheme);
  } catch {
    return normalizeIconTheme(undefined);
  }
}

export const useActiveIconTheme = create<{ id: IconThemeId }>(() => ({ id: readStoredIconTheme() }));

export function setActiveIconTheme(id: IconThemeId) {
  if (useActiveIconTheme.getState().id !== id) useActiveIconTheme.setState({ id });
}

/** For windows without the settings store: follow theme changes saved by another window. */
export function followStoredIconTheme(): () => void {
  const onStorage = (event: StorageEvent) => {
    if (event.key === SETTINGS_KEY || event.key === null) setActiveIconTheme(readStoredIconTheme());
  };
  window.addEventListener("storage", onStorage);
  return () => window.removeEventListener("storage", onStorage);
}
