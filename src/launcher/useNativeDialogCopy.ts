import { useEffect } from "react";
import { getLocale, useT } from "../i18n";
import { invoke } from "../ipc/transport";
import { env } from "../platform/env";

/** Keep the Rust-side native dialog copy for hidden mode in sync with the UI locale. */
export function useNativeDialogCopy(): void {
  const t = useT();
  const locale = getLocale();
  const hidePrompt = t("hiddenMode.hidePrompt");
  const hide = t("hiddenMode.hide");
  const keepOpen = t("hiddenMode.keepOpen");
  const lastClosedPrompt = t("hiddenMode.lastClosedPrompt");
  const returnToLocal = t("hiddenMode.returnToLocal");
  const quit = t("hiddenMode.quit");

  // Depend on the strings too: a locale's dictionary loads asynchronously after the locale switches.
  useEffect(() => {
    if (!env.isTauri || env.isElectron) return;
    void invoke("set_hidden_mode_copy", {
      copy: { hidePrompt, hide, keepOpen, lastClosedPrompt, returnToLocal, quit },
    }).catch(() => {});
  }, [t, locale, hidePrompt, hide, keepOpen, lastClosedPrompt, returnToLocal, quit]);
}
