import { useEffect, useState } from "react";
import Icons from "../../components/Icons";
import { useT } from "../../i18n";
import { notebookOverview, notebookTree } from "../../ipc/notebook";
import { MemoryLink, useMemoryLocation } from "../Memory/navigation";
import { MemoryDirectory } from "../Memory/MemoryDirectory";
import { MemoryCollectionsDirectory } from "../Memory/MemoryCollections";
import { useTermStore } from "../../store/termStore";
import { KnowledgeTreeRow, knowledgeSelection, treeKey, useKnowledgeTree } from "./KnowledgeTreeRow";
import { KnowledgeTreeProvider } from "./KnowledgeTreeActions";
import { KnowledgeSearchResults, useKnowledgeSearch, useSearchKeys } from "./KnowledgeSearch";
import { NotebookError, notebookRoute, openVaultFile, useNotebookLoad } from "./shared";
import { showVaultAction } from "./VaultActions";
import "./notebook.css";

export function KnowledgeNavigation() {
  return <KnowledgeTreeProvider><KnowledgeNavigationTree /></KnowledgeTreeProvider>;
}

function KnowledgeNavigationTree() {
  const t = useT();
  const search = useMemoryLocation();
  const [page, id] = (new URLSearchParams(search).get("memory") ?? "").split('/');
  const { data, error, reload } = useNotebookLoad(notebookOverview, [page, id]);
  const session = !!page && !["notebook", "notebooks", "collections", "collection"].includes(page);
  const collections = page === "collections" || page === "collection";
  const selectedRoot = collections ? "collections" : session ? "session" : page === "notebook" ? id : "";
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(["local", ...(selectedRoot ? [selectedRoot] : [])]));
  const open = (key: string) => setExpanded(old => old.has(key) ? old : new Set(old).add(key));
  const toggle = (key: string) => setExpanded(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  useEffect(() => { if (selectedRoot) { open(selectedRoot); if (selectedRoot !== "session") open("local"); } }, [selectedRoot, search]);
  useEffect(() => {
    window.addEventListener("notebook:vaultsChanged", reload);
    window.addEventListener("focus", reload);
    return () => { window.removeEventListener("notebook:vaultsChanged", reload); window.removeEventListener("focus", reload); };
  }, [reload]);
  const params = new URLSearchParams(search);
  // Looking a note up by name or content; the hit list replaces the tree while a query is present.
  const [query, setQuery] = useState("");
  const lookup = useKnowledgeSearch(query);
  const hits = lookup.result?.entries ?? [];
  const openHit = (index: number) => {
    const hit = hits[index];
    if (hit) openVaultFile(hit.absolutePath);
  };
  const keys = useSearchKeys(hits.length, openHit, () => setQuery(""));
  const searching = query.trim().length > 0;
  return <div className="nb-navigation">
    <header className="nb-navigation-heading"><MemoryLink route="notebooks" values={knowledgeSelection}>{t("nb.vaults")}</MemoryLink><div>
      <button className="nb-icon-button" title={t("nb.openVault")} aria-label={t("nb.openVault")} onClick={() => showVaultAction("open")}><Icons.folderOpen /></button>
      <button className="nb-icon-button" title={t("nb.createVault")} aria-label={t("nb.createVault")} onClick={() => showVaultAction("new")}><Icons.folderPlus /></button>
    </div></header>
    <div className="nb-navigation-search">
      <Icons.search size={14} aria-hidden="true" />
      <input value={query} aria-label={t("nb.search")} placeholder={t("nb.search")} onKeyDown={keys.onKeyDown} onChange={(e) => setQuery(e.target.value)} />
    </div>
    {searching ? <div className="nb-knowledge-tree">
      <KnowledgeSearchResults query={query} result={lookup.result} error={lookup.error} active={keys.active} onActive={keys.setActive} onOpen={openHit} onOpenRelated={(related)=>openVaultFile(related.absolutePath)} compact />
    </div> : <nav className="nb-knowledge-tree" aria-label={t("nb.vaults")}>
      <ul className="nb-tree-branches">
        <KnowledgeTreeRow name={t("memory.globalMemory")} route="library" values={knowledgeSelection} depth={0} icon={<Icons.memoryGlobal size={15} />}
          selected={session && page === "library" && !params.has("memoryProject") && !params.has("memorySession")}
          expanded={expanded.has("session")} onToggle={() => toggle("session")} onOpen={() => open("session")}>
          <MemoryDirectory />
        </KnowledgeTreeRow>
        <KnowledgeTreeRow name={t("memory.collections")} route="collections" values={{ ...knowledgeSelection, memoryCollectionProject: null, memoryCollectionQuery: null }} depth={0} icon={<Icons.memoryCollections size={15} />}
          selected={collections && !params.has("memoryCollectionProject")}
          expanded={expanded.has("collections")} onToggle={() => toggle("collections")} onOpen={() => open("collections")}>
          <MemoryCollectionsDirectory />
        </KnowledgeTreeRow>
        <KnowledgeTreeRow name={t("nb.localVaults")} depth={0} icon={<Icons.folder size={15} />}
          expanded={expanded.has("local")} onToggle={() => toggle("local")} onActivate={() => toggle("local")}>
          <ul className="nb-tree-branches">
            {data?.vaults.map(v => <KnowledgeTreeRow key={v.id} name={v.name} route={notebookRoute(v.id)} values={knowledgeSelection} depth={1} title={v.root} icon={<Icons.folder size={15} />}
              target={{ key: treeKey.vault(v.id), kind: "vault", id: v.id, name: v.name, root: v.root }}
              selected={page === "notebook" && id === v.id && !params.has("memoryPath") && !params.has("memoryFolder") && !params.has("memoryFilter")}
              expanded={expanded.has(v.id)} onToggle={() => toggle(v.id)} onOpen={() => open(v.id)}>
              <NotebookDirectory id={v.id} />
            </KnowledgeTreeRow>)}
            {data && !data.vaults.length && <li className="nb-tree-empty">{t("nb.empty")}</li>}
          </ul>
        </KnowledgeTreeRow>
      </ul>
      {error && <NotebookError error={error} retry={reload} />}
      {!data && !error && <NotebookError error="" />}
    </nav>}
  </div>;
}

/** Forward-slash form used to compare native absolute paths independent of the platform separator. */
const norm = (path: string) => path.replace(/\\/g, "/");
/** Path relative to a vault root, or empty when the absolute path belongs to another location. */
function relativeTo(root: string, absolute: string): string {
  const base = norm(root).replace(/\/+$/, "");
  const target = norm(absolute);
  return base && target.startsWith(`${base}/`) ? target.slice(base.length + 1) : "";
}

function NotebookDirectory({ id }: { id: string }) {
  const t = useT();
  const search = useMemoryLocation();
  const actions = useKnowledgeTree();
  const params = new URLSearchParams(search);
  const active = params.get("memory")?.split('/').slice(0, 2).join('/') === notebookRoute(id);
  const folder = active ? params.get("memoryFolder") ?? "" : "";
  const activeDocPath = useTermStore(state => state.activeTabId ? state.docTabs[state.activeTabId]?.path ?? "" : "");
  const { data, error, reload } = useNotebookLoad(() => notebookTree(id), [id, search, actions?.revision ?? 0]);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const open = (key: string) => setExpanded(old => old.has(key) ? old : new Set(old).add(key));
  const toggle = (key: string) => setExpanded(old => { const next = new Set(old); if (next.has(key)) next.delete(key); else next.add(key); return next; });
  useEffect(() => {
    const selected = relativeTo(data?.vault.root ?? "", activeDocPath) || folder;
    if (!selected) return;
    setExpanded(old => {
      const next = new Set(old), parts = selected.split('/');
      for (let i = 1; i < parts.length; i++) next.add(parts.slice(0, i).join('/'));
      if (folder) next.add(folder);
      return next;
    });
  }, [data?.vault.root, activeDocPath, folder]);
  useEffect(() => {
    const update = () => { if (!document.hidden) reload(); };
    const timer = setInterval(update, 5000);
    window.addEventListener("focus", update);
    return () => { clearInterval(timer); window.removeEventListener("focus", update); };
  }, [reload]);
  const renderTree = (parent = "", depth = 2): React.ReactNode => data?.nodes.filter(n => (n.path.includes('/') ? n.path.slice(0, n.path.lastIndexOf('/')) : "") === parent).map(n => {
    const isFolder = n.kind === "folder";
    return <KnowledgeTreeRow key={n.path} name={n.kind === "note" ? n.name.replace(/\.md$/i, "") : n.name} route={isFolder ? notebookRoute(id) : undefined} title={n.path} depth={depth}
      target={{ key: treeKey.notebookNode(id, n.path), kind: "notebookNode", vaultId: id, path: n.path, name: n.name, nodeKind: n.kind }}
      values={isFolder ? { ...knowledgeSelection, memoryPath: null, memoryFolder: n.path } : undefined}
      onActivate={isFolder ? undefined : () => useTermStore.getState().openDocTab(n.absolutePath)}
      selected={isFolder ? n.path === folder : norm(n.absolutePath) === norm(activeDocPath)}
      icon={isFolder ? <Icons.folder size={15} /> : n.kind === "note" ? <Icons.docLines size={15} /> : <Icons.file size={15} />}
      expanded={isFolder && expanded.has(n.path)} onToggle={isFolder ? () => toggle(n.path) : undefined} onOpen={isFolder ? () => open(n.path) : undefined}>
      {n.kind === "folder" && <ul className="nb-tree-branches">{renderTree(n.path, depth + 1)}</ul>}
    </KnowledgeTreeRow>;
  });
  return <ul className="nb-tree-branches nb-file-tree">
    {(!data || error) && <li><NotebookError error={error} retry={reload} /></li>}
    {data && renderTree()}
    {data && !data.nodes.length && <li className="nb-tree-empty">{t("nb.chooseNote")}</li>}
  </ul>;
}
