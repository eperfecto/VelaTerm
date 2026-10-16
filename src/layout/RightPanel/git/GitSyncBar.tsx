//! Remote synchronization row under the branch: Pull and Push with their pending commit counts, or
//! Publish for a branch that has no upstream yet, plus a menu for Fetch, the other pull strategies,
//! and force push.
//!
//! Pull defaults to fast-forward only, the one strategy that can never rewrite or merge anything
//! on its own; when local and upstream have diverged git refuses, and the menu offers rebase or
//! merge as an explicit choice. Force push uses --force-with-lease and still asks first.

import { useState } from "react";
import { ContextMenu, type MenuItem } from "../../../components/ContextMenu";
import Icons from "../../../components/Icons";
import { useT } from "../../../i18n";
import type { GitPullMode } from "../../../ipc/commands";
import type { GitStatus } from "../../../types";

/** Remote action the panel can run; `publish` is a push that also sets the upstream. */
export type RemoteAction = "fetch" | "pull" | "push" | "publish";

const RUNNING = {
  fetch: "git.running.fetch",
  pull: "git.running.pull",
  push: "git.running.push",
  publish: "git.running.publish",
} as const;

export function GitSyncBar({
  status,
  running,
  disabled,
  onFetch,
  onPull,
  onPush,
}: {
  status: GitStatus;
  /** Remote action in flight, shown on its button. */
  running: RemoteAction | null;
  disabled: boolean;
  onFetch: () => void;
  onPull: (mode: GitPullMode) => void;
  onPush: (force: boolean) => void;
}) {
  const t = useT();
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null);
  const [confirmForce, setConfirmForce] = useState(false);
  const upstream = status.upstream ?? null;
  // Pulling or pushing in the middle of a stopped merge or rebase only makes it harder to finish.
  const blocked = disabled || Boolean(status.operation);
  const label = (action: RemoteAction, idle: string) => (running === action ? t(RUNNING[action]) : idle);

  if (!status.branch || (!upstream && !status.hasRemote)) return null;

  const items: MenuItem[] = [
    { label: t("git.fetch"), onClick: onFetch, disabled: disabled },
    ...(upstream
      ? [
          { label: "", separator: true },
          { label: t("git.pullRebase"), onClick: () => onPull("rebase"), disabled: blocked },
          { label: t("git.pullMerge"), onClick: () => onPull("merge"), disabled: blocked },
          { label: "", separator: true },
          { label: t("git.forcePush"), onClick: () => setConfirmForce(true), disabled: blocked, danger: true },
        ]
      : []),
  ];

  return (
    <div className="git-sync">
      {confirmForce ? (
        <div className="git-sync-confirm" role="alertdialog" aria-label={t("git.forcePushAction")}>
          <span>{t("git.forcePushConfirm", upstream ?? "")}</span>
          <div className="git-sync-confirm-acts">
            <button
              type="button"
              className="vlx-btn git-danger-btn"
              disabled={blocked}
              onClick={() => {
                setConfirmForce(false);
                onPush(true);
              }}
            >
              {t("git.forcePushAction")}
            </button>
            <button type="button" className="vlx-btn" onClick={() => setConfirmForce(false)}>
              {t("common.cancel")}
            </button>
          </div>
        </div>
      ) : (
        <div className="git-sync-row">
          {upstream ? (
            <>
              <button
                type="button"
                className="vlx-btn git-sync-btn"
                disabled={blocked}
                title={t("git.pullTitle", upstream)}
                onClick={() => onPull("ff-only")}
              >
                <Icons.gitPull size={12} />
                {label("pull", t("git.pull"))}
                {status.behind > 0 && running !== "pull" && <span className="cnt">{status.behind}</span>}
              </button>
              <button
                type="button"
                className="vlx-btn git-sync-btn"
                disabled={blocked}
                title={t("git.pushTitle", upstream)}
                onClick={() => onPush(false)}
              >
                <Icons.gitPush size={12} />
                {label("push", t("git.push"))}
                {status.ahead > 0 && running !== "push" && <span className="cnt">{status.ahead}</span>}
              </button>
            </>
          ) : (
            <button
              type="button"
              className="vlx-btn git-sync-btn"
              disabled={blocked}
              title={t("git.publishTitle")}
              onClick={() => onPush(false)}
            >
              <Icons.gitPublish size={12} />
              {label("publish", t("git.publish"))}
            </button>
          )}
          {running === "fetch" && <span className="git-sync-note">{t(RUNNING.fetch)}</span>}
          <button
            type="button"
            className="git-sync-more"
            title={t("git.moreActions")}
            aria-label={t("git.moreActions")}
            aria-haspopup="menu"
            disabled={disabled}
            onClick={(e) => {
              const r = e.currentTarget.getBoundingClientRect();
              setMenu({ x: r.left, y: r.bottom + 4 });
            }}
          >
            <Icons.more size={13} />
          </button>
        </div>
      )}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  );
}
