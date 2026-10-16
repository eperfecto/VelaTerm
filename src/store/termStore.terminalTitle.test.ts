//! A Claude session takes the terminal title Claude sets as its name.

import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Session } from "../types";

const env = vi.hoisted(() => ({
  kind: "tauri",
  isTauri: true,
  isElectron: false,
  isBrowser: false,
  isRemoteWindow: false,
  hasNativeHost: true,
  isMac: false,
}));
const tree = vi.hoisted(() => ({
  data: { projects: [] as unknown[], groups: [] as unknown[], sessions: [] as unknown[] },
}));

vi.mock("../ipc/commands", () => ({
  createWorktree: vi.fn(),
  getSessionCwd: vi.fn().mockResolvedValue(null),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  listShells: vi.fn().mockResolvedValue([]),
}));
vi.mock("../ipc/tree", () => ({
  listTree: vi.fn(async () => tree.data),
  renameNode: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../ipc/chat", () => ({
  chatClear: vi.fn(),
  setSessionEngine: vi.fn(),
  chatStop: vi.fn().mockResolvedValue(undefined),
}));
vi.mock("../notify", () => ({ notify: vi.fn() }));
vi.mock("../ipc/transport", () => ({ isTauri: true, invokeNative: vi.fn().mockResolvedValue(undefined), diagnosticEvent: vi.fn() }));
vi.mock("../ipc/browser", () => ({ setBrowserUrl: vi.fn().mockResolvedValue(undefined) }));
vi.mock("../platform", () => ({
  env,
  platform: { env, dialog: { pickDirectory: vi.fn(), saveFile: vi.fn() } },
}));

import * as ipcTree from "../ipc/tree";
import { useTermStore } from "./termStore";

const session = (id: string, kind: Session["kind"], name = id): Session => ({
  id,
  projectId: "A",
  groupId: null,
  name,
  kind,
  collapsed: false,
  sortOrder: 0,
  createdAt: 0,
});

describe("applyTerminalTitle", () => {
  beforeEach(() => {
    vi.mocked(ipcTree.renameNode).mockClear();
    useTermStore.setState({ sessions: [session("c1", "claude", "dev server"), session("t1", "terminal", "dev server")], ephemeralSessions: {} });
  });

  it("renames a saved Claude session to the title Claude sets", async () => {
    await useTermStore.getState().applyTerminalTitle("c1", "✳ Fix login bug");
    expect(ipcTree.renameNode).toHaveBeenCalledWith("session", "c1", "Fix login bug");
  });

  it("does not rename when the name is already the title", async () => {
    await useTermStore.getState().applyTerminalTitle("c1", "⠂ dev server");
    expect(ipcTree.renameNode).not.toHaveBeenCalled();
  });

  it("does not rename a plain terminal", async () => {
    await useTermStore.getState().applyTerminalTitle("t1", "user@host: ~/project");
    expect(ipcTree.renameNode).not.toHaveBeenCalled();
    expect(useTermStore.getState().sessions.find((s) => s.id === "t1")?.name).toBe("dev server");
  });

  it("renames a Claude draft in memory", async () => {
    useTermStore.setState({ ephemeralSessions: { e1: session("e1", "claude", "Claude") } });
    await useTermStore.getState().applyTerminalTitle("e1", "✳ Fix login bug");
    expect(useTermStore.getState().ephemeralSessions.e1.name).toBe("Fix login bug");
    expect(ipcTree.renameNode).not.toHaveBeenCalled();
  });

  it("renames once while the same title repeats during the save", async () => {
    const store = useTermStore.getState();
    await Promise.all([
      store.applyTerminalTitle("c1", "⠂ Fix login bug"),
      store.applyTerminalTitle("c1", "⠐ Fix login bug"),
    ]);
    expect(ipcTree.renameNode).toHaveBeenCalledTimes(1);
  });

  it("keeps a manual rename until Claude changes its title", async () => {
    useTermStore.setState({ sessions: [session("m1", "claude", "Claude")] });
    const store = useTermStore.getState();
    await store.applyTerminalTitle("m1", "✳ Fix login bug");
    expect(ipcTree.renameNode).toHaveBeenCalledWith("session", "m1", "Fix login bug");
    useTermStore.setState({ sessions: [session("m1", "claude", "my name")] });
    vi.mocked(ipcTree.renameNode).mockClear();
    await store.applyTerminalTitle("m1", "⠂ Fix login bug");
    expect(ipcTree.renameNode).not.toHaveBeenCalled();
    await store.applyTerminalTitle("m1", "✳ Add tests");
    expect(ipcTree.renameNode).toHaveBeenCalledWith("session", "m1", "Add tests");
  });

  it("saves titles in the order Claude sets them", async () => {
    const order: string[] = [];
    let release: (() => void) | undefined;
    vi.mocked(ipcTree.renameNode)
      .mockImplementationOnce(async (_k, _id, name) => {
        await new Promise<void>((r) => (release = r));
        order.push(name);
      })
      .mockImplementationOnce(async (_k, _id, name) => {
        order.push(name);
      });
    const store = useTermStore.getState();
    const first = store.applyTerminalTitle("c1", "✳ First");
    const second = store.applyTerminalTitle("c1", "✳ Second");
    await vi.waitFor(() => expect(release).toBeDefined());
    release!();
    await Promise.all([first, second]);
    expect(order).toEqual(["First", "Second"]);
  });

  it("retries a title whose save failed", async () => {
    useTermStore.setState({ sessions: [session("f1", "claude", "Claude")] });
    vi.mocked(ipcTree.renameNode).mockRejectedValueOnce(new Error("db down"));
    const store = useTermStore.getState();
    await expect(store.applyTerminalTitle("f1", "✳ Fix login bug")).rejects.toThrow("db down");
    await store.applyTerminalTitle("f1", "⠂ Fix login bug");
    expect(ipcTree.renameNode).toHaveBeenCalledTimes(2);
    expect(ipcTree.renameNode).toHaveBeenLastCalledWith("session", "f1", "Fix login bug");
  });
});
