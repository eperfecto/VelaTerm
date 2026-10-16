import { useEffect, useState } from "react";
import { invoke } from "../ipc/transport";
import { useT } from "../i18n";
import { applyTheme, loadTheme } from "../theme";
import { ConnectRemotePanel } from "../layout/TitleBar/ConnectRemotePanel";
import "./launcher.css";

export function isLauncherWindow(): boolean {
  return !!(window as unknown as { __VLX_LAUNCHER__?: boolean }).__VLX_LAUNCHER__;
}

export function LauncherApp() {
  const t = useT();
  const [view, setView] = useState<"choose" | "ssh">("choose");

  useEffect(() => { applyTheme(loadTheme()); }, []);

  const showSsh = () => {
    setView("ssh");
    void invoke("launcher_resize", { expanded: true });
  };
  const back = () => {
    setView("choose");
    void invoke("launcher_resize", { expanded: false });
  };

  if (view === "ssh") {
    return (
      <div className="launcher">
        <button className="launcher-back" onClick={back}>{t("launcher.back")}</button>
        <ConnectRemotePanel variant="embedded" sshOnly onClose={() => {}} />
      </div>
    );
  }

  return (
    <div className="launcher launcher-choose">
      <h1 className="launcher-title">{t("launcher.title")}</h1>
      <button className="launcher-choice" onClick={() => void invoke("launcher_choose_local")}>{t("launcher.local")}</button>
      <button className="launcher-choice" onClick={showSsh}>{t("launcher.ssh")}</button>
    </div>
  );
}
