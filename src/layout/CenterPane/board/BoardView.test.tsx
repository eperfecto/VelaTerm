import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { BoardList, BoardTask } from "../../../ipc/board";
import type { Session } from "../../../types";

vi.mock("../../../ipc/transport", async (original) => ({
  ...await original<typeof import("../../../ipc/transport")>(), invoke: vi.fn(), listen: vi.fn(),
  onTransportReconnect: vi.fn(() => vi.fn()), onTransportDisconnect: vi.fn(() => vi.fn()),
}));
// The real conversation view needs the chat engine; the board only decides which one shows.
vi.mock("../session/ChatPane", () => ({
  ChatPane: ({ session, hidden }: { session: Session; hidden: boolean }) => (
    <div data-testid={`chat-${session.id}`} data-hidden={String(hidden)} />
  ),
}));

import { invoke, listen } from "../../../ipc/transport";
import { setLang } from "../../../i18n";
import { useTermStore } from "../../../store/termStore";
import { platform } from "../../../platform";
import { BOARD_TASK_MIME, BoardView } from "./BoardView";

const session = (id: string, over: Partial<Session> = {}): Session => ({
  id, projectId: "p1", groupId: null, name: id, kind: "claude", shell: null, cwd: "/tmp", envJson: null,
  initCmd: null, hotkey: null, parentSessionId: null, collapsed: false, worktreePath: null, sortOrder: 0,
  createdAt: 0, engine: "chat", ...over,
});

const task = (over: Partial<BoardTask>): BoardTask => ({
  id: `id-${over.ref}`, chiefId: "chief", number: 1, ref: "T1", title: "", body: "", label: null, link: null,
  status: "backlog", blockedReason: null, workerId: null, position: 0, createdAt: 0, updatedAt: 0, ...over,
});

const tasks = [
  task({ ref: "T1", title: "Build the API", label: "BE", workerId: "worker" }),
  task({ ref: "T2", title: "Draw the screen", status: "in_progress", blockedReason: "Waiting for design" }),
  task({ ref: "T3", title: "Legacy shell", status: "review", workerId: "tui-worker" }),
];

const board = (): BoardList => ({
  chiefId: "chief", board: "Release board", role: "chief",
  columns: (["backlog", "in_progress", "review", "done"] as const).map((status) => ({
    status, tasks: tasks.filter((x) => x.status === status),
  })),
});

let boardChanged: ((payload: { chiefId: string; taskId: string | null }) => void) | undefined;

const listCalls = () => vi.mocked(invoke).mock.calls.filter(([command]) => command === "board_list").length;

beforeEach(() => {
  setLang("en");
  boardChanged = undefined;
  vi.mocked(listen).mockReset().mockImplementation((name, callback) => {
    if (name === "board://changed") boardChanged = callback as typeof boardChanged;
    return Promise.resolve(() => {});
  });
  vi.mocked(invoke).mockReset().mockImplementation((command) => {
    if (command === "board_list") return Promise.resolve(board()) as Promise<never>;
    if (command === "board_action") return Promise.resolve({ task: tasks[0] }) as Promise<never>;
    return Promise.resolve(undefined) as Promise<never>;
  });
  useTermStore.setState({
    projects: [{ id: "p1", name: "P", rootPath: "/tmp", color: null, sortOrder: 0, collapsed: false, createdAt: 0 }],
    sessions: [
      session("chief", { name: "Chief session" }),
      session("worker", { name: "API worker", parentSessionId: "chief" }),
      session("tui-worker", { name: "Shell worker", parentSessionId: "chief", engine: "tui" }),
    ],
    runtimes: { worker: { status: "running", agentState: "working" } },
  });
});

afterEach(cleanup);

const renderBoard = async () => {
  render(<BoardView tab={{ id: "board-chief", chiefId: "chief" }} hidden={false} />);
  await screen.findByText("Build the API");
};

const column = (name: string) => screen.getByRole("region", { name });
const card = (ref: string) => document.querySelector(`[data-task="${ref}"]`) as HTMLElement;

describe("BoardView", () => {
  it("renders the four columns and their cards from board_list", async () => {
    await renderBoard();
    expect(invoke).toHaveBeenCalledWith("board_list", { chiefId: "chief" });
    expect(screen.getByText("Release board")).toBeTruthy();
    for (const name of ["Backlog", "In Progress", "Review", "Done"]) expect(column(name)).toBeTruthy();
    const first = within(column("Backlog"));
    expect(first.getByText("T1")).toBeTruthy();
    expect(first.getByText("BE")).toBeTruthy();
    expect(first.getByText("API worker")).toBeTruthy();
    const blocked = within(column("In Progress"));
    expect(blocked.getByText("Draw the screen")).toBeTruthy();
    expect(blocked.getByText("No worker")).toBeTruthy();
    expect(blocked.getByLabelText("Blocked: Waiting for design")).toBeTruthy();
    expect(screen.getByText("0/3")).toBeTruthy();
  });

  it("opens only web links from a card in the system browser", async () => {
    const open = vi.spyOn(platform.opener, "openExternal").mockResolvedValue(undefined);
    tasks[0] = { ...tasks[0], link: "https://example.com/1" };
    tasks[2] = { ...tasks[2], link: "file:///etc/passwd" };
    try {
      await renderBoard();
      fireEvent.click(within(card("T1")).getByLabelText("Open Link"));
      expect(open).toHaveBeenCalledWith("https://example.com/1");
      fireEvent.click(within(card("T3")).getByLabelText("Open Link"));
      expect(open).toHaveBeenCalledTimes(1);
    } finally {
      tasks[0] = { ...tasks[0], link: null };
      tasks[2] = { ...tasks[2], link: null };
      open.mockRestore();
    }
  });

  it("moves a card dropped on another column through board_action", async () => {
    await renderBoard();
    const data: Record<string, string> = {};
    const dataTransfer = {
      types: [] as string[],
      setData: (type: string, value: string) => { data[type] = value; dataTransfer.types.push(type); },
      getData: (type: string) => data[type] ?? "",
      dropEffect: "none",
      effectAllowed: "all",
    };
    fireEvent.dragStart(card("T1"), { dataTransfer });
    fireEvent.dragOver(column("Review"), { dataTransfer });
    fireEvent.drop(column("Review"), { dataTransfer });
    expect(data[BOARD_TASK_MIME]).toBe("T1");
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("board_action", {
        chiefId: "chief",
        request: { action: "move", task: "T1", status: "review" },
      }),
    );
  });

  it("shows a refused card action inline", async () => {
    await renderBoard();
    vi.mocked(invoke).mockImplementation((command) =>
      (command === "board_action" ? Promise.reject("Only the chief can unblock a task") : Promise.resolve(board())) as Promise<never>);
    const dataTransfer = { types: [BOARD_TASK_MIME], getData: () => "T2", setData: () => {}, dropEffect: "none" };
    fireEvent.dragOver(column("Done"), { dataTransfer });
    fireEvent.drop(column("Done"), { dataTransfer });
    expect((await screen.findByRole("alert")).textContent).toContain("Only the chief can unblock a task");
  });

  it("adds a task from the new-task form", async () => {
    await renderBoard();
    fireEvent.click(screen.getByRole("button", { name: "+ Task" }));
    fireEvent.change(screen.getByLabelText(/^Title/), { target: { value: "Write docs" } });
    fireEvent.change(screen.getByLabelText("Description"), { target: { value: "User guide" } });
    fireEvent.change(screen.getByLabelText("Label"), { target: { value: "DOC" } });
    fireEvent.change(screen.getByLabelText("Link"), { target: { value: "https://example.com/1" } });
    fireEvent.click(screen.getByRole("button", { name: "Add Task" }));
    await waitFor(() =>
      expect(invoke).toHaveBeenCalledWith("board_action", {
        chiefId: "chief",
        request: { action: "add", title: "Write docs", text: "User guide", label: "DOC", link: "https://example.com/1" },
      }),
    );
  });

  it("refetches on board://changed for its own chief only", async () => {
    await renderBoard();
    const before = listCalls();
    act(() => boardChanged?.({ chiefId: "other", taskId: null }));
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(listCalls()).toBe(before);
    act(() => boardChanged?.({ chiefId: "chief", taskId: "id-T1" }));
    await waitFor(() => expect(listCalls()).toBe(before + 1));
  });

  it("shows the chief chat by default and opens a worker tab from its card", async () => {
    await renderBoard();
    expect(screen.getByRole("tab", { name: "Chief" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("chat-chief").getAttribute("data-hidden")).toBe("false");
    fireEvent.click(card("T1"));
    expect(screen.getByRole("tab", { name: "API worker" }).getAttribute("aria-selected")).toBe("true");
    expect(screen.getByTestId("chat-worker").getAttribute("data-hidden")).toBe("false");
    // The chief stays mounted behind the worker tab, so its conversation is not released.
    expect(screen.getByTestId("chat-chief").getAttribute("data-hidden")).toBe("true");
  });

  it("shows a notice instead of a chat for a worker that is not a chat session", async () => {
    await renderBoard();
    fireEvent.click(card("T3"));
    expect(screen.getByRole("tab", { name: "Shell worker" })).toBeTruthy();
    expect(screen.queryByTestId("chat-tui-worker")).toBeNull();
    expect(screen.getByText(/does not use the chat view/)).toBeTruthy();
  });
});
