//! Browser-side Save As dialog for new documents. Plain browser and remote windows have no native Save As
//! dialog, so this combines the shared server folder browser with a file name field. DocView writes the chosen
//! path to the server. The promise-based flow is triggered through `store.promptSaveAs`, resolving to a path or
//! null on cancel. Desktop builds use the native dialog and do not mount this component.
//!
//! The file is saved in the folder being shown. Clicking a file copies its name; a double click saves over it.
//! If the name already exists, the button turns into Overwrite and needs a second click.

import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { Backdrop } from "../components/Backdrop";
import Icons from "../components/Icons";
import { useT } from "../i18n";
import { previewDestination } from "../ipc/info";
import { useTermStore } from "../store/termStore";
import { joinPath, ServerBrowserView, TargetPath, useServerBrowser } from "./ServerFileBrowser";
import { useDestination } from "./LocationField";
import { ExecutionContext } from "./ExecutionContext";
import { trapDialogFocus, useDialogFocus } from "./dialogFocus";
import { navigateProjectDialog, readProjectDialog, useDialogDraft, useDialogNavigationLock } from "./dialogNavigation";

export function SaveAsModal() {
  const t = useT();
  const req = useTermStore((s) => s.saveAsRequest);
  const [routed, setRouted] = useState(() => readProjectDialog() === "save");
  const active = !!req || routed;
  const browser = useServerBrowser(active, { route: true });

  const [name, setName] = useDialogDraft("saveName", active, req?.defaultName ?? "");
  const [saving, setSaving] = useState(false);
  // Non-null when a name collision has been found and overwrite confirmation is pending.
  const [overwrite, setOverwrite] = useState<string | null>(null);
  const dest = useDestination(browser.cwd, name, active && !saving, undefined, true);
  const dialogRef = useDialogFocus(active);
  useDialogNavigationLock("save", saving);
  useEffect(() => {
    const update = () => setRouted(readProjectDialog() === "save");
    window.addEventListener("popstate", update);
    return () => window.removeEventListener("popstate", update);
  }, []);

  // Populate the default filename and clear stale state whenever the dialog opens.
  useEffect(() => {
    if (!req) return;
    setSaving(false);
    setOverwrite(null);
  }, [req]);

  // A collision from the previous folder no longer applies after navigation.
  useEffect(() => {
    setOverwrite(null);
  }, [browser.cwd, name]);

  if (!active) return null;

  /** Close the dialog and return its result to the caller awaiting promptSaveAs. */
  const finish = (result: string | null) => {
    req?.resolve(result);
    useTermStore.setState({ saveAsRequest: null });
    navigateProjectDialog("save", false);
  };

  const selectedDir = browser.entries?.find((e) => e.isDir && e.name === browser.selected);

  const confirm = async (fileName = name) => {
    const fname = fileName.trim();
    const dir = browser.cwd;
    if (!req || !browser.target || !dir || browser.listError || saving) return;
    // With a folder selected, Save opens it first, as system Save dialogs do.
    if (selectedDir && fileName === name) {
      void browser.open(joinPath(dir, selectedDir.name, browser.flavor));
      return;
    }
    if (!fname) return;
    setSaving(true);
    browser.setError("");
    try {
      const checked = await previewDestination(dir, fname);
      if (checked.problem || checked.existingKind === "directory") throw new Error(t("location.invalidName"));
      if (checked.existingKind === "file" && overwrite !== checked.path) {
        setName(fname);
        setOverwrite(checked.path);
        setSaving(false);
        return;
      }
      browser.pushRecent(dir);
      finish(checked.path);
    } catch (e) {
      browser.setError(String(e));
      setSaving(false);
    }
  };

  // Deliberately independent of `saving`: disabling the focused button would drop focus out of the dialog.
  const canSave = !!req && !!browser.target && (!!selectedDir || dest.kind === "ok");

  return createPortal(
    <Backdrop onClose={() => !saving && finish(null)} zIndex={300}>
      <div
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        aria-label={t("doc.saveAsTitle")}
        className="fp-dialog"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          trapDialogFocus(e);
          if (e.key === "Escape") {
            e.stopPropagation();
            if (!saving) finish(null);
          }
        }}
      >
        <div className="fp-head">
          <span className="fp-title">{t("doc.saveAsTitle")}</span>
          <button type="button" className="icon-btn" aria-label={t("common.cancel")} title={t("common.cancel")} onClick={() => finish(null)}>
            <Icons.close size={14} />
          </button>
        </div>
        <ExecutionContext fs={browser.fs} />

        <ServerBrowserView
          browser={browser}
          selectedName={name.trim() || undefined}
          onSubmit={() => void confirm()}
          onFileClick={(fileName) => {
            setName(fileName);
            setOverwrite(null);
          }}
          onFileActivate={(fileName) => {
            setName(fileName);
            void confirm(fileName);
          }}
        />

        {browser.error && <div className="fp-note error" style={{ paddingTop: 10 }}>{browser.error}</div>}

        <div className="fp-save-fields">
          <label className="fp-field">
            <span className="fp-label">{t("doc.saveAsName")}</span>
            <input
              className="vlx-input"
              value={name}
              aria-label={t("doc.saveAsName")}
              placeholder={t("doc.saveAsName")}
              spellCheck={false}
              onFocus={() => browser.setSelected(null)}
              onChange={(e) => {
                setName(e.target.value);
                setOverwrite(null);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" && canSave) void confirm();
              }}
            />
          </label>
          {dest.kind === "bad" && <div className="fp-error" role="alert">{dest.message}</div>}
          {!req && <div className="fp-note warn">{t("doc.saveAsReopen")}</div>}
          {overwrite && <div className="fp-note warn" role="alert"><Icons.warn size={17} />{t("doc.overwriteConfirm")}</div>}
        </div>
        <div className="fp-foot">
          <TargetPath label={selectedDir ? t("dir.selectedFolder") : t("doc.saveTo")}
            path={browser.target ? (selectedDir ? browser.target : dest.path) : ""} />
          <button type="button" className="vlx-btn" onClick={() => !saving && finish(null)}>
            {t("common.cancel")}
          </button>
          <button type="button" className="vlx-btn vlx-btn-primary" onClick={() => void confirm()} disabled={!canSave}>
            {saving ? t("doc.saving") : selectedDir ? t("dir.openFolder") : overwrite ? t("doc.overwrite") : t("common.save")}
          </button>
        </div>
      </div>
    </Backdrop>,
    document.body,
  );
}
