//! Virtual worktree level in the sidebar tree. Sibling sessions that share a persisted Git worktree are gathered
//! under one display-only worktree node, placed where the first of them sat. The node exists only in the rendered
//! tree: sessions keep their real group and parent, so moves, menus, and storage are unaffected.

import { useCallback, useState } from "react";
import type { Session } from "../../types";

/** One sibling entry after gathering: a plain session, or a worktree node holding its sessions in order. */
export type WorktreeItem =
  | { kind: "session"; session: Session }
  | { kind: "worktree"; id: string; path: string; name: string; sessions: Session[] };

/** Compare paths without trailing separators so `/a/wt` and `/a/wt/` name the same worktree. */
export function normalizeWorktreePath(path?: string | null): string {
  return (path ?? "").trim().replace(/[\\/]+$/, "");
}

/** Directory basename shown as the worktree node's name. */
export function worktreeName(path: string): string {
  return path.split(/[\\/]/).filter(Boolean).pop() || path;
}

/** Short stable hash keeping node IDs within the 100-character collapse-map key limit. */
function hashPath(path: string): string {
  let h = 5381;
  for (let i = 0; i < path.length; i++) h = ((h << 5) + h + path.charCodeAt(i)) | 0;
  return (h >>> 0).toString(36);
}

/** Node ID scoped to its container (project, group, or parent session), so the same worktree shown under two
 *  containers collapses independently. */
export function worktreeNodeId(containerId: string, path: string): string {
  return `wt:${containerId}:${hashPath(normalizeWorktreePath(path))}`;
}

/** Gather siblings by worktree. `containerWorktree` is the worktree the container itself stands for (a bound
 *  group, or a parent session already in that worktree); its sessions stay direct children because a second
 *  level for the same worktree would add nothing. With `enabled` off (the "Group by worktree" setting), every
 *  sibling stays a plain session and no worktree node is built. */
export function gatherByWorktree(
  siblings: Session[],
  containerId: string,
  containerWorktree?: string | null,
  enabled = true,
): WorktreeItem[] {
  if (!enabled) return siblings.map((session) => ({ kind: "session", session }));
  const own = normalizeWorktreePath(containerWorktree);
  const out: WorktreeItem[] = [];
  const nodes = new Map<string, Extract<WorktreeItem, { kind: "worktree" }>>();
  for (const session of siblings) {
    const path = normalizeWorktreePath(session.worktreePath);
    if (!path || path === own) {
      out.push({ kind: "session", session });
      continue;
    }
    let node = nodes.get(path);
    if (!node) {
      node = { kind: "worktree", id: worktreeNodeId(containerId, path), path, name: worktreeName(path), sessions: [] };
      nodes.set(path, node);
      out.push(node);
    }
    node.sessions.push(session);
  }
  return out;
}

/** ID of the worktree node a session is gathered under, or null when it is a direct child of its container
 *  (including when grouping by worktree is off). */
export function worktreeNodeIdFor(
  session: Session,
  containerId: string,
  containerWorktree?: string | null,
  enabled = true,
): string | null {
  if (!enabled) return null;
  const path = normalizeWorktreePath(session.worktreePath);
  if (!path || path === normalizeWorktreePath(containerWorktree)) return null;
  return worktreeNodeId(containerId, path);
}

const STORAGE_KEY = "vlx-sidebar-worktree-collapsed";

function loadCollapsed(): Record<string, boolean> {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}");
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return {};
    const out: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(raw)) if (value === true) out[id] = true;
    return out;
  } catch {
    return {};
  }
}

/** Collapse state of worktree nodes in the primary tree. These nodes have no database row, so the state lives in
 *  localStorage; only collapsed IDs are kept and nodes default to expanded. */
export function useWorktreeCollapse(): [Record<string, boolean>, (id: string, collapsed: boolean) => void] {
  const [collapsed, setState] = useState(loadCollapsed);
  const setCollapsed = useCallback((id: string, value: boolean) => {
    setState((prev) => {
      const next = { ...prev };
      if (value) next[id] = true;
      else delete next[id];
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
      } catch {
        // Storage may be unavailable or full; the state still applies for this window.
      }
      return next;
    });
  }, []);
  return [collapsed, setCollapsed];
}
