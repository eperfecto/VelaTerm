//! Folder picker dialog for browser and remote windows: the server folder browser with a title, the folder that
//! will be used, and Cancel / confirm. Desktop shells use the system dialog instead. Rendered through a portal so
//! it can open on top of another dialog (the Location field's Browse button) without being clipped by it.

import { useState } from "react";
import { createPortal } from "react-dom";
import { Backdrop } from "../components/Backdrop";
import Icons from "../components/Icons";
import { useT } from "../i18n";
import { listDir } from "../ipc/info";
import { ServerBrowserView, TargetPath, useServerBrowser } from "./ServerFileBrowser";
import { ExecutionContext } from "./ExecutionContext";
import { trapDialogFocus, useDialogFocus } from "./dialogFocus";

export function FolderPickerModal({
  title,
  confirmLabel,
  busyLabel,
  initialPath,
  zIndex = 300,
  onChoose,
  onCancel,
}: {
  title: string;
  confirmLabel: string;
  /** Button text while `onChoose` runs; defaults to `confirmLabel`. */
  busyLabel?: string;
  /** Folder shown first; `~` is expanded. An invalid location stays visible and cannot be confirmed. */
  initialPath?: string;
  zIndex?: number;
  /** Receives a folder verified to be readable. A rejection is shown in the dialog, which stays open. */
  onChoose: (path: string) => void | Promise<void>;
  onCancel: () => void;
}) {
  const t = useT();
  const browser = useServerBrowser(true, { initialPath, route: true });
  const dialogRef = useDialogFocus(true);
  const [busy, setBusy] = useState(false);
  const target = browser.target;

  const confirm = async () => {
    if (!target || busy) return;
    setBusy(true);
    browser.setError("");
    try {
      await listDir(target);
      browser.pushRecent(target);
      await onChoose(target);
    } catch (e) {
      browser.setError(String(e));
    } finally {
      setBusy(false);
    }
  };

  const cancel = () => {
    if (!busy) onCancel();
  };

  return createPortal(
    <Backdrop onClose={cancel} zIndex={zIndex}>
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        aria-label={title}
        className="fp-dialog"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          trapDialogFocus(e);
          // Stop here so an Escape meant for this picker does not also close a dialog underneath it.
          if (e.key === "Escape") {
            e.stopPropagation();
            cancel();
          }
        }}
      >
        <div className="fp-head">
          <span className="fp-title">{title}</span>
          <button type="button" className="icon-btn" aria-label={t("common.cancel")} title={t("common.cancel")} onClick={cancel}>
            <Icons.close size={14} />
          </button>
        </div>
        <ExecutionContext fs={browser.fs} />
        <ServerBrowserView browser={browser} onSubmit={() => void confirm()} />
        {browser.error && <div className="fp-note error" style={{ paddingTop: 10 }}>{browser.error}</div>}
        <div className="fp-foot">
          <TargetPath label={t("dir.selectedFolder")} path={target} />
          {/* Buttons stay enabled while busy (the handlers guard it) so focus, and with it Escape, stays here. */}
          <button type="button" className="vlx-btn" onClick={cancel}>
            {t("common.cancel")}
          </button>
          <button type="button" className="vlx-btn vlx-btn-primary" onClick={() => void confirm()} disabled={!target}>
            {busy ? (busyLabel ?? confirmLabel) : confirmLabel}
          </button>
        </div>
      </div>
    </Backdrop>,
    document.body,
  );
}
