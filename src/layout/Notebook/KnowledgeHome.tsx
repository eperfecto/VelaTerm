import Icons from "../../components/Icons";
import { useT } from "../../i18n";
import type { NotebookOverview } from "../../ipc/notebook";
import { MemoryLink } from "../Memory/navigation";
import { KnowledgeHomeSearch } from "./KnowledgeHomeSearch";
import { knowledgeSelection } from "./KnowledgeTreeRow";
import { notebookRoute } from "./shared";
import { showVaultAction } from "./VaultActions";
import { useNotebookImports } from "./importManager";

export function KnowledgeHome({ overview }: { overview: NotebookOverview }) {
  const t = useT();
  const running = [...useNotebookImports().values()];
  return <main className="nb-home">
    <header><div><h1>{t("memory.title")}</h1><p>{t("nb.homeHint")}</p></div><div className="nb-inline">
      <button type="button" className="btn" onClick={() => showVaultAction("open")}><Icons.folderOpen />{t("nb.openVault")}</button>
      <button type="button" className="btn btn-primary" onClick={() => showVaultAction("new")}><Icons.folderPlus />{t("nb.createVault")}</button>
    </div></header>
    {running.map(state => {
      const vault = overview.vaults.find(item => item.id === state.vaultId);
      return <MemoryLink key={state.vaultId} className="nb-import-chip nb-import-chip-wide" route={notebookRoute(state.vaultId, "imports")} title={state.current}>
        <Icons.notebookImport size={12} /><span>{vault?.name ?? state.destination} · {t("nb.importProgress", String(state.done), String(state.files))}</span>
        <progress max={1} value={state.bytes ? state.sent / state.bytes : 1} />
      </MemoryLink>;
    })}
    <KnowledgeHomeSearch>
      <section className="nb-home-group">
        <h2>{t("memory.globalMemory")}</h2>
        <div className="nb-vault-grid">
          <MemoryLink className="nb-vault-card" route="library" values={knowledgeSelection} aria-label={t("memory.globalMemory")}><Icons.memoryGlobal size={24} /><div><p>{t("nb.generatedHint")}</p></div><Icons.arrowRight /></MemoryLink>
        </div>
      </section>
      <section className="nb-home-group">
        <h2>{t("nb.localVaults")}</h2>
        {overview.vaults.length ? <div className="nb-vault-grid">
          {overview.vaults.map(vault => <MemoryLink key={vault.id} className="nb-vault-card" route={notebookRoute(vault.id)} values={knowledgeSelection}>
            <Icons.folder size={24} /><div><strong>{vault.name}</strong><p title={vault.root}>{vault.root}</p></div><Icons.arrowRight />
          </MemoryLink>)}
        </div> : <p>{t("nb.empty")}</p>}
      </section>
    </KnowledgeHomeSearch>
  </main>;
}
