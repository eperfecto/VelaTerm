//! One file row in the Git panel: status badge, path, line counts, and the actions for that file.
//!
//! The file name takes priority over the muted directory. Long names truncate with a full-path
//! tooltip; the Changes modal shows the selected path in full above the comparison. In tree view
//! the folder rows above already say where a file lives, so the directory is left out.

import Icons, { Icon } from "../../../components/Icons";
import { fileIcon } from "../fileIcons";
import { useT } from "../../../i18n";
import { statusLetter } from "../../../components/diff/changeStatus";
import type { ChangedFile, GitConflictKind } from "../../../ipc/commands";
import { baseName } from "./gitTree";

const CONFLICT_KINDS: Record<GitConflictKind, `git.conflictKind.${GitConflictKind}`> = {
  "both-modified": "git.conflictKind.both-modified",
  "both-added": "git.conflictKind.both-added",
  "both-deleted": "git.conflictKind.both-deleted",
  "added-by-us": "git.conflictKind.added-by-us",
  "added-by-them": "git.conflictKind.added-by-them",
  "deleted-by-us": "git.conflictKind.deleted-by-us",
  "deleted-by-them": "git.conflictKind.deleted-by-them",
};

/** Indent per tree level, matching the folder rows. */
export const GIT_TREE_INDENT = 12;

/** One hover action on a file row. */
export interface RowAction {
  key: string;
  title: string;
  icon: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
}

export function GitFileRow({
  file,
  additions,
  deletions,
  binary,
  onOpen,
  actions,
  confirming,
  confirmLabel,
  cancelLabel,
  onConfirm,
  onCancelConfirm,
  disabled = false,
  selected = false,
  depth = 0,
  tree = false,
  onContextMenu,
}: {
  file: ChangedFile;
  disabled?: boolean;
  /** Part of the multi-selection. */
  selected?: boolean;
  /** Nesting level in tree view. */
  depth?: number;
  /** Tree view: show the name only, since the folder rows carry the directory. */
  tree?: boolean;
  onContextMenu?: (e: React.MouseEvent) => void;
  additions: number;
  deletions: number;
  binary: boolean;
  /** Click on the row; receives the event so modifier keys can extend the selection instead. */
  onOpen?: (e: React.MouseEvent) => void;
  actions: RowAction[];
  /** When true the row replaces its actions with an inline confirmation. */
  confirming?: boolean;
  confirmLabel?: string;
  cancelLabel?: string;
  onConfirm?: () => void;
  onCancelConfirm?: () => void;
}) {
  const t = useT();
  const letter = statusLetter(file.status);
  const spec = fileIcon(file.path, file.path.endsWith("/"));
  const fullPath = file.originalPath ? `${file.originalPath} → ${file.path}` : file.path;
  const slash = file.path.lastIndexOf("/");
  const dir = tree ? "" : slash >= 0 ? file.path.slice(0, slash + 1) : "";
  const base = tree ? baseName(file.path) : slash >= 0 ? file.path.slice(slash + 1) : file.path;
  const conflict = file.conflict ? t(CONFLICT_KINDS[file.conflict]) : null;

  return (
    <div
      className={"git-row" + (selected ? " sel" : "")}
      title={fullPath}
      data-git-path={file.path}
      aria-selected={selected}
      onContextMenu={onContextMenu}
      style={depth ? { paddingLeft: 24 + depth * GIT_TREE_INDENT } : undefined}
    >
      <button type="button" className="git-row-main" onClick={onOpen} disabled={!onOpen}>
        <span className="git-file-icon" style={{ color: spec.color }}><Icon name={spec.icon} size={15} /></span>
        <span className="nm">
          <span className="base">{base || dir}</span>
          {(file.originalPath || dir) && <span className="dir">{file.originalPath ? `${file.originalPath} →` : dir}</span>}
          {conflict && <span className="git-conflict-kind">{conflict}</span>}
        </span>
        {!binary && (additions > 0 || deletions > 0) && (
          <span className="n">
            <span className="plus">+{additions}</span> <span className="minus">−{deletions}</span>
          </span>
        )}
        {binary && <span className="n bin" title={t("changes.binary")}>—</span>}
        <span className={"gb gb-" + letter} title={t(`git.fileStatus.${file.status}` as "git.fileStatus.modified")}>{letter}</span>
      </button>
      {confirming ? (
        <span className="git-row-confirm">
          <button type="button" className="danger" disabled={disabled} onClick={onConfirm}>
            {confirmLabel}
          </button>
          <button type="button" onClick={onCancelConfirm} title={cancelLabel} aria-label={cancelLabel}>
            <Icons.cancel size={12} />
          </button>
        </span>
      ) : (
        <span className="git-row-acts">
          {actions.map((a) => (
            <button
              type="button"
              key={a.key}
              title={a.title}
              aria-label={a.title}
              className={a.danger ? "danger" : undefined}
              disabled={disabled}
              onClick={a.onClick}
            >
              {a.icon}
            </button>
          ))}
        </span>
      )}
    </div>
  );
}

/** Folder row in tree view: toggles its contents and acts on every file below it. */
export function GitDirRow({
  name,
  path,
  depth,
  open,
  count,
  actions,
  disabled = false,
  onToggle,
  onContextMenu,
}: {
  name: string;
  path: string;
  depth: number;
  open: boolean;
  /** Files below this folder in the group. */
  count: number;
  actions: RowAction[];
  disabled?: boolean;
  onToggle: () => void;
  onContextMenu?: (e: React.MouseEvent) => void;
}) {
  return (
    <div
      className="git-row git-dir-row"
      title={path}
      data-git-dir={path}
      onContextMenu={onContextMenu}
      style={{ paddingLeft: 8 + depth * GIT_TREE_INDENT }}
    >
      <button type="button" className="git-row-main" onClick={onToggle} aria-expanded={open}>
        <span className="tw">{open ? <Icons.chevronDown size={11} /> : <Icons.chevronRight size={11} />}</span>
        <span className="git-file-icon git-dir-icon">{open ? <Icons.folderOpen size={14} /> : <Icons.folder size={14} />}</span>
        <span className="nm"><span className="base">{name}</span></span>
        <span className="n git-dir-count">{count}</span>
      </button>
      <span className="git-row-acts">
        {actions.map((a) => (
          <button
            type="button"
            key={a.key}
            title={a.title}
            aria-label={a.title}
            className={a.danger ? "danger" : undefined}
            disabled={disabled}
            onClick={a.onClick}
          >
            {a.icon}
          </button>
        ))}
      </span>
    </div>
  );
}
