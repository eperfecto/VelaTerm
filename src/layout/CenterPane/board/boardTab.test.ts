//! A session flagged as a board opens its board tab instead of a pane. Stubs follow store/browserTabs.test.ts.

import { describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/commands", () => ({
  createWorktree: vi.fn(),
  getSessionCwd: vi.fn().mockResolvedValue(null),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  listShells: vi.fn().mockResolvedValue([]),
}));
vi.mock("../../../ipc/tree", () => ({ listTree: vi.fn().mockResolvedValue({ projects: [], groups: [], sessions: [] }) }));
vi.mock("../../../notify", () => ({ notify: vi.fn() }));
vi.mock("../../../ipc/transport", () => ({ isTauri: true }));
vi.mock("../../../ipc/board", () => ({ boardIds: vi.fn().mockResolvedValue(["chief"]) }));
vi.mock("../../../platform", () => {
  const env = {
    kind: "tauri", isTauri: true, isElectron: false, isBrowser: false, isRemoteWindow: false, hasNativeHost: true, isMac: false,
  };
  return { env, platform: { env, dialog: { pickDirectory: vi.fn(), saveFile: vi.fn() } } };
});

import type { Session } from "../../../types";
import { useTermStore } from "../../../store/termStore";

const session = (id: string): Session => ({
  id, projectId: "p1", groupId: null, name: id, kind: "claude", shell: null, cwd: "/tmp", envJson: null,
  initCmd: null, hotkey: null, parentSessionId: null, collapsed: false, worktreePath: null, sortOrder: 0,
  createdAt: 0, engine: "chat",
});

describe("board tabs", () => {
  it("opens a board session as a board tab instead of a pane", async () => {
    useTermStore.setState({
      projects: [{ id: "p1", name: "P", rootPath: "/tmp", color: null, sortOrder: 0, collapsed: false, createdAt: 0 }],
      groups: [],
      sessions: [session("chief"), session("plain")],
      runtimes: {},
      openTabs: [],
      paneTrees: {},
      activeTabId: null,
      activeSessionId: null,
      focusedPaneId: null,
      liveTabs: [],
      boardTabs: {},
      singleTabMode: true,
    });
    await useTermStore.getState().refreshBoardIds();
    expect(useTermStore.getState().boardIds).toEqual(["chief"]);

    useTermStore.getState().openSession("chief");
    useTermStore.getState().openSession("chief");
    let st = useTermStore.getState();
    expect(st.openTabs).toEqual(["board-chief"]);
    expect(st.boardTabs["board-chief"]).toEqual({ id: "board-chief", chiefId: "chief" });
    expect(st.paneTrees.chief).toBeUndefined();
    expect([st.activeTabId, st.activeSessionId, st.focusedPaneId]).toEqual(["board-chief", null, null]);

    // An ordinary session still opens a pane, and the board tab survives that.
    useTermStore.getState().openSession("plain");
    st = useTermStore.getState();
    expect(st.paneTrees.plain).toBeDefined();
    expect(st.openTabs).toContain("board-chief");

    useTermStore.getState().closeTab("board-chief");
    st = useTermStore.getState();
    expect(st.openTabs).not.toContain("board-chief");
    expect(st.boardTabs).toEqual({});
  });
});
