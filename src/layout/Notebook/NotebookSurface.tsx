import { useEffect, useRef, useState } from "react";
import Icons from "../../components/Icons";
import Select from "../../components/Select";
import { useT } from "../../i18n";
import { notebookOverview, notebookRestore, notebookTree, type NotebookOverview, type NotebookNode } from "../../ipc/notebook";
import { MemoryLink, memoryNavigate, memoryUrl, useMemoryLocation } from "../Memory/navigation";
import { memoryTime } from "../Memory/shared";
import { CopyKnowledgeDialog, NotebookDialog } from "./NotebookDialogs";
import { KnowledgeSearchResults, useKnowledgeSearch, useSearchKeys } from "./KnowledgeSearch";
import { NotebookError, notebookError, notebookRoute, openVaultFile, useNotebookLoad } from "./shared";
import { KnowledgeHome } from "./KnowledgeHome";
import { knowledgeSelection } from "./KnowledgeTreeRow";
import { ImportRecords } from "./ImportRecords";
import { KnowledgeBackLink } from "./KnowledgeBack";
import { useNotebookImports, type NotebookImportOutcome } from "./importManager";
import "./notebook.css";

export function NotebookSurface({route}:{route:string}) {
  const {data,error,reload}=useNotebookLoad(notebookOverview,[]);const [page,id="",action=""]=route.split('/');
  useEffect(()=>{window.addEventListener("notebook:vaultsChanged",reload);window.addEventListener("focus",reload);return()=>{window.removeEventListener("notebook:vaultsChanged",reload);window.removeEventListener("focus",reload);};},[reload]);
  if(!data)return <NotebookError error={error} retry={reload}/>;
  if(page==="notebook")return <NotebookWorkspace key={id} id={id} action={action} overview={data} onVaultsChanged={reload}/>;
  if(id==="copy")return <CopyKnowledgeDialog overview={data} onChanged={reload}/>;
  return <>{error&&<NotebookError error={error} retry={reload}/>}<KnowledgeHome overview={data}/></>;
}

function NotebookWorkspace({id,action,overview,onVaultsChanged}:{id:string;action:string;overview:NotebookOverview;onVaultsChanged:()=>void}) {
  const t=useT();const search=useMemoryLocation();const params=new URLSearchParams(search);const legacyPath=params.get("memoryPath")??"";
  const query=params.get("memoryQuery")??"";const filter=params.get("memoryFilter")??"";const tag=params.get("memoryTag")??"";const folder=params.get("memoryFolder")??"";const sort=params.get("memorySort")??"updated";
  const {data,error,reload}=useNotebookLoad(()=>notebookTree(id,filter,tag,sort),[id,filter,tag,sort]);
  const [input,setInput]=useState(query);const [failure,setFailure]=useState("");
  const running=useNotebookImports().get(id);const [notice,setNotice]=useState<NotebookImportOutcome|null>(null);
  useEffect(()=>{
    let timer:ReturnType<typeof setTimeout>|undefined;
    const finished=(event:Event)=>{const outcome=(event as CustomEvent<NotebookImportOutcome>).detail;if(outcome?.vaultId!==id)return;setNotice(outcome);reload();clearTimeout(timer);timer=setTimeout(()=>setNotice(null),10000);};
    window.addEventListener("notebook:importFinished",finished);return()=>{window.removeEventListener("notebook:importFinished",finished);clearTimeout(timer);};
  },[id,reload]);
  // "all" widens the lookup to every registered notebook; an empty scope keeps it inside this one.
  const scope=params.get("memoryScope")??"";const searching=query.trim().length>0;
  const lookup=useKnowledgeSearch(query,scope==="all"?"":id);
  const hits=lookup.result?.entries??[];
  const openHit=(index:number)=>{const hit=hits[index];if(hit)openVaultFile(hit.absolutePath);};
  const keys=useSearchKeys(hits.length,openHit,()=>{setInput("");memoryNavigate(memoryUrl(notebookRoute(id),{memoryQuery:null,memoryScope:null}),true);});
  const searchInput=useRef<HTMLInputElement>(null);
  useEffect(()=>setInput(query),[query]);
  useEffect(()=>{if(input===query)return;const timer=setTimeout(()=>memoryNavigate(memoryUrl(notebookRoute(id),{memoryQuery:input,memoryFolder:null}),true),250);return()=>clearTimeout(timer);},[input,query,id]);
  useEffect(()=>{const focus=()=>{if(!document.hidden)reload();};const timer=setInterval(focus,5000);window.addEventListener("focus",focus);return()=>{clearInterval(timer);window.removeEventListener("focus",focus);};},[reload]);
  // Notes opened before the knowledge base used document tabs still arrive with a memoryPath URL.
  useEffect(()=>{
    if(!legacyPath||!data)return;
    const node=data.nodes.find(n=>n.path===legacyPath);
    if(node&&node.kind!=="folder")openVaultFile(node.absolutePath);
  },[legacyPath,data]);
  useEffect(()=>{
    const keys=(event:KeyboardEvent)=>{
      if(!event.metaKey&&!event.ctrlKey||action||new URLSearchParams(location.search).has("kbAction"))return;
      if(event.key.toLowerCase()==="n"){event.preventDefault();event.stopImmediatePropagation();memoryNavigate(memoryUrl(notebookRoute(id,"new")));}
      if(event.key.toLowerCase()==="o"){event.preventDefault();event.stopImmediatePropagation();memoryNavigate(memoryUrl(notebookRoute(id,"quick")));}
      if(event.shiftKey&&event.key.toLowerCase()==="f"){event.preventDefault();searchInput.current?.focus();}
    };window.addEventListener("keydown",keys,true);return()=>window.removeEventListener("keydown",keys,true);
  },[id,action]);
  if(!data)return <NotebookError error={error} retry={reload}/>;
  const navigateList=(values:Record<string,string|null>)=>memoryNavigate(memoryUrl(notebookRoute(id),{memoryPath:null,memoryQuery:null,memoryFolder:null,memoryTag:null,...values}));
  const entries=folder?data.entries.filter(n=>n.path.startsWith(`${folder}/`)):data.entries;
  // A query replaces the note list with hits; the surrounding vault bar and view switch stay in place.
  const searchPane=<div className="nb-library nb-search-library">
    <div className="nb-search-head">
      <strong role="status">{lookup.result?t("nb.searchCount",String(lookup.result.total)):t("common.loading")}</strong>
      <span className="nb-spacer"/>
      <Select size="sm" width={150} value={scope} ariaLabel={t("nb.searchScope")} onChange={value=>memoryNavigate(memoryUrl(notebookRoute(id),{memoryQuery:query,memoryFolder:null,memoryScope:value||null}),true)} options={[{ value: "", label: t("nb.searchThisVault") }, { value: "all", label: t("nb.searchAllVaults") }]} />
    </div>
    <KnowledgeSearchResults query={query} result={lookup.result} error={lookup.error} active={keys.active} onActive={keys.setActive} onOpen={openHit} onOpenRelated={(related)=>openVaultFile(related.absolutePath)}/>
  </div>;
  return <div className="nb-workspace">
    <main className="nb-main">
      <div className="nb-workspace-bar"><nav><KnowledgeBackLink className="nb-icon-button"/><MemoryLink route={notebookRoute(id)} values={{memoryPath:null,memoryFolder:null}}>{data.vault.name}</MemoryLink>{folder&&<><span>/</span><span>{folder}</span></>}</nav><div className="nb-search"><Icons.search/><input ref={searchInput} aria-label={t("nb.search")} placeholder={t("nb.search")} value={input} onKeyDown={keys.onKeyDown} onChange={e=>setInput(e.target.value)}/></div></div>
      <nav className="nb-workspace-tools" aria-label={t("nb.vaults")}>
        <div className="nb-workspace-views">
          <MemoryLink route={notebookRoute(id)} values={knowledgeSelection} className={!folder&&!filter?"active":""}>{t("nb.recent")}</MemoryLink>
          <MemoryLink route={notebookRoute(id)} values={{...knowledgeSelection,memoryFilter:"favorites"}} className={filter==="favorites"?"active":""}>{t("nb.favorites")}</MemoryLink>
          <MemoryLink route={notebookRoute(id)} values={{...knowledgeSelection,memoryFilter:"trash"}} className={filter==="trash"?"active":""}>{t("nb.trash")}</MemoryLink>
          <MemoryLink route={notebookRoute(id,"imports")} values={knowledgeSelection} className={action==="imports"?"active":""}>{t("nb.imports")}</MemoryLink>
        </div>
        <div className="nb-workspace-commands">
          {running&&<MemoryLink className="nb-import-chip" route={notebookRoute(id,"imports")} title={`${t("nb.importStatusRunning")} · ${running.current}`}><Icons.notebookImport size={12}/><span>{running.done} / {running.files}</span><progress max={1} value={running.bytes?running.sent/running.bytes:1}/></MemoryLink>}
          <MemoryLink className="nb-icon-button" title={t("nb.newFolder")} aria-label={t("nb.newFolder")} route={notebookRoute(id,"folder")}><Icons.folderPlus/></MemoryLink>
          <MemoryLink className="nb-icon-button" title={t("nb.import")} aria-label={t("nb.import")} route={notebookRoute(id,"import")}><Icons.notebookImport/></MemoryLink>
          <MemoryLink className="nb-icon-button" title={t("nb.closeVault")} aria-label={t("nb.closeVault")} route={notebookRoute(id,"close")}><Icons.close/></MemoryLink>
        </div>
      </nav>
      {notice&&<div className={`nb-banner nb-import-notice ${notice.status}`} role="status"><span>{notice.status==="completed"?`${t("nb.imported")}: ${notice.imported} · ${t("nb.skipped")}: ${notice.skipped}`:notebookError(notice.error)}</span><MemoryLink route={notebookRoute(id,"imports")}>{t("nb.imports")}</MemoryLink><button type="button" className="nb-icon-button" title={t("common.close")} aria-label={t("common.close")} onClick={()=>setNotice(null)}><Icons.close size={14}/></button></div>}
      {(error||failure)&&<NotebookError error={error||failure} retry={()=>{setFailure("");reload();}}/>}
      {action==="imports"?<ImportRecords id={id}/>:action&&action!=="quick"?<NotebookDialog key={`${action}:${folder}`} action={action} tree={data} overview={overview} onChanged={()=>{reload();onVaultsChanged();}}/>:action==="quick"?<QuickOpen id={id} entries={data.nodes.filter(n=>n.kind==="note")}/>:filter==="trash"?<div className="nb-library"><header><h1>{t("nb.trash")}</h1></header>{data.trash.length?data.trash.map(item=><div className="nb-trash-row" key={item.id}><Icons.notebookTrash/><div><strong>{item.path}</strong><small>{memoryTime(item.deletedAt)}</small></div><button className="btn" onClick={()=>{void notebookRestore(id,item.id).then(()=>reload()).catch(e=>setFailure(notebookError(e)));}}>{t("nb.restore")}</button></div>):<p className="nb-empty-hint">{t("nb.emptyTrash")}</p>}</div>:searching?searchPane:<div className="nb-library"><header><div><div className="nb-eyebrow">{t("nb.notes")}</div><h1>{tag?`#${tag}`:folder||t(filter==="favorites"?"nb.favorites":"nb.recent")}</h1></div><MemoryLink className="btn btn-primary" route={notebookRoute(id,"new")}><Icons.plus/>{t("nb.newNote")}</MemoryLink></header>
        <div className="nb-list-tools"><span>{entries.length} {t("nb.notes")}</span><span className="nb-spacer"/><Select size="sm" width={130} value={tag} ariaLabel={t("nb.tags")} onChange={value=>navigateList({memoryTag:value,memoryFilter:filter})} options={[{ value: "", label: t("memory.allTags") }, ...data.tags.map(value=>({ value, label: value }))]} /><Select size="sm" width={130} value={sort} ariaLabel={t("memory.updated")} onChange={value=>navigateList({memorySort:value,memoryFilter:filter})} options={[{ value: "updated", label: t("memory.updated") }, { value: "title", label: t("memory.titleSort") }]} />{folder&&<MemoryLink route={notebookRoute(id,"move")} values={{memoryPath:folder}}>{t("nb.move")}</MemoryLink>}{folder&&<MemoryLink route={notebookRoute(id,"delete")} values={{memoryPath:folder}}>{t("common.delete")}</MemoryLink>}</div>
        {entries.length?<div className="nb-note-list">{entries.map(note=><button type="button" key={note.path} className="nb-note-row" onClick={()=>openVaultFile(note.absolutePath)}><Icons.docLines size={20}/><div><strong>{note.name.replace(/\.md$/i,"")}</strong><p>{note.summary}</p><small>{note.path}</small></div><time>{memoryTime(note.updatedAt)}</time></button>)}</div>:<div className="nb-empty-state"><Icons.docLines size={36}/><h2>{t("nb.chooseNote")}</h2><p>{t("nb.emptyNotes")}</p><MemoryLink className="btn btn-primary" route={notebookRoute(id,"new")}><Icons.plus/>{t("nb.newNote")}</MemoryLink></div>}
        {data.skipped>0&&<p className="nb-empty-hint">{t("nb.skipped")}: {data.skipped}</p>}
      </div>}
    </main>
  </div>;
}

function QuickOpen({id,entries}:{id:string;entries:NotebookNode[]}) {
  const t=useT();const location=useMemoryLocation();const query=new URLSearchParams(location).get("memoryQuickQuery")??"";
  const setQuery=(value:string)=>memoryNavigate(memoryUrl(notebookRoute(id,"quick"),{memoryQuickQuery:value}),true);const [selected,setSelected]=useState(0);const results=entries.filter(n=>n.path.toLowerCase().includes(query.toLowerCase())).slice(0,60);
  const open=(node:NotebookNode)=>openVaultFile(node.absolutePath);
  return <section className="nb-dialog nb-quick-dialog"><header><h2>{t("nb.quickOpen")}</h2><MemoryLink route={notebookRoute(id)}>{t("common.cancel")}</MemoryLink></header><input className="input" autoFocus aria-label={t("nb.quickOpen")} value={query} onChange={e=>{setQuery(e.target.value);setSelected(0);}} onKeyDown={e=>{if(e.key==="ArrowDown"){e.preventDefault();setSelected(s=>Math.min(s+1,results.length-1));}else if(e.key==="ArrowUp"){e.preventDefault();setSelected(s=>Math.max(0,s-1));}else if(e.key==="Enter"&&results[selected])open(results[selected]);else if(e.key==="Escape")memoryNavigate(memoryUrl(notebookRoute(id)));}}/><div className="nb-quick-results">{results.map((n,i)=><button key={n.path} type="button" className={i===selected?"active":""} onClick={()=>open(n)}><Icons.docLines/><span>{n.path}</span></button>)}</div></section>;
}
