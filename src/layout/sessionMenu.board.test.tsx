import { act, fireEvent, render, renderHook, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session, SessionRuntime } from "../types";

const testState = vi.hoisted(() => {
  const addSession = vi.fn();
  const openSession = vi.fn();
  const newScratchTab = vi.fn();
  return {
    addSession,
    openSession,
    newScratchTab,
    state: {
      addSession,
      openSession,
      newScratchTab,
      openMerge: vi.fn(),
      openChanges: vi.fn(),
      updateSession: vi.fn(),
      deleteNode: vi.fn(),
      deleteMany: vi.fn(),
      moveNode: vi.fn(),
      moveMany: vi.fn(),
      archiveSession: vi.fn(),
      clearNodeWorktree: vi.fn(),
      forkSession: vi.fn(),
      closeSession: vi.fn(),
      setRuntime: vi.fn(),
      runtimes: {} as Record<string, SessionRuntime>,
      setActiveTab: vi.fn(),
      closeTab: vi.fn(),
      requestCloseDocTab: vi.fn(),
      addGroup: vi.fn(),
      groups: [],
      sessions: [] as Session[],
      ephemeralSessions: {},
      projects: [{ id: "project-1", rootPath: "/tmp/project" }],
      agentDefaults: {},
      agentPresets: [],
      refreshBoardIds: vi.fn(() => Promise.resolve()),
    },
  };
});

const platformEnv = vi.hoisted(() => ({ isTauri: true, isElectron: false }));

vi.mock("../i18n", () => ({
  t: (key: string) => key,
  useT: () => (key: string) => key,
}));
vi.mock("../platform", () => ({ env: platformEnv }));
vi.mock("../components/Backdrop", () => ({ Backdrop: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock("../store/termStore", () => {
  const useTermStore = Object.assign(
    (selector: (state: typeof testState.state) => unknown) => selector(testState.state),
    { getState: () => testState.state },
  );
  return { useTermStore };
});
vi.mock("../ipc/commands", () => ({
  createWorktree: vi.fn(),
  downloadFullGitbash: vi.fn(),
  gitbashStatus: vi.fn(() => Promise.resolve(null)),
  listShells: vi.fn(() => Promise.resolve([])),
  ptyKill: vi.fn(() => Promise.resolve()),
  removeWorktree: vi.fn(),
}));
vi.mock("../ipc/info", () => ({ copyText: vi.fn(), openDir: vi.fn() }));
vi.mock("../ipc/chat", () => ({ chatStop: vi.fn(() => Promise.resolve()) }));
vi.mock("../ipc/events", () => ({
  onGitbashDownloadDone: vi.fn(() => Promise.resolve(() => {})),
}));
vi.mock("../ipc/board", () => ({ boardRegister: vi.fn(() => Promise.resolve({ chiefId: "chief-1" })) }));
vi.mock("../hooks/useGitBranch", () => ({
  invalidateGitBranch: vi.fn(),
  isWorktreeGone: () => false,
  peekGitBranchInfo: () => ({ isRepo: false }),
  prefetchGitBranchInfo: vi.fn(),
}));
vi.mock("./sessionMenuDialogs", () => ({
  ConfirmDelete: () => null,
  DeleteWorktree: () => null,
  GroupInfo: () => null,
  NewAgentSession: () => null,
  NewGroup: () => null,
  ResumeSession: () => null,
  SessionInfo: () => null,
}));

import { useSessionMenu } from "./sessionMenu";
import { boardRegister } from "../ipc/board";

describe("New Board entry in the session menu", () => {
  beforeEach(() => {
    testState.addSession.mockReset().mockResolvedValue({ id: "chief-1" });
    testState.openSession.mockReset();
    vi.mocked(boardRegister).mockClear();
    testState.state.refreshBoardIds.mockClear();
  });

  it("creates a chat session, registers it as a board, then opens it", async () => {
    const { result } = renderHook(() => useSessionMenu());
    const item = result.current.newSessionItems("project-1", "group-1", null).find((i) => i.label === "board.new");
    expect(item).toBeTruthy();
    act(() => item?.onClick?.({} as React.MouseEvent));
    const view = render(result.current.dialogs);
    fireEvent.change(view.getByLabelText(/board\.name/), { target: { value: "Release board" } });
    await act(async () => { fireEvent.click(view.getByRole("button", { name: "board.create" })); });

    await waitFor(() => expect(testState.openSession).toHaveBeenCalledWith("chief-1"));
    expect(testState.addSession).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: "project-1",
        groupId: "group-1",
        parentSessionId: null,
        name: "Release board",
        kind: "claude",
        engine: "chat",
      }),
    );
    expect(boardRegister).toHaveBeenCalledWith("chief-1");
    // Registration precedes opening, so the first open already shows the board rather than the chat.
    const order = (fn: { mock: { invocationCallOrder: number[] } }) => fn.mock.invocationCallOrder[0];
    expect(order(testState.addSession)).toBeLessThan(order(vi.mocked(boardRegister)));
    expect(order(vi.mocked(boardRegister))).toBeLessThan(order(testState.state.refreshBoardIds));
    expect(order(testState.state.refreshBoardIds)).toBeLessThan(order(testState.openSession));
    expect(testState.openSession).toHaveBeenCalledTimes(1);
    view.unmount();
  });
});
