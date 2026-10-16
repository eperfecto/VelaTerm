//! Knowledge-base Collections: archived sessions kept alongside knowledge entries. The right tree
//! shows archived roots grouped by their original project, and the main area browses them, searches
//! their full content, and reads one conversation together with the entries generated from it.
//!
//! The archive overlay that used to host this functionality was removed; restore, export, delete and
//! organize actions all live here now.

import { useEffect, useMemo, useState } from "react";
import Icons from "../../components/Icons";
import { canExportContext, exportSessionToFile } from "../../exportSession";
import { useT } from "../../i18n";
import { memoryCollections, memoryList, type MemoryCollectionProject } from "../../ipc/memory";
import { useTermStore } from "../../store/termStore";
import type { Session } from "../../types";
import { SearchConsole, summarizeResults, useContentSearch, useSearchNav } from "../GlobalSearch/searchKit";
import { KnowledgeTreeRow, knowledgeSelection } from "../Notebook/KnowledgeTreeRow";
import { SessionContentViewer } from "../sessionViewers/SessionContentViewer";
import { fmtArchivedAt, KindIcon, locationOf } from "../sessionViewers/sessionMeta";
import { MemoryLink, memoryNavigate, memoryUrl, useMemoryLocation } from "./navigation";
import { LoadState, MemoryIcon, memoryTime, useMemoryLoad } from "./shared";
import "./memory.css";

/** Window event that tells every collections surface to reload after a restore or permanent delete. */
const COLLECTIONS_CHANGED = "memory:collections";

function projectName(project: MemoryCollectionProject, fallback: string): string {
  return project.name || fallback;
}

/** Right-panel tree: archived roots under the project they were archived from. */
export function MemoryCollectionsDirectory() {
  const t = useT();
  const location = useMemoryLocation();
  const params = new URLSearchParams(location);
  const [page, id = ""] = (params.get("memory") ?? "").split("/");
  const projectId = params.get("memoryCollectionProject") ?? "";
  const { data, error, reload } = useMemoryLoad(memoryCollections, []);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const open = (key: string) => setExpanded((old) => (old.has(key) ? old : new Set(old).add(key)));
  const toggle = (key: string) =>
    setExpanded((old) => {
      const next = new Set(old);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  useEffect(() => {
    const project = projectId || data?.projects.find((p) => p.sessions.some((s) => s.id === id))?.id;
    if (project) open(project);
  }, [data, projectId, id]);
  useEffect(() => {
    window.addEventListener(COLLECTIONS_CHANGED, reload);
    return () => window.removeEventListener(COLLECTIONS_CHANGED, reload);
  }, [reload]);
  const sessionById = useMemo(() => new Map((data?.sessions ?? []).map((s) => [s.id, s])), [data]);
  return <ul className="nb-tree-branches memory-directory">
    {(!data || error) && <li><LoadState error={error} reload={reload} /></li>}
    {data && !data.projects.length && <li className="nb-tree-empty">{t("archive.empty1")}</li>}
    {data?.projects.map((project) => <KnowledgeTreeRow key={project.id} name={projectName(project, t("memory.unknownProject"))}
      route="collections" values={{ ...knowledgeSelection, memoryCollectionProject: project.id, memoryCollectionQuery: null }} depth={1}
      icon={<Icons.folder size={15} />} count={project.count || undefined}
      selected={page === "collections" && projectId === project.id && !id}
      expanded={expanded.has(project.id)} onToggle={() => toggle(project.id)} onOpen={() => open(project.id)}>
      <ul className="nb-tree-branches">
        {project.sessions.map((session) => {
          const live = sessionById.get(session.id);
          return <KnowledgeTreeRow key={session.id} name={session.name} route={`collection/${session.id}`}
            values={{ ...knowledgeSelection, memoryCollectionProject: project.id, memoryCollectionQuery: null }} depth={2}
            icon={live ? <KindIcon session={live} size={15} /> : <Icons.bot size={15} />} count={session.count || undefined}
            title={[projectName(project, t("memory.unknownProject")), ...session.groupPath].filter(Boolean).join(" › ")}
            selected={page === "collection" && id === session.id} />;
        })}
      </ul>
    </KnowledgeTreeRow>)}
  </ul>;
}

/** Main area: browse, archive-wide search, and one archived conversation with its knowledge entries. */
export function MemoryCollections({ sessionId }: { sessionId: string }) {
  const t = useT();
  const location = useMemoryLocation();
  const params = new URLSearchParams(location);
  const query = params.get("memoryCollectionQuery") ?? "";
  const projectId = params.get("memoryCollectionProject") ?? "";
  const { data, error, reload } = useMemoryLoad(memoryCollections, []);
  const loadArchived = useTermStore((s) => s.loadArchived);
  const restoreSession = useTermStore((s) => s.restoreSession);
  const deleteNode = useTermStore((s) => s.deleteNode);
  const liveProjects = useTermStore((s) => s.projects);
  const groups = useTermStore((s) => s.groups);
  const liveSessions = useTermStore((s) => s.sessions);
  useEffect(() => { void loadArchived(); }, [loadArchived]);
  useEffect(() => {
    window.addEventListener(COLLECTIONS_CHANGED, reload);
    return () => window.removeEventListener(COLLECTIONS_CHANGED, reload);
  }, [reload]);
  const search = useContentSearch("archived", query);
  const nav = useSearchNav(search.results);
  const { totalMatches, sessions: matchedSessions } = summarizeResults(search.results);
  const sessionById = useMemo(() => new Map((data?.sessions ?? []).map((s) => [s.id, s])), [data]);
  const session = sessionId ? sessionById.get(sessionId) : undefined;
  const project = data?.projects.find((p) => p.sessions.some((s) => s.id === sessionId)) ?? data?.projects.find((p) => p.id === projectId);
  const row = project?.sessions.find((s) => s.id === sessionId);
  const projectLabel = project ? projectName(project, t("memory.unknownProject")) : "";
  // Tombstoned projects and groups are not in the live tree, so search results use the stored path.
  const storedPaths = useMemo(() => {
    const paths = new Map<string, string>();
    for (const item of data?.projects ?? []) {
      const name = projectName(item, t("memory.unknownProject"));
      for (const archived of item.sessions) paths.set(archived.id, [name, ...archived.groupPath].filter(Boolean).join(" › "));
    }
    return paths;
  }, [data, t]);
  // The default tab follows the stored entry count; an explicit choice is carried in the URL.
  const storedTab = params.get("memoryCollectionTab");
  const tab = storedTab === "conversation" || storedTab === "entries" ? storedTab : row?.count ? "entries" : "conversation";
  const refresh = () => { reload(); void loadArchived(); };
  const changed = () => { window.dispatchEvent(new Event(COLLECTIONS_CHANGED)); void loadArchived(); };
  const restore = async (id: string) => {
    await restoreSession(id);
    changed();
    if (id === sessionId) memoryNavigate(memoryUrl("collections", { memoryCollectionProject: project?.id ?? null }));
  };
  const remove = async (id: string) => {
    await deleteNode("session", id);
    await loadArchived();
    window.dispatchEvent(new Event(COLLECTIONS_CHANGED));
    if (id === sessionId) memoryNavigate(memoryUrl("collections", { memoryCollectionProject: project?.id ?? null }));
  };
  const actions = (target: Session) => <>
    <button type="button" className="memory-toolbar-button" title={t("archive.restore")} aria-label={t("archive.restore")} onClick={() => void restore(target.id)}><Icons.archiveRestore size={14} aria-hidden="true" /></button>
    <MemoryLink route={`compile/${target.id}`} className="memory-toolbar-button" title={t("memory.add")} aria-label={t("memory.add")}><MemoryIcon size={14} /></MemoryLink>
    {canExportContext(target) && <button type="button" className="memory-toolbar-button" title={t("archive.export")} aria-label={t("archive.export")} onClick={() => void exportSessionToFile(target)}><Icons.archiveExport size={14} aria-hidden="true" /></button>}
    <button type="button" className="memory-toolbar-button" title={t("archive.deleteForever")} aria-label={t("archive.deleteForever")} style={{ color: "var(--status-error)" }} onClick={() => void remove(target.id)}><Icons.trash size={14} aria-hidden="true" /></button>
  </>;
  const totalSessions = data?.projects.reduce((sum, item) => sum + item.sessions.length, 0) ?? 0;
  return <main className="memory-browser-main">
    <div className="memory-browser-toolbar" data-reading={!!sessionId}>
      <div className="memory-browser-location">
        <nav aria-label={t("memory.hierarchy")}>
          <MemoryLink route="collections" values={{ memoryCollectionProject: null, memoryCollectionQuery: null, memoryCollectionTab: null }}>{t("memory.collections")}</MemoryLink>
          {project && <><span aria-hidden="true">/</span><MemoryLink route="collections" values={{ memoryCollectionProject: project.id, memoryCollectionQuery: null, memoryCollectionTab: null }}>{projectLabel}</MemoryLink></>}
          {session && <><span aria-hidden="true">/</span><MemoryLink route={`collection/${session.id}`} values={{ memoryCollectionProject: project?.id ?? null, memoryCollectionQuery: null, memoryCollectionTab: null }}>{session.name}</MemoryLink></>}
        </nav>
        {!sessionId && data && <span className="memory-browser-count" title={t("memory.collections")}>{totalSessions}</span>}
      </div>
      {sessionId ? <div className="memory-browser-controls memory-collection-actions">
        {session && actions(session)}
      </div> : <div className="memory-browser-controls">
        <label className="memory-browser-search">
          <Icons.search size={15} aria-hidden="true" />
          <input aria-label={t("archive.searchPlaceholder")} placeholder={t("archive.searchPlaceholder")} value={query}
            onChange={(e) => memoryNavigate(memoryUrl("collections", { memoryCollectionProject: null, memoryCollectionQuery: e.target.value || null, memoryCollectionTab: null }), true)} />
        </label>
        <div className="memory-browser-filters">
          {query.trim() && <span className="memory-browser-count">{search.loading ? t("search.searching") : t("search.summary", totalMatches, matchedSessions)}</span>}
          <button type="button" className="memory-toolbar-button" aria-label={t("common.refresh")} title={t("common.refresh")} onClick={refresh}><Icons.refresh size={15} aria-hidden="true" /></button>
        </div>
      </div>}
    </div>
    <div className="memory-browser-content" data-collection={sessionId ? "session" : query.trim() ? "search" : "browse"}>
      {!data ? <LoadState error={error} reload={refresh} /> : sessionId ? (
        (!session || !row) ? <p className="memory-empty">{t("memory.notFound")}</p> : <>
          <div className="memory-collection-tabs" role="tablist">
            <MemoryLink role="tab" aria-selected={tab === "conversation"} className={`memory-collection-tab${tab === "conversation" ? " active" : ""}`}
              route={`collection/${session.id}`} values={{ memoryCollectionProject: project?.id ?? null, memoryCollectionTab: "conversation", memoryCollectionQuery: null }}>{t("memory.collectionConversation")}</MemoryLink>
            <MemoryLink role="tab" aria-selected={tab === "entries"} className={`memory-collection-tab${tab === "entries" ? " active" : ""}`}
              route={`collection/${session.id}`} values={{ memoryCollectionProject: project?.id ?? null, memoryCollectionTab: "entries", memoryCollectionQuery: null }}>{t("memory.entries")}{row.count ? ` · ${row.count}` : ""}</MemoryLink>
          </div>
          {tab === "conversation"
            ? <div className="memory-collection-viewer"><SessionContentViewer key={session.id} session={session} /></div>
            : <CollectionEntries sessionId={session.id} />}
        </>) : query.trim() ? (
        <SearchConsole nav={nav} results={search.results} sessionById={sessionById} projects={liveProjects} groups={groups} liveSessions={liveSessions}
          sessionLocation={(s) => storedPaths.get(s.id) ?? locationOf(s, liveProjects, groups, liveSessions)}
          renderGroupActions={(_hit, target) => (target ? actions(target) : null)}
          emptyHint={search.loading ? t("search.searching") : t("search.noResults")} />
      ) : (
        <div className="memory-collection-groups">
          {!data.projects.length ? <p className="memory-empty">{t("archive.empty1")}<br />{t("archive.empty2")}</p>
            : (projectId && project ? [project] : data.projects).map((item) => <section key={item.id} className="memory-collection-group">
              <h3>{projectName(item, t("memory.unknownProject"))}{item.count > 0 && <small>{item.count}</small>}</h3>
              <div className="memory-collection-rows">
                {item.sessions.map((archived) => {
                  const live = sessionById.get(archived.id);
                  return <div key={archived.id} className="memory-collection-row">
                    <MemoryLink route={`collection/${archived.id}`} values={{ memoryCollectionProject: item.id, memoryCollectionTab: null }} className="memory-collection-row-link" title={archived.name}>
                      <span className="memory-collection-icon">{live ? <KindIcon session={live} size={15} /> : <Icons.bot size={15} />}</span>
                      <span className="memory-collection-row-main">
                        <strong>{archived.name}</strong>
                        <small>{[...archived.groupPath, fmtArchivedAt(archived.archivedAt)].filter(Boolean).join(" · ")}</small>
                      </span>
                      {archived.count > 0 && <span className="memory-browser-count" title={t("memory.entries")}>{archived.count}</span>}
                    </MemoryLink>
                    {live && <span className="memory-collection-actions">{actions(live)}</span>}
                  </div>;
                })}
              </div>
            </section>)}
        </div>
      )}
    </div>
  </main>;
}

/** Knowledge entries generated from one archived session, with the organize entry when empty. */
function CollectionEntries({ sessionId }: { sessionId: string }) {
  const t = useT();
  const { data, error, reload } = useMemoryLoad(() => memoryList({ query: "", tag: "", sort: "updated", page: 0, sessionId }), [sessionId]);
  if (!data) return <LoadState error={error} reload={reload} />;
  if (!data.entries.length) return <p className="memory-empty">{t("memory.collectionEmptyEntries")} <MemoryLink route={`compile/${sessionId}`}>{t("memory.add")}</MemoryLink></p>;
  return <div className="memory-collection-entries">
    <div className="memory-entry-list">
      {data.entries.map((entry) => <div key={entry.id} className="memory-entry-card">
        <MemoryLink route={`entry/${entry.id}`} values={{ memoryProject: null, memorySession: sessionId }} className="memory-entry-card-link">
          <div className="memory-entry-card-heading"><strong>{entry.title}</strong><span aria-hidden="true">↗</span></div>
          {entry.summary && <p>{entry.summary}</p>}
          <div className="memory-entry-card-footer">
            <div className="memory-tags">{entry.tags.map((value) => <span key={value}>{value}</span>)}</div>
            <small>{memoryTime(entry.updatedAt)}</small>
          </div>
        </MemoryLink>
      </div>)}
    </div>
  </div>;
}
