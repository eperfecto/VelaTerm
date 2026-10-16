import { useEffect, useState, type ReactNode } from "react";
import Icons from "../../components/Icons";
import Select from "../../components/Select";
import { useT } from "../../i18n";
import { memoryList } from "../../ipc/memory";
import { highlightMatches } from "../sessionViewers/highlight";
import { MemoryLink, memoryNavigate, memoryUrl, useMemoryLocation } from "./navigation";
import { LoadState, memoryTime, useMemoryLoad } from "./shared";

export function MemoryLibrary({ selected, children }: { selected: string; children?: ReactNode }) {
  const t = useT(); const location = useMemoryLocation(); const params = new URLSearchParams(location);
  const query = params.get("memoryQuery") ?? ""; const tag = params.get("memoryTag") ?? "";
  const sort = params.get("memorySort") ?? "updated"; const page = Math.max(0, Number(params.get("memoryPage")) || 0);
  const projectId = params.get("memoryProject"); const sessionId = params.get("memorySession");
  const [input, setInput] = useState(query);
  const { data, error, reload: reloadEntries } = useMemoryLoad(() => memoryList({ query, tag, sort, page, ...(sessionId !== null ? { sessionId } : {}), ...(projectId !== null ? { projectId } : {}), selectedId: selected }), [query, tag, sort, page, selected, projectId, sessionId]);
  // Breadcrumbs describe the current folder even when its search has no matches.
  const hierarchy = useMemoryLoad(() => projectId || sessionId || selected
    ? memoryList({ query: "", tag: "", sort: "title", page: 0, selectedId: selected })
    : Promise.resolve(null), [projectId, sessionId, selected]);
  const directory = hierarchy.data ?? data;
  const reload = () => { reloadEntries(); hierarchy.reload(); };
  const activeSession = directory?.selectedSessionId ?? sessionId;
  const project = directory?.projects?.find((p) => p.sessions.some((s) => s.id === activeSession)) ?? directory?.projects?.find((p) => p.id === projectId);
  const activeProject = project?.id ?? projectId;
  const session = project?.sessions.find((s) => s.id === activeSession);
  const scope = { memoryProject: activeProject, memorySession: activeSession };
  const groupName = (group: { name: string; kind: string }) => group.name || t(group.kind === "manual" ? "memory.manualGroup" : group.kind === "legacy" ? "memory.legacyGroup" : "memory.unknownProject");
  useEffect(() => setInput(query), [query]);
  useEffect(() => {
    if (selected || input === query) return;
    const timer = setTimeout(() => memoryNavigate(memoryUrl("library", { memoryQuery: input, memoryPage: null, memoryProject: activeProject, memorySession: activeSession }), true), 250);
    return () => clearTimeout(timer);
  }, [input, query, location, activeProject, activeSession, selected]);
  useEffect(() => {
    window.addEventListener("memory:saved", reload);
    return () => window.removeEventListener("memory:saved", reload);
  }, [reload]);
  return <div className="memory-workspace">
    <main className="memory-browser-main">
      <div className="memory-browser-toolbar" data-reading={!!selected}>
        <div className="memory-browser-location">
          <nav aria-label={t("memory.hierarchy")}>
            <MemoryLink route="library" values={{ memoryProject: null, memorySession: null, memoryPage: null }}>{t("memory.entries")}</MemoryLink>
            {project && <><span aria-hidden="true">/</span><MemoryLink route="library" values={{ memoryProject: project.id, memorySession: null, memoryPage: null }}>{groupName(project)}</MemoryLink></>}
            {session && <><span aria-hidden="true">/</span><MemoryLink route="library" values={{ ...scope, memoryPage: null }}>{groupName(session)}</MemoryLink></>}
          </nav>
          {!selected && data && <span className="memory-browser-count" title={t("memory.entries")}>{data.total}</span>}
        </div>
        {selected ? <MemoryLink route="library" values={{ ...scope, memoryPage: null }} className="memory-toolbar-button" aria-label={t("memory.search")} title={t("memory.search")}><Icons.search size={15} aria-hidden="true" /></MemoryLink> : <div className="memory-browser-controls">
          <label className="memory-browser-search">
            <Icons.search size={15} aria-hidden="true" />
            <input aria-label={t("memory.search")} placeholder={t("memory.search")} value={input} onChange={(e) => setInput(e.target.value)} />
          </label>
          <div className="memory-browser-filters">
            <Select size="sm" width={130} value={tag} title={tag || t("memory.allTags")} ariaLabel={t("nb.tags")} onChange={(value) => memoryNavigate(memoryUrl("library", { ...scope, memoryTag: value, memoryPage: null }))} options={[{ value: "", label: t("memory.allTags") }, ...(tag && !data?.tags.includes(tag) ? [{ value: tag, label: tag }] : []), ...(data?.tags ?? []).map((value) => ({ value, label: value }))]} />
            <Select size="sm" width={130} value={sort} ariaLabel={t("memory.updated")} onChange={(value) => memoryNavigate(memoryUrl("library", { ...scope, memorySort: value, memoryPage: null }))} options={[{ value: "updated", label: t("memory.updated") }, { value: "title", label: t("memory.titleSort") }]} />
            <button type="button" className="memory-toolbar-button" aria-label={t("common.refresh")} title={t("common.refresh")} onClick={reload}><Icons.refresh size={15} aria-hidden="true" /></button>
          </div>
        </div>}
      </div>
      <div className="memory-browser-content">
        {selected ? children : !data ? <LoadState error={error} reload={reload} /> : <>
          {data.fuzzy && <p className="memory-muted">{t("nb.searchFuzzy")}</p>}
          {!data.entries.length ? <p className="memory-empty">{t("memory.empty")}</p> : <div className="memory-entry-list">
            {data.entries.map((entry) => {
              const owner = data.projects?.find((p) => p.sessions.some((s) => s.id === (entry.sessionId || "__manual__")));
              const origin = owner?.sessions.find((s) => s.id === (entry.sessionId || "__manual__"));
              return <div key={entry.id} className="memory-entry-card">
                <MemoryLink route={`entry/${entry.id}`} values={{ memoryProject: owner?.id ?? activeProject, memorySession: origin?.id ?? activeSession }} className="memory-entry-card-link">
                  <div className="memory-entry-card-heading"><strong>{entry.title}</strong><span aria-hidden="true">↗</span></div>
                  {query && entry.snippet
                    ? <p>{highlightMatches(entry.snippet, entry.matched?.length ? entry.matched : query.trim().split(/\s+/).filter(Boolean))}</p>
                    : entry.summary && <p>{entry.summary}</p>}
                  <div className="memory-entry-card-footer">
                    <div className="memory-tags">{entry.tags.map((value) => <span key={value}>{value}</span>)}</div>
                    <small>{owner && origin && !activeSession ? `${groupName(owner)} / ${groupName(origin)} · ` : ""}{memoryTime(entry.updatedAt)}</small>
                  </div>
                </MemoryLink>
                {entry.related?.length ? <div className="memory-entry-related">
                  <span>{t("memory.related")}</span>
                  {entry.related.map((related) => <MemoryLink key={related.id} route={`entry/${related.id}`} values={scope}>{related.title}</MemoryLink>)}
                </div> : null}
              </div>;
            })}
          </div>}
          {data.total > data.pageSize && <footer className="memory-pagination">
            {page > 0 ? <MemoryLink route="library" values={{ ...scope, memoryPage: page - 1 }}>{t("common.prev")}</MemoryLink> : <span />}
            <span>{page + 1} / {Math.ceil(data.total / data.pageSize)}</span>
            {(page + 1) * data.pageSize < data.total && <MemoryLink route="library" values={{ ...scope, memoryPage: page + 1 }}>{t("common.next")}</MemoryLink>}
          </footer>}
        </>}
        {selected && error && <LoadState error={error} reload={reload} />}
      </div>
    </main>
  </div>;
}
