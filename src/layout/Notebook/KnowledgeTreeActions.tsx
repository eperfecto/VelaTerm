//! Management layer for the knowledge navigation: inline rename, drag-between-groups, and delete for
//! every data row. Rows only render affordances; this provider owns the pending menu, rename input,
//! drag state, confirmation dialog and the backend calls behind them.

import { useRef, useState, type ReactNode } from "react";
import { Backdrop } from "../../components/Backdrop";
import { ContextMenu, type MenuItem } from "../../components/ContextMenu";
import Icons from "../../components/Icons";
import { useT } from "../../i18n";
import { memoryDelete, memoryGroupDelete, memoryGroupMove, memoryGroupRename, memoryMove, memoryRename } from "../../ipc/memory";
import { notebookMove, notebookTrash, notebookUnregister, notebookVaultRename } from "../../ipc/notebook";
import { memoryNavigate, memoryUrl } from "../Memory/navigation";
import { memoryError } from "../Memory/shared";
import { notebookError } from "./shared";
import {
  KnowledgeTreeContext,
  treeKey,
  type KnowledgeDragPayload,
  type KnowledgeRowTarget,
  type KnowledgeTreeActions,
} from "./KnowledgeTreeRow";

const seedValue = (target: KnowledgeRowTarget): string => {
  switch (target.kind) {
    case "memoryEntry": return target.title;
    case "notebookNode": return target.nodeKind === "note" ? target.name.replace(/\.md$/i, "") : target.name;
    default: return target.name;
  }
};

const targetLabel = (target: KnowledgeRowTarget): string => {
  switch (target.kind) {
    case "memoryEntry": return target.title;
    case "notebookNode": return target.path;
    default: return target.name;
  }
};

const payloadKey = (payload: KnowledgeDragPayload): string =>
  payload.kind === "memoryEntry" ? treeKey.memoryEntry(payload.id)
  : payload.kind === "memorySession" ? treeKey.memorySession(payload.id)
  : treeKey.notebookNode(payload.vaultId, payload.path);

/** Sibling path for a rename, re-attaching the `.md` suffix notes hide in the tree. */
function renamedPath(target: Extract<KnowledgeRowTarget, { kind: "notebookNode" }>, value: string): string {
  const parent = target.path.includes("/") ? target.path.slice(0, target.path.lastIndexOf("/")) : "";
  const name = target.nodeKind === "note" ? (/\.md$/i.test(value) ? value : `${value}.md`) : value;
  return parent ? `${parent}/${name}` : name;
}

/** Path after dropping an item into a folder, keeping the item's own name. */
function dropPath(path: string, folder: string): string {
  const name = path.slice(path.lastIndexOf("/") + 1);
  return folder ? `${folder}/${name}` : name;
}

function canDropPayload(payload: KnowledgeDragPayload, target: KnowledgeRowTarget): boolean {
  if (payload.kind === "memoryEntry") {
    if (target.kind !== "memorySession" || target.id === "__legacy__") return false;
    return (target.id === "__manual__" ? "" : target.id) !== payload.sessionId;
  }
  if (payload.kind === "memorySession") {
    return target.kind === "memoryProject" && !target.special;
  }
  if (target.kind === "vault") return target.id === payload.vaultId;
  if (target.kind !== "notebookNode" || target.nodeKind !== "folder" || target.vaultId !== payload.vaultId) return false;
  if (target.path === payload.path) return false;
  if (payload.nodeKind === "folder" && target.path.startsWith(`${payload.path}/`)) return false;
  const parent = payload.path.includes("/") ? payload.path.slice(0, payload.path.lastIndexOf("/")) : "";
  return parent !== target.path;
}

export function KnowledgeTreeProvider({ children }: { children: ReactNode }) {
  const t = useT();
  const [revision, setRevision] = useState(0);
  const [menu, setMenu] = useState<{ target: KnowledgeRowTarget; x: number; y: number } | null>(null);
  const [rename, setRename] = useState<{ target: KnowledgeRowTarget; value: string; seed: string } | null>(null);
  const [confirm, setConfirm] = useState<KnowledgeRowTarget | null>(null);
  const [drag, setDrag] = useState<KnowledgeDragPayload | null>(null);
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropKey, setDropKey] = useState<string | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const renameGuard = useRef(false);

  const run = async (action: () => Promise<unknown>, format: (error: unknown) => string) => {
    setBusy(true);
    setFailure("");
    try {
      await action();
      setRevision((value) => value + 1);
    } catch (error) {
      setFailure(format(error));
    } finally {
      setBusy(false);
    }
  };

  const startRename = (target: KnowledgeRowTarget) => {
    setMenu(null);
    setFailure("");
    const seed = seedValue(target);
    setRename({ target, seed, value: seed });
  };

  const commitRename = async () => {
    if (renameGuard.current) return;
    const pending = rename;
    if (!pending) return;
    renameGuard.current = true;
    try {
      setRename(null);
      const value = pending.value.trim();
      if (!value || value === pending.seed) return;
      const target = pending.target;
      const notebook = target.kind === "vault" || target.kind === "notebookNode";
      await run(async () => {
        if (target.kind === "memoryEntry") await memoryRename(target.id, target.version, value);
        else if (target.kind === "memoryProject") await memoryGroupRename("project", target.id, value);
        else if (target.kind === "memorySession") await memoryGroupRename("session", target.id, value);
        else if (target.kind === "vault") {
          await notebookVaultRename(target.id, value);
          window.dispatchEvent(new Event("notebook:vaultsChanged"));
        } else if (target.kind === "notebookNode") {
          await notebookMove(target.vaultId, target.path, renamedPath(target, value));
        }
      }, notebook ? notebookError : memoryError);
    } finally {
      renameGuard.current = false;
    }
  };

  const remove = async (target: KnowledgeRowTarget) => {
    const notebook = target.kind === "vault" || target.kind === "notebookNode";
    await run(async () => {
      if (target.kind === "memoryEntry") await memoryDelete(target.id, target.version);
      else if (target.kind === "memoryProject") await memoryGroupDelete("project", target.id);
      else if (target.kind === "memorySession") await memoryGroupDelete("session", target.id);
      else if (target.kind === "vault") {
        await notebookUnregister(target.id);
        window.dispatchEvent(new Event("notebook:vaultsChanged"));
        if (new URLSearchParams(location.search).get("memory") === `notebook/${target.id}`) {
          memoryNavigate(memoryUrl("notebooks"), false, true);
        }
      } else if (target.kind === "notebookNode") {
        await notebookTrash(target.vaultId, target.path);
      }
    }, notebook ? notebookError : memoryError);
    setConfirm(null);
  };

  const endDrag = () => {
    setDrag(null);
    setDragKey(null);
    setDropKey(null);
  };

  const drop = (target: KnowledgeRowTarget) => {
    const payload = drag;
    const allowed = !!payload && canDropPayload(payload, target);
    endDrag();
    if (!payload || !allowed) return;
    void run(async () => {
      if (payload.kind === "memoryEntry" && target.kind === "memorySession") {
        await memoryMove(payload.id, payload.version, target.id);
      } else if (payload.kind === "memorySession" && target.kind === "memoryProject") {
        await memoryGroupMove(payload.id, target.id);
      } else if (payload.kind === "notebookNode" && target.kind === "vault") {
        await notebookMove(payload.vaultId, payload.path, dropPath(payload.path, ""));
      } else if (payload.kind === "notebookNode" && target.kind === "notebookNode" && target.nodeKind === "folder") {
        await notebookMove(payload.vaultId, payload.path, dropPath(payload.path, target.path));
      }
    }, payload.kind === "notebookNode" ? notebookError : memoryError);
  };

  const dragPayload = (target: KnowledgeRowTarget): KnowledgeDragPayload | null => {
    switch (target.kind) {
      case "memoryEntry": return { kind: "memoryEntry", id: target.id, version: target.version, sessionId: target.sessionId };
      case "memorySession": return target.special ? null : { kind: "memorySession", id: target.id };
      case "notebookNode": return { kind: "notebookNode", vaultId: target.vaultId, path: target.path, nodeKind: target.nodeKind };
      default: return null;
    }
  };

  const menuFor = (target: KnowledgeRowTarget): MenuItem[] => {
    const items: MenuItem[] = [];
    // Synthetic groups (manual, legacy, unknown) have no live node behind them to rename.
    if (!("special" in target) || !target.special) {
      items.push({ label: t("common.rename"), onClick: () => startRename(target) });
    }
    items.push({
      label: t(target.kind === "vault" ? "nb.closeVault" : "common.delete"),
      danger: target.kind !== "vault",
      onClick: () => { setMenu(null); setConfirm(target); },
    });
    return items;
  };

  const value: KnowledgeTreeActions = {
    revision,
    renameKey: rename?.target.key ?? null,
    renameValue: rename?.value ?? "",
    setRenameValue: (text) => setRename((current) => (current ? { ...current, value: text } : current)),
    commitRename: () => void commitRename(),
    cancelRename: () => setRename(null),
    openMenu: (target, x, y) => { setFailure(""); setMenu({ target, x, y }); },
    drag,
    dragKey,
    dropKey,
    dragPayload,
    beginDrag: (payload) => { setDrag(payload); setDragKey(payloadKey(payload)); },
    endDrag,
    hoverDrop: (target) => setDropKey(target?.key ?? null),
    canDrop: (target) => !!drag && canDropPayload(drag, target),
    drop,
  };

  return <KnowledgeTreeContext.Provider value={value}>
    {children}
    {menu && <ContextMenu x={menu.x} y={menu.y} items={menuFor(menu.target)} onClose={() => setMenu(null)} />}
    {confirm && <Backdrop onClose={() => !busy && setConfirm(null)}>
      <div className="nb-confirm" role="alertdialog" aria-label={t(confirm.kind === "vault" ? "nb.closeVault" : "common.delete")}>
        <p>{confirm.kind === "memoryEntry"
          ? t("memory.deleteConfirm")
          : confirm.kind === "memoryProject" || confirm.kind === "memorySession"
            ? t("memory.groupDeleteConfirm", String(confirm.count))
            : confirm.kind === "vault" ? t("nb.closeHint") : t("nb.trashHint")}</p>
        <strong className="nb-block">{targetLabel(confirm)}</strong>
        <div className="nb-confirm-actions">
          <button type="button" className="btn" disabled={busy} onClick={() => setConfirm(null)}>{t("common.cancel")}</button>
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => void remove(confirm)}>{t(busy ? "common.loading" : confirm.kind === "vault" ? "nb.closeVault" : "common.confirm")}</button>
        </div>
      </div>
    </Backdrop>}
    {failure && <div className="nb-tree-alert" role="alert">
      <span>{failure}</span>
      <button type="button" aria-label={t("common.close")} onClick={() => setFailure("")}><Icons.close size={12} /></button>
    </div>}
  </KnowledgeTreeContext.Provider>;
}
