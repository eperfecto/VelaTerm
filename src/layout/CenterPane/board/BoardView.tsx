//! Task board of a chief chat session (S12-S17). Four fixed columns of task cards, a new-task form, worker
//! assignment from the chief's child sessions, drag and drop between columns, and a resizable side panel with
//! the chief's chat and a tab per opened worker. Every change goes through `board_action`, which acts as the
//! user with chief permissions; the view refetches on `board://changed` so other clients and the CLI show up.

import { useCallback, useEffect, useMemo, useState } from "react";
import { useShallow } from "zustand/react/shallow";
import { ContextMenu, type MenuItem } from "../../../components/ContextMenu";
import { FormModal } from "../../../components/FormModal";
import Icons from "../../../components/Icons";
import { Splitter } from "../../../components/Splitter";
import { StatusDot } from "../../../components/StatusDot";
import { useT } from "../../../i18n";
import {
  BOARD_STATUSES,
  boardAction,
  boardList,
  type BoardActionRequest,
  type BoardList,
  type BoardStatus,
  type BoardTask,
} from "../../../ipc/board";
import { onBoardChanged } from "../../../ipc/events";
import { platform } from "../../../platform";
import type { BoardTab } from "../../../store/termStore";
import { useTermStore } from "../../../store/termStore";
import { effectiveStatus, projectRoot, type Session } from "../../../types";
import { ChatPane } from "../session/ChatPane";
import "./board.css";

/** Drag payload: the task reference (`T3`) of the card being moved. */
export const BOARD_TASK_MIME = "application/x-vlx-board-task";

/** Coalesces a burst of `board://changed` events (one per mutated task) into one refetch. */
const REFRESH_DEBOUNCE_MS = 150;

const PANEL_MIN = 280;
const PANEL_MAX = 960;
const PANEL_DEFAULT = 440;

const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e));

export function BoardView({ tab, hidden }: { tab: BoardTab; hidden: boolean }) {
  const t = useT();
  const chiefId = tab.chiefId;
  const chief = useTermStore((s) => s.sessions.find((x) => x.id === chiefId));
  // Workers are the chief's direct child sessions; assignment offers only those.
  const children = useTermStore(useShallow((s) => s.sessions.filter((x) => x.parentSessionId === chiefId)));
  const [list, setList] = useState<BoardList | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [blocking, setBlocking] = useState<BoardTask | null>(null);
  const [menu, setMenu] = useState<{ x: number; y: number; task: BoardTask } | null>(null);
  const [dropTarget, setDropTarget] = useState<BoardStatus | null>(null);
  // Side panel: the chief's chat is always the first tab; opened workers follow it.
  const [workerTabs, setWorkerTabs] = useState<string[]>([]);
  const [activePanel, setActivePanel] = useState<string>(chiefId);
  const [panelWidth, setPanelWidth] = useState(PANEL_DEFAULT);
  const [panelCollapsed, setPanelCollapsed] = useState(false);

  const load = useCallback(() => {
    boardList(chiefId)
      .then((next) => {
        setList(next);
        setError(null);
      })
      .catch((e: unknown) => setError(errorText(e)));
  }, [chiefId]);

  useEffect(() => {
    load();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const unlisten = onBoardChanged((change) => {
      if (change.chiefId !== chiefId) return;
      clearTimeout(timer);
      timer = setTimeout(load, REFRESH_DEBOUNCE_MS);
    });
    return () => {
      clearTimeout(timer);
      void unlisten.then((fn) => fn());
    };
  }, [chiefId, load]);

  /** Run one board action as the user, then refetch; the change event refreshes other clients. */
  const act = useCallback(
    async (request: BoardActionRequest) => {
      await boardAction(chiefId, request);
      setError(null);
      load();
    },
    [chiefId, load],
  );
  // Card actions report a refusal in the board's error banner; forms show theirs inside the form.
  const run = (request: BoardActionRequest) => void act(request).catch((e: unknown) => setError(errorText(e)));

  const tasks = useMemo(() => list?.columns.flatMap((c) => c.tasks) ?? [], [list]);
  const done = tasks.filter((x) => x.status === "done").length;

  const openWorker = (workerId: string) => {
    setWorkerTabs((prev) => (prev.includes(workerId) ? prev : [...prev, workerId]));
    setActivePanel(workerId);
    setPanelCollapsed(false);
  };
  const closeWorker = (workerId: string) => {
    setWorkerTabs((prev) => prev.filter((id) => id !== workerId));
    if (activePanel === workerId) setActivePanel(chiefId);
  };

  const moveTo = (task: BoardTask, status: BoardStatus) => {
    if (task.status !== status) run({ action: "move", task: task.ref, status });
  };

  const menuItems = (task: BoardTask): MenuItem[] => [
    {
      label: t("board.moveTo"),
      submenu: BOARD_STATUSES.map((status) => ({
        label: t(`board.column.${status}`),
        checked: task.status === status,
        disabled: task.status === status,
        onClick: () => moveTo(task, status),
      })),
    },
    {
      label: t("board.assign"),
      submenu: [
        {
          label: t("board.noWorker"),
          checked: !task.workerId,
          onClick: () => run({ action: "assign", task: task.ref, worker: "none" }),
        },
        ...(children.length ? [{ label: "", separator: true } as MenuItem] : []),
        ...children.map(
          (w): MenuItem => ({
            label: w.name,
            checked: task.workerId === w.id,
            onClick: () => run({ action: "assign", task: task.ref, worker: w.id }),
          }),
        ),
      ],
    },
    task.blockedReason
      ? { label: t("board.unblock"), onClick: () => run({ action: "unblock", task: task.ref }) }
      : { label: t("board.block"), onClick: () => setBlocking(task) },
    ...(task.link
      ? [
          { label: "", separator: true } as MenuItem,
          {
            label: t("board.openLink"),
            icon: <Icons.external size={13} />,
            onClick: () => void platform.opener.openExternal(task.link!).catch(() => {}),
          },
        ]
      : []),
  ];

  const chatSessions = [chiefId, ...workerTabs];

  return (
    <div className="board-view" style={{ display: hidden ? "none" : "flex" }}>
      <div className="board-main">
        <header className="board-header">
          <Icons.board size={16} />
          <h2 className="board-name">{list?.board ?? chief?.name ?? t("board.title")}</h2>
          <span className="board-progress" aria-label={t("board.progress")}>
            {done}/{tasks.length}
          </span>
          <span className="board-spacer" />
          <button type="button" className="vlx-btn vlx-btn-primary" onClick={() => setAdding(true)}>
            {t("board.addTask")}
          </button>
          {panelCollapsed && (
            <button
              type="button"
              className="icon-btn"
              title={t("board.showPanel")}
              aria-label={t("board.showPanel")}
              onClick={() => setPanelCollapsed(false)}
            >
              <Icons.panel size={14} />
            </button>
          )}
        </header>
        {error && (
          <div className="board-error" role="alert">
            <span>{error}</span>
            <button type="button" className="icon-btn sm" aria-label={t("common.close")} onClick={() => setError(null)}>
              <Icons.x size={12} />
            </button>
          </div>
        )}
        {!list && !error && <p className="board-loading">{t("board.loading")}</p>}
        {list && (
          <div className="board-columns">
            {BOARD_STATUSES.map((status) => {
              const column = list.columns.find((c) => c.status === status)?.tasks ?? [];
              return (
                <section
                  key={status}
                  className={`board-column${dropTarget === status ? " drop" : ""}`}
                  aria-label={t(`board.column.${status}`)}
                  data-status={status}
                  onDragOver={(e) => {
                    if (!e.dataTransfer.types.includes(BOARD_TASK_MIME)) return;
                    e.preventDefault();
                    e.dataTransfer.dropEffect = "move";
                    if (dropTarget !== status) setDropTarget(status);
                  }}
                  onDragLeave={(e) => {
                    if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropTarget(null);
                  }}
                  onDrop={(e) => {
                    setDropTarget(null);
                    const ref = e.dataTransfer.getData(BOARD_TASK_MIME);
                    const task = tasks.find((x) => x.ref === ref);
                    if (!task) return;
                    e.preventDefault();
                    moveTo(task, status);
                  }}
                >
                  <h3 className="board-column-title">
                    <span>{t(`board.column.${status}`)}</span>
                    <span className="board-count">{column.length}</span>
                  </h3>
                  <div className="board-cards">
                    {column.map((task) => (
                      <TaskCard
                        key={task.id}
                        task={task}
                        workerName={children.find((w) => w.id === task.workerId)?.name ?? task.workerName ?? null}
                        onOpen={() => task.workerId && openWorker(task.workerId)}
                        onMenu={(x, y) => setMenu({ x, y, task })}
                      />
                    ))}
                  </div>
                </section>
              );
            })}
          </div>
        )}
      </div>
      {!panelCollapsed && <Splitter onDrag={(dx) => setPanelWidth((w) => Math.min(PANEL_MAX, Math.max(PANEL_MIN, w - dx)))} />}
      {/* Panel chats stay mounted while collapsed or behind another tab: unmounting a ChatPane tells the
          backend the conversation is no longer shown, which releases its agent once idle. */}
      <aside className="board-panel" style={{ width: panelWidth, display: panelCollapsed ? "none" : "flex" }}>
        <div className="board-panel-tabs" role="tablist">
          {chatSessions.map((id) => (
            <PanelTab
              key={id}
              id={id}
              chief={id === chiefId}
              active={id === activePanel}
              onSelect={() => setActivePanel(id)}
              onClose={() => closeWorker(id)}
            />
          ))}
          <span className="board-spacer" />
          <button
            type="button"
            className="icon-btn sm"
            title={t("board.hidePanel")}
            aria-label={t("board.hidePanel")}
            onClick={() => setPanelCollapsed(true)}
          >
            <Icons.panel size={13} />
          </button>
        </div>
        <div className="board-panel-body">
          {chatSessions.map((id) => (
            <PanelChat key={id} sessionId={id} hidden={hidden || panelCollapsed || id !== activePanel} />
          ))}
        </div>
      </aside>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems(menu.task)} onClose={() => setMenu(null)} />}
      {adding && (
        <FormModal
          title={t("board.newTask")}
          fields={[
            { key: "title", label: t("board.taskTitle"), required: true, autoFocus: true },
            { key: "body", label: t("board.taskBody") },
            { key: "label", label: t("board.taskLabel"), placeholder: t("board.taskLabelPlaceholder") },
            { key: "link", label: t("board.taskLink"), placeholder: "https://" },
          ]}
          submitLabel={t("board.addTaskSubmit")}
          onCancel={() => setAdding(false)}
          onSubmit={async (v) => {
            await act({
              action: "add",
              title: v.title.trim(),
              ...(v.body.trim() ? { text: v.body.trim() } : {}),
              ...(v.label.trim() ? { label: v.label.trim() } : {}),
              ...(v.link.trim() ? { link: v.link.trim() } : {}),
            });
            setAdding(false);
          }}
        />
      )}
      {blocking && (
        <FormModal
          title={`${t("board.block")} ${blocking.ref}`}
          fields={[{ key: "reason", label: t("board.blockReason"), required: true, autoFocus: true }]}
          submitLabel={t("board.blockSubmit")}
          onCancel={() => setBlocking(null)}
          onSubmit={async (v) => {
            await act({ action: "block", task: blocking.ref, text: v.reason.trim() });
            setBlocking(null);
          }}
        />
      )}
    </div>
  );
}

/** One task card: drag source, worker status, and the task actions menu. */
function TaskCard({
  task,
  workerName,
  onOpen,
  onMenu,
}: {
  task: BoardTask;
  workerName: string | null;
  onOpen: () => void;
  onMenu: (x: number, y: number) => void;
}) {
  const t = useT();
  return (
    <article
      className={`board-card${task.blockedReason ? " blocked" : ""}${task.workerId ? " has-worker" : ""}`}
      data-task={task.ref}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData(BOARD_TASK_MIME, task.ref);
        e.dataTransfer.setData("text/plain", task.ref);
        e.dataTransfer.effectAllowed = "move";
      }}
      onClick={onOpen}
      onContextMenu={(e) => {
        e.preventDefault();
        onMenu(e.clientX, e.clientY);
      }}
    >
      <div className="board-card-head">
        <span className="board-ref">{task.ref}</span>
        {task.label && <span className="board-label">{task.label}</span>}
        {task.blockedReason && (
          <span className="board-blocked" title={task.blockedReason} aria-label={`${t("board.blocked")}: ${task.blockedReason}`}>
            ⚠
          </span>
        )}
        <span className="board-spacer" />
        {task.link && (
          <a
            className="icon-btn sm"
            href={task.link}
            target="_blank"
            rel="noreferrer"
            title={t("board.openLink")}
            aria-label={t("board.openLink")}
            onClick={(e) => e.stopPropagation()}
          >
            <Icons.external size={12} />
          </a>
        )}
        <button
          type="button"
          className="icon-btn sm"
          aria-label={t("board.taskMenu")}
          title={t("board.taskMenu")}
          onClick={(e) => {
            e.stopPropagation();
            const r = e.currentTarget.getBoundingClientRect();
            onMenu(r.left, r.bottom);
          }}
        >
          <Icons.more size={12} />
        </button>
      </div>
      <div className="board-card-title">{task.title}</div>
      <div className="board-card-worker">
        {task.workerId ? (
          <>
            <WorkerDot id={task.workerId} />
            <span>{workerName ?? task.workerId}</span>
          </>
        ) : (
          <span className="board-no-worker">{t("board.noWorker")}</span>
        )}
      </div>
    </article>
  );
}

/** Live status of one worker, subscribed on its own so a status change rerenders only this dot. */
function WorkerDot({ id }: { id: string }) {
  const status = useTermStore((s) => effectiveStatus(s.runtimes[id]));
  return <StatusDot status={status} />;
}

function PanelTab({
  id,
  chief,
  active,
  onSelect,
  onClose,
}: {
  id: string;
  chief: boolean;
  active: boolean;
  onSelect: () => void;
  onClose: () => void;
}) {
  const t = useT();
  const name = useTermStore((s) => s.sessions.find((x) => x.id === id)?.name);
  return (
    <div className={`board-panel-tab${active ? " active" : ""}`}>
      <button type="button" role="tab" aria-selected={active} onClick={onSelect}>
        {chief ? t("board.chief") : (name ?? id)}
      </button>
      {!chief && (
        <button type="button" className="board-panel-close" aria-label={t("common.close")} onClick={onClose}>
          ✕
        </button>
      )}
    </div>
  );
}

/** The chat of one panel tab, mounted standalone the way the security audit mounts its conversation. */
function PanelChat({ sessionId, hidden }: { sessionId: string; hidden: boolean }) {
  const t = useT();
  const session = useTermStore((s) => s.sessions.find((x) => x.id === sessionId));
  const cwd = useTermStore((s) => {
    if (!session) return undefined;
    return session.cwd ?? projectRoot(s.projects.find((p) => p.id === session.projectId)) ?? undefined;
  });
  if (!session) return null;
  return (
    <div className="board-panel-chat" style={{ display: hidden ? "none" : "block" }}>
      {isChat(session) ? (
        <ChatPane
          key={session.id}
          session={session}
          cwd={cwd}
          area={{ position: "absolute", inset: 0 }}
          hidden={hidden}
          focused={!hidden}
          multi={false}
          onActivate={() => {}}
          onSplit={() => {}}
          onClose={() => {}}
        />
      ) : (
        <p className="board-panel-notice">{t("board.notChat")}</p>
      )}
    </div>
  );
}

const isChat = (session: Session) => session.engine === "chat";
