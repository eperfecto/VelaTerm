import { ConnectionMenuEntry } from "./ConnectionMenuEntry";
import { apiUrl, isShareSurface } from "../ipc/shareBase";
import { sharedSessionUrl } from "../sharing/sessionNavigation";
//! First-level screen showing projects, nested groups, sessions, and nested child sessions. The
//! header provides name search and status chips. This initial version remains read-only; create,
//! delete, and edit operations stay on desktop. Collapse state persists through toggleCollapsed
//! and synchronizes across clients through `tree://changed`.
//!
//! Filtering follows a simplified desktop ProjectTree model:
//! - Name search displays matching sessions, their ancestor chain, and each match's full subtree.
//! - Status filters use the snapshot captured in `statusFilterIds`; names do not count and empty
//!   groups remain hidden. With `dynamicStatusFilter` on, newly matching sessions join the snapshot,
//!   matching the desktop sidebar.
//! - Filtering expands everything and ignores collapse state.
//! Rows contain an optional collapse arrow, session status dot, name, and type label.

import { memo, useEffect, useMemo, type CSSProperties } from "react";
import Icons from "../components/Icons";
import { StatusIndicator } from "../components/StatusIndicator";
import { t, useT } from "../i18n";
import { useTermStore } from "../store/termStore";
import {
  type AgentState,
  collectionsFirst,
  countByAgentState,
  effectiveStatus,
  type Group,
  type Session,
  type SessionId,
} from "../types";
import { applyViewOverride } from "./detect";

/** Trailing type label: shell name for terminal sessions, kind for agent sessions. */
function kindLabel(s: Session): string {
  if (s.kind !== "terminal") return s.kind;
  const shell = s.shell?.split("/").pop();
  return shell || t("kind.terminal");
}

/** Indentation per level, added to the 8 px base inset. */
const INDENT_STEP = 14;
const INDENT_BASE = 8;

function Chevron({ open }: { open: boolean }) {
  return open ? <Icons.chevronDown size={13} /> : <Icons.chevronRight size={13} />;
}

/** Status-filter chips subscribe to high-frequency runtime/notification state without rerendering the full list. */
const STATUS_CHIPS: {
  st: AgentState;
  color: string;
  pulse: boolean;
  labelKey: "tree.filterWorking" | "tree.filterAsking" | "tree.filterWaiting" | "tree.filterBackground";
}[] = [
  { st: "working", color: "var(--status-working)", pulse: true, labelKey: "tree.filterWorking" },
  { st: "asking", color: "var(--status-asking)", pulse: true, labelKey: "tree.filterAsking" },
  { st: "waiting", color: "var(--status-waiting)", pulse: false, labelKey: "tree.filterWaiting" },
  { st: "background", color: "var(--status-background)", pulse: true, labelKey: "tree.filterBackground" },
];

function StatusChips() {
  const tr = useT();
  const sessions = useTermStore((s) => s.sessions);
  const runtimes = useTermStore((s) => s.runtimes);
  const notifications = useTermStore((s) => s.notifications);
  const statusFilter = useTermStore((s) => s.statusFilter);
  const setStatusFilter = useTermStore((s) => s.setStatusFilter);
  const dynamicStatusFilter = useTermStore((s) => s.dynamicStatusFilter);
  const primaryViewId = useTermStore((s) => s.primarySidebarTreeViewId);
  const appendStatusMatches = useTermStore((s) => s.appendSidebarTreeViewStatusMatches);

  const counts = useMemo(
    () => countByAgentState(sessions, runtimes, notifications),
    [sessions, runtimes, notifications],
  );

  // Same rule as the desktop sidebar: sessions that start matching join the list, existing rows stay put.
  useEffect(() => {
    if (dynamicStatusFilter && statusFilter) appendStatusMatches(primaryViewId);
  }, [
    appendStatusMatches,
    dynamicStatusFilter,
    notifications,
    primaryViewId,
    runtimes,
    sessions,
    statusFilter,
  ]);

  return (
    <div className="m-chips">
      {STATUS_CHIPS.map(({ st, color, pulse, labelKey }) => (
        <button
          key={st}
          type="button"
          className={statusFilter?.includes(st) ? "m-chip on" : "m-chip"}
          onClick={() => setStatusFilter(st)}
        >
          <span
            className={pulse ? "dot vlx-status-pulse" : "dot"}
            style={{ background: color }}
          />
          <span>{tr(labelKey)}</span>
          <span className="cnt">{counts[st]}</span>
        </button>
      ))}
    </div>
  );
}

interface SessionRowProps {
  session: Session;
  depth: number;
  hasKids: boolean;
  expanded: boolean;
  filtering: boolean;
  onOpen: (id: SessionId) => void;
  onToggle: (id: string) => void;
}

/** Memoized session row subscribing only to its own high-frequency status and unread state. */
const SessionRow = memo(function SessionRow(p: SessionRowProps) {
  useT(); // Subscribe to locale changes so kindLabel updates.
  const s = p.session;
  const status = effectiveStatus(useTermStore((st) => st.runtimes[s.id]));
  const unread = useTermStore((st) => s.id in st.notifications);
  return (
    <div
      className="m-row"
      style={{ paddingLeft: INDENT_BASE + p.depth * INDENT_STEP }}
      onClick={() => p.onOpen(s.id)}
    >
      <span
        className={p.hasKids ? "m-twist" : "m-twist empty"}
        onClick={
          p.hasKids
            ? (e: React.MouseEvent) => {
                e.stopPropagation();
                if (!p.filtering) p.onToggle(s.id);
              }
            : undefined
        }
      >
        {p.hasKids && <Chevron open={p.expanded} />}
      </span>
      <span className="m-row-dot">
        <StatusIndicator status={status} unread={unread} />
      </span>
      {isShareSurface ? <a className="m-row-name" href={sharedSessionUrl(s.id)} style={{color:"inherit",textDecoration:"none"}} onClick={e=>{
        e.stopPropagation();if(e.button!==0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey)return;
        e.preventDefault();p.onOpen(s.id);
      }}>{s.name}</a> : <span className="m-row-name">{s.name}</span>}
      <span className="m-row-kind">{kindLabel(s)}</span>
    </div>
  );
});

export function SessionListPage({ onOpen, loading=false, error=null, onRefresh }: {
  onOpen:(id:SessionId)=>void;loading?:boolean;error?:string|null;onRefresh?:()=>void;
}) {
  const tr = useT();
  const storeProjects = useTermStore((s) => s.projects);
  const projects = useMemo(() => collectionsFirst(storeProjects), [storeProjects]);
  const groups = useTermStore((s) => s.groups);
  const allSessions = useTermStore((s) => s.sessions);
  const treeFilter = useTermStore((s) => s.treeFilter);
  const setTreeFilter = useTermStore((s) => s.setTreeFilter);
  const statusFilter = useTermStore((s) => s.statusFilter);
  const statusFilterIds = useTermStore((s) => s.statusFilterIds);
  const toggleCollapsed = useTermStore((s) => s.toggleCollapsed);

  // Browser nodes use desktop-only native child WebViews and are omitted on mobile.
  const sessions = useMemo(
    () => allSessions.filter((s) => s.kind !== "browser"),
    [allSessions],
  );

  const filter = treeFilter.trim().toLowerCase();
  const statusFiltering = statusFilter !== null;
  const filtering = filter.length > 0 || statusFiltering;

  // Status filtering uses the snapshot captured when the filter was activated, plus any dynamic additions.
  const statusMatch = (s: Session) =>
    !statusFiltering || (!!statusFilterIds && s.id in statusFilterIds);
  // Name matching is independent of status. Disable downward name propagation under a status filter.
  const nameHit = (name: string) =>
    !statusFiltering && filter.length > 0 && name.toLowerCase().includes(filter);
  const sessionMatch = (s: Session) =>
    (!filter || s.name.toLowerCase().includes(filter)) && statusMatch(s);
  const sessionSubtreeVisible = (s: Session): boolean =>
    sessionMatch(s) ||
    sessions.some((c) => c.parentSessionId === s.id && sessionSubtreeVisible(c));
  const sessionVisible = (s: Session) => !filtering || sessionSubtreeVisible(s);

  // During filtering, compute visible groups/projects from matched sessions and their ancestor chains.
  const { visGroups, visProjects } = useMemo(() => {
    if (!filtering) {
      return {
        visGroups: null as Set<string> | null,
        visProjects: null as Set<string> | null,
      };
    }
    const nodeNameMatch = (name: string) =>
      !statusFiltering && filter.length > 0 && name.toLowerCase().includes(filter);
    const subMemo = new Map<string, boolean>();
    const subtreeVisible = (s: Session): boolean => {
      const c = subMemo.get(s.id);
      if (c !== undefined) return c;
      const vis =
        ((!filter || s.name.toLowerCase().includes(filter)) &&
          (!statusFiltering || (!!statusFilterIds && s.id in statusFilterIds))) ||
        sessions.some((k) => k.parentSessionId === s.id && subtreeVisible(k));
      subMemo.set(s.id, vis);
      return vis;
    };
    // A group created while a status filter is active joins the snapshot so it stays visible even though it is empty.
    const keptGroup = (g: Group) =>
      statusFiltering && !!statusFilterIds && g.id in statusFilterIds &&
      (!filter || g.name.toLowerCase().includes(filter));
    const memo = new Map<string, boolean>();
    const groupVisible = (g: Group): boolean => {
      const cached = memo.get(g.id);
      if (cached !== undefined) return cached;
      const vis =
        nodeNameMatch(g.name) ||
        keptGroup(g) ||
        sessions.some(
          (s) => !s.parentSessionId && s.groupId === g.id && subtreeVisible(s),
        ) ||
        groups.some((c) => c.parentGroupId === g.id && groupVisible(c));
      memo.set(g.id, vis);
      return vis;
    };
    const visG = new Set<string>();
    for (const g of groups) if (groupVisible(g)) visG.add(g.id);
    const visP = new Set<string>();
    for (const p of projects) {
      const vis =
        nodeNameMatch(p.name) ||
        sessions.some(
          (s) =>
            !s.parentSessionId &&
            s.projectId === p.id &&
            !s.groupId &&
            subtreeVisible(s),
        ) ||
        groups.some((g) => g.projectId === p.id && visG.has(g.id));
      if (vis) visP.add(p.id);
    }
    return { visGroups: visG, visProjects: visP };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filtering, filter, statusFiltering, statusFilterIds, groups, sessions, projects]);

  // Build the visible row list recursively.
  const rows = useMemo(() => {
    const out: React.ReactNode[] = [];

    const pushSession = (s: Session, depth: number, ancestorMatched: boolean) => {
      const matched = ancestorMatched || nameHit(s.name);
      const allKids = sessions.filter((c) => c.parentSessionId === s.id);
      const kids =
        filtering && !matched ? allKids.filter(sessionVisible) : allKids;
      const expanded = filtering ? true : !s.collapsed;
      out.push(
        <SessionRow
          key={s.id}
          session={s}
          depth={depth}
          hasKids={kids.length > 0}
          expanded={expanded}
          filtering={filtering}
          onOpen={onOpen}
          onToggle={(id) => toggleCollapsed("session", id)}
        />,
      );
      if (expanded) for (const k of kids) pushSession(k, depth + 1, matched);
    };

    // Render direct child groups and sessions for a project/parent-group pair at the same depth.
    const walk = (
      projectId: string,
      parentGroupId: string | null,
      depth: number,
      ancestorMatched: boolean,
    ) => {
      let childGroups = groups.filter(
        (g) =>
          g.projectId === projectId &&
          (parentGroupId ? g.parentGroupId === parentGroupId : !g.parentGroupId),
      );
      if (filtering && !ancestorMatched && visGroups) {
        childGroups = childGroups.filter((g) => visGroups.has(g.id));
      }
      for (const g of childGroups) {
        const expanded = filtering ? true : !g.collapsed;
        const hasKids =
          groups.some((c) => c.parentGroupId === g.id) ||
          sessions.some((s) => !s.parentSessionId && s.groupId === g.id);
        out.push(
          <div
            key={g.id}
            className="m-node grp"
            style={{ paddingLeft: INDENT_BASE + depth * INDENT_STEP }}
            onClick={() => {
              if (!filtering && hasKids) toggleCollapsed("group", g.id);
            }}
          >
            <span className={hasKids ? "m-twist" : "m-twist empty"}>
              {hasKids && <Chevron open={expanded} />}
            </span>
            <span className="m-node-name">{g.name}</span>
          </div>,
        );
        if (expanded) {
          walk(projectId, g.id, depth + 1, ancestorMatched || nameHit(g.name));
        }
      }
      let childSessions = sessions.filter(
        (s) =>
          !s.parentSessionId &&
          s.projectId === projectId &&
          (parentGroupId ? s.groupId === parentGroupId : !s.groupId),
      );
      if (filtering && !ancestorMatched) {
        childSessions = childSessions.filter(sessionVisible);
      }
      for (const s of childSessions) pushSession(s, depth, ancestorMatched);
    };

    const visP =
      filtering && visProjects
        ? projects.filter((p) => visProjects.has(p.id))
        : projects.filter((p) => sessions.some((s) => s.projectId === p.id));
    for (const p of visP) {
      const expanded = filtering ? true : !p.collapsed;
      const hasKids =
        groups.some((g) => g.projectId === p.id) ||
        sessions.some((s) => s.projectId === p.id);
      out.push(
        <div
          key={p.id}
          className="m-node proj"
          style={{ paddingLeft: INDENT_BASE }}
          onClick={() => {
            if (!filtering && hasKids) toggleCollapsed("project", p.id);
          }}
        >
          <span className={hasKids ? "m-twist" : "m-twist empty"}>
            {hasKids && <Chevron open={expanded} />}
          </span>
          <span className="m-node-name">{p.name}</span>
        </div>,
      );
      if (expanded) walk(p.id, null, 1, nameHit(p.name));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    projects,
    groups,
    sessions,
    filtering,
    filter,
    statusFiltering,
    statusFilterIds,
    visGroups,
    visProjects,
    onOpen,
    toggleCollapsed,
  ]);

  return (
    <div className="m-page">
      <header className="m-header">
        <span className="m-brand">
          <img className="m-logo" src={apiUrl("/velaterm-light.svg")} alt="" draggable={false}
            style={{"--brand-logo-light":`url("${apiUrl("/velaterm-light.svg")}")`,"--brand-logo-dark":`url("${apiUrl("/velaterm-dark.svg")}")`} as CSSProperties} />
          VelaTerm
        </span>
        <span className="m-sp" />
        <details className="m-menu">
          <summary aria-label={tr("mobile.more")}>•••</summary>
          <div className="m-menu-items">
            <ConnectionMenuEntry />
            {onRefresh && <button type="button" disabled={loading} onClick={onRefresh}>{tr("common.refresh")}</button>}
            <button type="button" onClick={()=>applyViewOverride("desktop")}>{tr("mobile.toDesktop")}</button>
          </div>
        </details>
      </header>

      {sessions.length > 0 && (
        <div className="m-toolbar">
          <div className="m-search">
            <Icons.search size={14} />
            <input
              type="text"
              placeholder={tr("tree.searchPlaceholder")}
              value={treeFilter}
              onChange={(e) => setTreeFilter(e.target.value)}
            />
            {treeFilter && (
              <button
                type="button"
                className="m-search-clear"
                title={tr("tree.clearSearch")}
                onClick={() => setTreeFilter("")}
              >
                <Icons.clear size={13} />
              </button>
            )}
          </div>
          <StatusChips />
        </div>
      )}

      {loading && <div className="m-load-status" role="status">{tr("common.loading")}</div>}
      {error && <div className="m-load-error" role="alert"><p>{error}</p><button type="button" onClick={onRefresh}>{tr("common.retry")}</button></div>}
      <div className="m-list" aria-busy={loading}>
        {rows}
        {!loading && !error && sessions.length === 0 && (
          <div className="m-empty">
            {tr("mobile.empty1")}
            <br />
            {tr("mobile.empty2")}
          </div>
        )}
        {!loading && !error && sessions.length > 0 && rows.length === 0 && (
          <div className="m-nomatch">{tr("mobile.noMatch")}</div>
        )}
      </div>
    </div>
  );
}
