//! Runtime propagation of preference changes between shells.
//!
//! `settingsSync` reconciles preferences **once at startup**, with the backend as the authority. That
//! leaves a gap while the app runs: change a preference in the browser and the desktop keeps its stale
//! copy until its next launch. The drift is not only cosmetic — a client that still believes status
//! filtering grows dynamically keeps adding sessions to the shared filter set, and mismatched
//! `maxLiveTabs` or `spawnConfirm` values make the two clients behave differently on the same session.
//!
//! The backend now broadcasts `settings://changed` after every `app_settings` write, carrying key names
//! only. This module turns that signal back into the same reconciliation the app runs at startup, so the
//! authority and the code path stay identical; only the trigger is new.

import { onSettingsChanged } from "../ipc/events";
import { flushNow, publishUiLocale, reconcileSettings } from "../ipc/settingsSync";
import type { UnlistenFn } from "../ipc/transport";
import { getLocale, loadLangChoice, setLang } from "../i18n";
import { env } from "../platform";
import { useTermStore } from "./termStore";

/** Cap on the wait for pending writes; see the flush note in `refresh`. */
const FLUSH_TIMEOUT_MS = 1000;

let settingsReady = false;
let initialRefreshes = 0;
let resolveSettingsReady: () => void;
const settingsReadyPromise = new Promise<void>((resolve) => {
  resolveSettingsReady = resolve;
});

/** Apply explicit theme choices after initial hydration, so startup cannot replace a user's choice
 *  or persist unrelated preferences from the stale local cache. Later choices remain immediate. */
export function runAfterInitialSettings(action: () => void): void {
  if (settingsReady) action();
  else void settingsReadyPromise.then(action);
}

/**
 * Re-read preferences from the backend and apply whatever differs.
 *
 * Pending local writes are flushed first. Without that, a broadcast arriving inside `pushSetting`'s
 * 400 ms debounce window would reconcile against a backend that has not seen this shell's newest value
 * yet, revert the local cache to the older one, and then flip back when the debounce finally fires —
 * a visible flicker over an already-correct value. The timeout keeps a half-open socket from stalling
 * the refresh; the local cache is written either way, so a dropped flush only defers the backend write.
 */
export async function refreshSettingsFromBackend(): Promise<void> {
  initialRefreshes++;
  try {
    await flushNow(FLUSH_TIMEOUT_MS);
    const changed = await reconcileSettings();
    if (changed.has("vlx-lang")) setLang(loadLangChoice());
    // Startup and every language change pass through here, so the backend always knows the language the
    // interface resolved, including "auto", which only this shell can resolve. Only the desktop app and its
    // connection windows publish: a phone or browser resolving "auto" to another system language would
    // otherwise overwrite the desktop's value, and the desktop would not publish again until it restarts.
    // Not awaited: applying settings does not depend on this write.
    if (env.hasNativeHost) void publishUiLocale(getLocale());
    if (changed.size === 0) return;
    if (
      changed.has("vlx-theme") ||
      changed.has("vlx-sound") ||
      changed.has("vlx-notify") ||
      changed.has("vlx-clean-images") ||
      changed.has("vlx-record-sessions") ||
      changed.has("vlx-settings")
    ) {
      useTermStore.getState().hydrateSettingsFromCache();
    }
  } finally {
    initialRefreshes--;
    if (!settingsReady && initialRefreshes === 0) {
      settingsReady = true;
      resolveSettingsReady();
    }
  }
}

/**
 * Subscribe to `settings://changed` and reconcile on each one. Returns a function that unsubscribes.
 *
 * The writer hears its own broadcast as well. Reconciliation is idempotent and finds nothing to change
 * in that case, which matches how `tree://changed` treats a client's own tree writes.
 */
export function startSettingsWatch(): () => void {
  let stopped = false;
  const pending: Promise<UnlistenFn> = onSettingsChanged(() => {
    void refreshSettingsFromBackend().catch(() => {
      /* A failed read leaves the local cache in place; the next broadcast or launch retries. */
    });
  });
  void pending.catch(() => {
    /* Registration failure means no runtime propagation; startup reconciliation still applies. */
  });
  return () => {
    if (stopped) return;
    stopped = true;
    void pending.then((off) => off()).catch(() => {});
  };
}
