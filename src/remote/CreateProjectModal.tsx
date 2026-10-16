//! Create Project dialog: a project name and a Location, then create that empty folder and import it as a
//! project. Location is an editable path with Browse… (LocationField), the same on every platform; the
//! destination is checked live before Create is enabled.

import "./folder-picker.css";
import { useEffect, useState } from "react";
import { Backdrop } from "../components/Backdrop";
import Icons from "../components/Icons";
import { useT } from "../i18n";
import { createDir } from "../ipc/info";
import { useTermStore } from "../store/termStore";
import { DestinationBox, LocationField, rememberProjectLocation, useDestination, useProjectLocation } from "./LocationField";
import { pushRecentFolder } from "./ServerFileBrowser";
import { ExecutionContext } from "./ExecutionContext";
import { trapDialogFocus, useDialogFocus } from "./dialogFocus";
import { readProjectDialogCollection, useDialogDraft, useDialogNavigationLock } from "./dialogNavigation";

export function CreateProjectModal() {
  const t = useT();
  const open = useTermStore((s) => s.createProjectModalOpen);
  const setOpen = useTermStore((s) => s.setCreateProjectModalOpen);
  const openProjectPath = useTermStore((s) => s.openProjectPath);

  const [name, setName] = useDialogDraft("projectName", open);
  const [location, setLocation] = useProjectLocation(open);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState("");
  // If directory creation succeeded but import failed, retry only the idempotent import step.
  const [createdPath, setCreatedPath] = useState("");
  const locked = creating || !!createdPath;
  const dest = useDestination(location, name, open && !locked);
  const dialogRef = useDialogFocus(open);
  const unlockNavigation = useDialogNavigationLock("create", creating);

  useEffect(() => {
    if (!open) return;
    setCreating(false);
    setError("");
    setCreatedPath("");
  }, [open]);

  if (!open) return null;

  const canCreate = !creating && (!!createdPath || dest.kind === "ok");

  const confirm = async () => {
    if (!canCreate) return;
    const parent = dest.kind === "ok" ? dest.parent : "";
    const target = createdPath || (dest.kind === "ok" ? dest.path : "");
    const collectionId = readProjectDialogCollection();
    if (!target) return;
    setCreating(true);
    setError("");
    try {
      if (!createdPath) {
        await createDir(target);
        setCreatedPath(target);
        rememberProjectLocation(parent);
        pushRecentFolder(parent);
      }
      await openProjectPath(target, collectionId);
      unlockNavigation();
      setOpen(false);
    } catch (e) {
      setError(String(e));
      setCreating(false);
    }
  };

  return (
    <Backdrop onClose={() => !creating && setOpen(false)} zIndex={300}>
      <form
        role="dialog"
        ref={dialogRef}
        aria-modal="true"
        aria-label={t("createProject.title")}
        className="fp-dialog fp-form"
        tabIndex={-1}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          trapDialogFocus(e);
          if (e.key === "Escape" && !creating) setOpen(false);
        }}
        onSubmit={(e) => {
          e.preventDefault();
          void confirm();
        }}
      >
        <div className="fp-head">
          <span className="fp-title">{t("createProject.title")}</span>
          <button type="button" className="icon-btn" aria-label={t("common.cancel")} title={t("common.cancel")} disabled={creating} onClick={() => setOpen(false)}>
            <Icons.close size={14} />
          </button>
        </div>
        <ExecutionContext />

        <div className="fp-fields">
          <label className="fp-field">
            <span className="fp-label">{t("createProject.name")}</span>
            <input
              className={"vlx-input" + (dest.kind === "bad" && dest.field === "name" ? " bad" : "")}
              autoFocus
              disabled={locked}
              placeholder={t("createProject.namePlaceholder")}
              spellCheck={false}
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                setError("");
              }}
            />
          </label>

          <div className="fp-field">
            <label className="fp-label" htmlFor="create-project-location">{t("location.label")}</label>
            <LocationField
              id="create-project-location"
              value={location}
              onChange={(v) => {
                setLocation(v);
                setError("");
              }}
              disabled={locked}
              invalid={dest.kind === "bad" && dest.field === "location"}
            />
          </div>

          {createdPath ? (
            <div className="fp-dest ok">
              <Icons.check size={14} />
              <div className="fp-dest-text">
                <span className="fp-dest-label">{t("location.createTo")}</span>
                <span className="fp-dest-path">{createdPath}</span>
                <span className="fp-dest-status">{t("createProject.createdRetry")}</span>
              </div>
            </div>
          ) : (
            <DestinationBox dest={dest} label={t("location.createTo")} />
          )}

          {error && <div className="fp-error">{error}</div>}
        </div>

        <div className="fp-foot">
          <span className="fp-spacer" />
          <button type="button" className="vlx-btn" onClick={() => setOpen(false)} disabled={creating}>
            {t("common.cancel")}
          </button>
          <button type="submit" className="vlx-btn vlx-btn-primary" disabled={!canCreate}>
            {creating ? t("createProject.creating") : createdPath ? t("createProject.retryImport") : t("createProject.submit")}
          </button>
        </div>
      </form>
    </Backdrop>
  );
}
