import { useEffect, useState } from "react";
import Icons from "../../components/Icons";
import { useT, type I18nKey } from "../../i18n";
import { notebookImportDelete, notebookImportDetail, notebookImports, type NotebookImportFile, type NotebookImportRecord } from "../../ipc/notebook";
import { MemoryLink, useMemoryLocation } from "../Memory/navigation";
import { memoryTime } from "../Memory/shared";
import { NotebookError, notebookError, notebookRoute, sizeLabel } from "./shared";
import { cancelNotebookImport, useNotebookImports } from "./importManager";

const STATUS_KEYS:Record<string,I18nKey>={running:"nb.importStatusRunning",completed:"nb.importStatusCompleted",failed:"nb.importStatusFailed",cancelled:"nb.importStatusCancelled",interrupted:"nb.importStatusInterrupted"};
const FILE_KEYS:Record<string,I18nKey>={imported:"nb.imported",pending:"nb.importFilePending",skipped:"nb.skipped"};
const REASON_KEYS:Record<string,I18nKey>={hidden:"nb.importSkipHidden"};

export function ImportRecords({id}:{id:string}) {
  const t=useT();const location=useMemoryLocation();
  const page=Math.max(0,Number(new URLSearchParams(location).get("memoryImportPage"))||0);
  const running=useNotebookImports().get(id);
  const [data,setData]=useState<{imports:NotebookImportRecord[];total:number;pageSize:number}|null>(null);
  const [error,setError]=useState("");const [revision,setRevision]=useState(0);const [expanded,setExpanded]=useState("");
  const [detail,setDetail]=useState<{id:string;files:NotebookImportFile[]}|null>(null);const [limit,setLimit]=useState(200);
  const [detailError,setDetailError]=useState("");const [confirming,setConfirming]=useState("");
  useEffect(()=>{
    let alive=true;let timer:ReturnType<typeof setTimeout>;
    setData(null);setError("");
    const refresh=async()=>{
      try{const result=await notebookImports(id,page);if(alive){setData(result);setError("");}}
      catch(e){if(alive){setError(notebookError(e));setData(null);}}
      if(alive)timer=setTimeout(()=>void refresh(),5000);
    };
    void refresh();return()=>{alive=false;clearTimeout(timer);};
  },[id,page,revision]);
  useEffect(()=>{
    const finished=(event:Event)=>{if((event as CustomEvent).detail?.vaultId===id)setRevision(v=>v+1);};
    window.addEventListener("notebook:importFinished",finished);return()=>window.removeEventListener("notebook:importFinished",finished);
  },[id]);
  const toggle=async(record:NotebookImportRecord)=>{
    setConfirming("");
    if(expanded===record.id){setExpanded("");return;}
    setExpanded(record.id);setLimit(200);setDetailError("");
    if(detail?.id===record.id)return;
    setDetail(null);
    try{setDetail({id:record.id,files:(await notebookImportDetail(id,record.id)).files});}
    catch(e){setDetailError(notebookError(e));}
  };
  const remove=async(record:NotebookImportRecord)=>{
    setConfirming("");
    try{await notebookImportDelete(id,record.id);if(detail?.id===record.id)setDetail(null);if(expanded===record.id)setExpanded("");setRevision(v=>v+1);}
    catch(e){setError(notebookError(e));}
  };
  const records=data?.imports??[];
  return <div className="nb-library nb-imports-library">
    <header><div><div className="nb-eyebrow">{t("nb.notes")}</div><h1>{t("nb.imports")}</h1></div><button className="btn" onClick={()=>setRevision(v=>v+1)}>{t("common.refresh")}</button></header>
    {!data?<NotebookError error={error} retry={()=>setRevision(v=>v+1)}/>:!records.length?<div className="nb-empty-state"><Icons.notebookImport size={36}/><h2>{t("nb.imports")}</h2><p>{t("nb.importsEmpty")}</p></div>:<div className="nb-import-record-list">
      {records.map(record=>{
        const live=record.status==="running"?running:undefined;
        const seconds=record.finishedAt?Math.max(1,Math.round((record.finishedAt-record.createdAt)/1000)):0;
        return <article className={`nb-import-record ${record.status}`} key={record.id}>
          <div className="nb-import-record-head">
            <Icons.notebookImport size={16}/>
            <div className="nb-import-record-title"><strong>{record.destination||t("nb.importRoot")}</strong><span className={`nb-import-status ${record.status}`}>{t(STATUS_KEYS[record.status]??"nb.importStatusFailed")}</span></div>
            <time>{memoryTime(record.createdAt)}</time>
            {record.status!=="running"&&(confirming===record.id
              ?<span className="nb-import-confirm"><span>{t("nb.importDeleteConfirm")}</span><button className="btn" onClick={()=>void remove(record)}>{t("common.delete")}</button><button className="btn" onClick={()=>setConfirming("")}>{t("common.cancel")}</button></span>
              :<button type="button" className="nb-icon-button" title={t("nb.importDelete")} aria-label={t("nb.importDelete")} onClick={()=>setConfirming(record.id)}><Icons.trash size={14}/></button>)}
          </div>
          <p className="nb-import-record-meta">{t("nb.imported")}: {record.imported} · {t("nb.skipped")}: {record.skipped} · {sizeLabel(record.bytes)}{seconds?` · ${t("nb.importDuration",String(seconds))}`:""}</p>
          {live&&<div className="nb-import-live" role="status"><progress max={1} value={live.bytes?live.sent/live.bytes:1}/><span>{t("nb.importProgress",String(live.done),String(live.files))} · {live.current}</span><button type="button" className="btn" onClick={()=>cancelNotebookImport(id)}>{t("common.cancel")}</button></div>}
          {!live&&record.error&&<p className="nb-import-error" role="alert">{notebookError(record.error)}</p>}
          {record.files+record.skipped>0&&<button type="button" className="nb-import-files-toggle" onClick={()=>void toggle(record)}>{expanded===record.id?t("nb.importHideFiles"):t("nb.importShowFiles",String(record.files+record.skipped))}</button>}
          {expanded===record.id&&<div className="nb-import-files">
            {detailError&&<p className="nb-import-error" role="alert">{detailError}</p>}
            {detail?.id===record.id&&<>{detail.files.slice(0,limit).map(file=><div className={`nb-import-file ${file.status}`} key={file.path}><span>{file.path}</span><small>{file.reason?t(REASON_KEYS[file.reason]??"nb.importFileSkipped"):t(FILE_KEYS[file.status]??"nb.importFilePending")}</small><small>{sizeLabel(file.size)}</small></div>)}{detail.files.length>limit&&<button type="button" className="btn" onClick={()=>setLimit(v=>v+200)}>{t("nb.loadMore")}</button>}</>}
          </div>}
        </article>;
      })}
      {data.total>data.pageSize&&<footer className="nb-pagination">
        {page>0?<MemoryLink route={notebookRoute(id,"imports")} values={{memoryImportPage:page-1}}>{t("common.prev")}</MemoryLink>:<span/>}
        <span>{page+1} / {Math.ceil(data.total/data.pageSize)}</span>
        {(page+1)*data.pageSize<data.total&&<MemoryLink route={notebookRoute(id,"imports")} values={{memoryImportPage:page+1}}>{t("common.next")}</MemoryLink>}
      </footer>}
    </div>}
  </div>;
}
