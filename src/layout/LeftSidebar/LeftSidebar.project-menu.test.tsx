import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const menuMocks = vi.hoisted(() => ({
  newSessionItems: vi.fn(
    (
      _projectId: string,
      _groupId: string | null,
      _parentSessionId: string | null,
      opts?: { withTerminal?: boolean; withBrowser?: boolean },
    ) => (opts?.withTerminal ? [{ label: "tree.newTerminalSession", onClick: vi.fn() }] : []),
  ),
}));

const storeState = vi.hoisted(() => ({
  leftWidth: 280,
  importProject: vi.fn(),
  addVirtualProject: vi.fn(),
  setCloneModalOpen: vi.fn(),
  renameNode: vi.fn(),
  openSession: vi.fn(),
  treeFilter: "",
  setTreeFilter: vi.fn(),
  selection: [],
  clearSelection: vi.fn(),
  archiveMany: vi.fn(),
  archiveGroup: vi.fn(),
  clearNodeWorktree: vi.fn(),
  globalSearchOpen: false,
  setGlobalSearchOpen: vi.fn(),
  notifications: {},
  pendingSpawns: [] as unknown[],
  clearAllNotifications: vi.fn(),
  clearAllBadges: vi.fn(),
  ephemeralSessions: {},
  browserTabs: {},
  docTabs: {},
  renameScratch: vi.fn(),
  sessions: [],
  runtimes: {},
  statusFilter: null as ("working" | "asking" | "waiting")[] | null,
  dynamicStatusFilter: true,
  setStatusFilter: vi.fn(),
  appendSidebarTreeViewStatusMatches: vi.fn(),
  refreshSidebarTreeViewStatusMatches: vi.fn(),
  setSidebarTreeViewStatusFilter: vi.fn(),
  markFilter: null,
  setMarkFilter: vi.fn(),
  setSidebarTreeViewMarkFilter: vi.fn(),
  splitSidebarTreeView: vi.fn(),
  deleteSidebarTreeView: vi.fn(),
  setActiveSidebarTreeView: vi.fn(),
  resizeSidebarTreeSplit: vi.fn(),
  groups: [{ id: "group-1", projectId: "project-1", worktreePath: null }],
  projects: [{ id: "project-1", rootPath: "/tmp/project" }],
  openBrowserTab: vi.fn(),
  treeMutationError: null as string | null,
}));

const gitMocks = vi.hoisted(() => ({
  isRepo: true as boolean | undefined,
  gitRepoWebUrl: vi.fn<(cwd: string) => Promise<string | null>>(),
}));
const envState = vi.hoisted(() => ({ isTauri: true, isElectron: false, hasNativeHost: true }));
const openExternal = vi.hoisted(() => vi.fn<(url: string) => Promise<void>>());
const writeText = vi.hoisted(() => vi.fn<(text: string, opts?: { reportFailure?: boolean }) => Promise<void>>());

vi.mock("../../i18n", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../i18n")>()),
  useT: () => (key: string) => key,
}));
vi.mock("../../store/termStore", () => {
  const useTermStore = Object.assign(
    (selector: (state: typeof storeState) => unknown) => selector(storeState),
    {
      getState: () => storeState,
      setState: (patch: Partial<typeof storeState>) => Object.assign(storeState, patch),
    },
  );
  return { useTermStore };
});
vi.mock("../../platform", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../platform")>();
  return { ...actual, platform: { ...actual.platform, opener: { ...actual.platform.opener, openExternal }, clipboard: { ...actual.platform.clipboard, writeText } }, env: new Proxy(actual.env, { get: (target, key) => key in envState ? envState[key as keyof typeof envState] : Reflect.get(target, key) }) };
});
vi.mock("../../ipc/commands", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../ipc/commands")>()),
  gitRepoWebUrl: gitMocks.gitRepoWebUrl,
}));
vi.mock("../../hooks/useGitBranch", () => ({
  isWorktreeGone: () => false,
  peekGitBranchInfo: () => (gitMocks.isRepo === undefined ? undefined : { isRepo: gitMocks.isRepo }),
  prefetchGitBranchInfo: vi.fn(),
}));
vi.mock("../../components/Icons", () => ({
  default: new Proxy({}, { get: () => () => null }),
}));
vi.mock("../../components/ContextMenu", () => ({
  ContextMenu: ({ items }: { items: { label: string; onClick?: () => void }[] }) => (
    <div>
      {items.map((item, index) => (
        <button type="button" key={`${item.label}-${index}`} onClick={() => item.onClick?.()}>
          {item.label}
        </button>
      ))}
    </div>
  ),
}));
vi.mock("../sessionMenu", () => ({
  useSessionMenu: () => ({
    newSessionItems: menuMocks.newSessionItems,
    buildSessionItems: vi.fn(() => []),
    buildScratchItems: vi.fn(() => []),
    buildMoveToMany: vi.fn(() => null),
    buildGitItems: vi.fn(() => []),
    buildMarkItem: vi.fn((_kind: string, _id: string) => ({ label: "mark.menu", submenu: [] })),
    openDialog: vi.fn(),
    dialogs: null,
  }),
}));
vi.mock("./ProjectTree", () => ({
  ProjectTree: ({ onContext }: { onContext: (node: unknown, x: number, y: number) => void }) => (
    <button
      type="button"
      onContextMenu={(event) => {
        event.preventDefault();
        onContext({ kind: "project", id: "project-1", name: "Project", projectId: "project-1" }, 0, 0);
      }}
    >
      Project
    </button>
  ),
}));
vi.mock("../GlobalSearch/GlobalSearch", () => ({ GlobalSearch: () => null }));

import { LeftSidebar } from "./LeftSidebar";

const openProjectMenu = () => {
  render(<LeftSidebar />);
  fireEvent.contextMenu(screen.getByRole("button", { name: "Project" }));
};

describe("LeftSidebar Open Repository", () => {
  beforeEach(() => {
    gitMocks.isRepo = true;
    gitMocks.gitRepoWebUrl.mockReset();
    storeState.openBrowserTab.mockClear();
    storeState.treeMutationError = null;
    envState.isTauri = true;
    envState.isElectron = false;
    envState.hasNativeHost = true;
    openExternal.mockReset().mockResolvedValue(undefined);
  });

  it("opens the origin web page of the project in a browser tab", async () => {
    gitMocks.gitRepoWebUrl.mockResolvedValue("https://github.com/owner/repo");
    openProjectMenu();

    fireEvent.click(screen.getByRole("button", { name: "tree.openRepository" }));

    await waitFor(() =>
      expect(storeState.openBrowserTab).toHaveBeenCalledWith("https://github.com/owner/repo"),
    );
    expect(openExternal).not.toHaveBeenCalled();
    expect(gitMocks.gitRepoWebUrl).toHaveBeenCalledWith("/tmp/project");
    expect(storeState.treeMutationError).toBeNull();
  });

  it("reports a repository without a network origin instead of opening a tab", async () => {
    gitMocks.gitRepoWebUrl.mockResolvedValue(null);
    openProjectMenu();

    fireEvent.click(screen.getByRole("button", { name: "tree.openRepository" }));

    await waitFor(() => expect(storeState.treeMutationError).toBe("tree.openRepositoryNoRemote"));
    expect(storeState.openBrowserTab).not.toHaveBeenCalled();
  });

  it("is hidden for folders that are not Git repositories or not yet probed", () => {
    gitMocks.isRepo = false;
    openProjectMenu();
    expect(screen.queryByRole("button", { name: "tree.openRepository" })).toBeNull();
    cleanup();

    gitMocks.isRepo = undefined;
    openProjectMenu();
    expect(screen.queryByRole("button", { name: "tree.openRepository" })).toBeNull();
  });

  it("opens the page in the system browser from a remote connection window", async () => {
    envState.isTauri = false;
    gitMocks.gitRepoWebUrl.mockResolvedValue("https://github.com/owner/repo");
    openProjectMenu();

    fireEvent.click(screen.getByRole("button", { name: "tree.openRepository" }));

    await waitFor(() => expect(openExternal).toHaveBeenCalledWith("https://github.com/owner/repo"));
    expect(storeState.openBrowserTab).not.toHaveBeenCalled();
  });

  it("is hidden in plain browser clients without a native host", () => {
    envState.isTauri = false;
    envState.hasNativeHost = false;
    openProjectMenu();
    expect(screen.queryByRole("button", { name: "tree.openRepository" })).toBeNull();
  });
});

describe("LeftSidebar Open in VS Code", () => {
  const w = window as unknown as { __VLX_REMOTE__?: unknown };

  beforeEach(() => {
    gitMocks.isRepo = false;
    envState.isTauri = false;
    envState.hasNativeHost = true;
    storeState.treeMutationError = null;
    openExternal.mockReset().mockResolvedValue(undefined);
  });
  afterEach(() => {
    delete w.__VLX_REMOTE__;
  });

  it("opens the project on the connected SSH host in the client's VS Code", async () => {
    w.__VLX_REMOTE__ = { address: "edu@server", session: "s1", transport: "ssh" };
    openProjectMenu();

    fireEvent.click(screen.getByRole("button", { name: "tree.openInVSCode" }));

    await waitFor(() =>
      expect(openExternal).toHaveBeenCalledWith("vscode://vscode-remote/ssh-remote+edu@server/tmp/project"),
    );
  });

  it("reports a failure to hand the link to VS Code", async () => {
    w.__VLX_REMOTE__ = { address: "edu@server", session: "s1", transport: "ssh" };
    openExternal.mockRejectedValue(new Error("no handler"));
    openProjectMenu();

    fireEvent.click(screen.getByRole("button", { name: "tree.openInVSCode" }));

    await waitFor(() => expect(storeState.treeMutationError).toBe("no handler"));
  });

  it("is hidden outside SSH connection windows", () => {
    envState.isTauri = true;
    openProjectMenu();
    expect(screen.queryByRole("button", { name: "tree.openInVSCode" })).toBeNull();
    cleanup();

    w.__VLX_REMOTE__ = { address: "Ubuntu", session: "s1", transport: "wsl" };
    openProjectMenu();
    expect(screen.queryByRole("button", { name: "tree.openInVSCode" })).toBeNull();
  });
});

describe("LeftSidebar Copy Path", () => {
  beforeEach(() => {
    gitMocks.isRepo = false;
    envState.isTauri = true;
    envState.hasNativeHost = true;
    storeState.treeMutationError = null;
    storeState.projects = [{ id: "project-1", rootPath: "/tmp/project" }];
    writeText.mockReset().mockResolvedValue(undefined);
  });

  it("copies the project's folder path to the clipboard", async () => {
    openProjectMenu();

    fireEvent.click(screen.getByRole("button", { name: "files.copyPath" }));

    await waitFor(() => expect(writeText).toHaveBeenCalledWith("/tmp/project", { reportFailure: true }));
    expect(storeState.treeMutationError).toBeNull();
  });

  it("reports a clipboard failure", async () => {
    writeText.mockRejectedValue(new Error("denied"));
    openProjectMenu();

    fireEvent.click(screen.getByRole("button", { name: "files.copyPath" }));

    await waitFor(() => expect(storeState.treeMutationError).toBe("common.copyFailed"));
  });

  it("is hidden for a collection, which has no folder", () => {
    storeState.projects = [{ id: "project-1", rootPath: "" }];
    openProjectMenu();
    expect(screen.queryByRole("button", { name: "files.copyPath" })).toBeNull();
  });
});
