//! BrowserTab state-model tests mirroring key docTabs.test.ts cases: opening and clearing active
//! session state, applying status events, protection from session replacement, tree reconciliation,
//! metadata cleanup, and active-state fallback after closure.
//!
//! Stub Tauri-touching modules so the store loads under Node/jsdom. The store does not invoke
//! `browser_*`; native WebViews follow BrowserView mount/unmount behavior.

import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../ipc/commands", () => ({
  createWorktree: vi.fn(),
  getSessionCwd: vi.fn().mockResolvedValue(null),
  ptyKill: vi.fn().mockResolvedValue(undefined),
  listShells: vi.fn().mockResolvedValue([]),
}));
vi.mock("../ipc/tree", () => {
  const s = (id: string) => ({
    id,
    projectId: "p1",
    groupId: null,
    name: id,
    kind: "claude",
    shell: null,
    cwd: "/tmp",
    envJson: null,
    initCmd: null,
    hotkey: null,
    parentSessionId: null,
    collapsed: false,
    worktreePath: null,
    sortOrder: 0,
    createdAt: 0,
  });
  return {
    listTree: vi.fn().mockResolvedValue({
      projects: [
        { id: "p1", name: "P", rootPath: "/tmp", color: null, sortOrder: 0, collapsed: false, createdAt: 0 },
      ],
      groups: [],
      sessions: [s("A"), s("B")],
    }),
  };
});
vi.mock("../notify", () => ({ notify: vi.fn() }));
// Browser-node openSession needs a window that can host the page (env.hasBuiltinBrowser), so tests emulate desktop.
vi.mock("../ipc/transport", () => ({ isTauri: true }));
// Stub env instead of loading real platform adapters, which would require unrelated transport exports.
vi.mock("../platform", () => ({
  env: {
    kind: "tauri",
    isTauri: true,
    isElectron: false,
    isBrowser: false,
    isRemoteWindow: false,
    hasNativeHost: true,
    hasBuiltinBrowser: true,
    isMac: false,
  },
}));
vi.mock("../ipc/browser", () => ({ setBrowserUrl: vi.fn().mockResolvedValue(undefined) }));
// Stub the platform as desktop Tauri, consistent with transport's isTauri:true, without loading
// adapter chains that require additional transport/notify exports.
vi.mock("../platform", () => {
  const env = {
    kind: "tauri",
    isTauri: true,
    isElectron: false,
    isBrowser: false,
    isRemoteWindow: false,
    hasNativeHost: true,
    hasBuiltinBrowser: true,
    isMac: false,
  };
  return { env, platform: { env, dialog: { pickDirectory: vi.fn(), saveFile: vi.fn() } } };
});

import type { Session } from "../types";
import { useTermStore } from "./termStore";

function mkSession(id: string): Session {
  return {
    id,
    projectId: "p1",
    groupId: null,
    name: id,
    kind: "claude",
    shell: null,
    cwd: "/tmp",
    envJson: null,
    initCmd: null,
    hotkey: null,
    parentSessionId: null,
    collapsed: false,
    worktreePath: null,
    sortOrder: 0,
    createdAt: 0,
  };
}

/** Reset to project p1, named sessions A/B, an empty center pane, and single-tab mode. */
function seed() {
  useTermStore.setState({
    projects: [
      { id: "p1", name: "P", rootPath: "/tmp", color: null, sortOrder: 0, collapsed: false, createdAt: 0 },
    ],
    groups: [],
    sessions: [mkSession("A"), mkSession("B")],
    runtimes: { A: { status: "idle" }, B: { status: "idle" } },
    epochs: {},
    ephemeralSessions: {},
    pendingPrompts: {},
    openTabs: [],
    activeTabId: null,
    paneTrees: {},
    activeSessionId: null,
    focusedPaneId: null,
    liveTabs: [],
    docTabs: {},
    browserTabs: {},
    notifications: {},
    singleTabMode: true,
  });
}

/** Return the only browser-tab ID, throwing on multiples to make failures visible. */
function soleBrowserId(): string {
  const ids = Object.keys(useTermStore.getState().browserTabs);
  expect(ids.length).toBe(1);
  return ids[0];
}

afterEach(() => {
  localStorage.clear();
});

describe("openBrowserTab: creating and activating", () => {
  it("a new browser tab is appended to openTabs and activated, with activeSessionId null and a blank initial page", () => {
    seed();
    useTermStore.getState().openBrowserTab();

    const s = useTermStore.getState();
    const id = soleBrowserId();
    expect(id.startsWith("browser-")).toBe(true);
    expect(s.openTabs).toContain(id);
    expect(s.activeTabId).toBe(id);
    expect(s.activeSessionId).toBeNull();
    expect(s.focusedPaneId).toBeNull();
    const tab = s.browserTabs[id];
    expect(tab.url).toBe("about:blank");
    expect(tab.loading).toBe(false);
  });

  it("several browser tabs can be open at once without deduplication and without interfering", () => {
    seed();
    useTermStore.getState().openBrowserTab("https://github.com");
    useTermStore.getState().openBrowserTab("https://example.com");
    const s = useTermStore.getState();
    const ids = s.openTabs.filter((t) => s.browserTabs[t]);
    expect(ids.length).toBe(2);
    expect(s.browserTabs[ids[0]].url).toBe("https://github.com");
    expect(s.browserTabs[ids[1]].url).toBe("https://example.com");
    expect(s.activeTabId).toBe(ids[1]);
  });

  it("keeps browser chrome by default and hides it only when requested for a standalone page", () => {
    seed();
    useTermStore.getState().openBrowserTab("https://velaterm.com/game-center", { chromeHidden: true });
    useTermStore.getState().openBrowserTab("https://github.com");
    const s = useTermStore.getState();
    const ids = s.openTabs.filter((t) => s.browserTabs[t]);
    expect(s.browserTabs[ids[0]].chromeHidden).toBe(true);
    expect(s.browserTabs[ids[1]].chromeHidden).toBe(false);
  });

  it("records the opening tab and URL for popup-created tabs", () => {
    seed();
    useTermStore.getState().openBrowserTab("https://velaterm.com/zh-CN/game-center");
    const parentId = soleBrowserId();
    useTermStore.getState().openBrowserTab("https://velaterm.com/games/shooter/index.html", {
      chromeHidden: true,
      openerTabId: parentId,
      openerUrl: "https://velaterm.com/zh-CN/game-center",
    });
    const s = useTermStore.getState();
    const ids = s.openTabs.filter((t) => s.browserTabs[t]);
    expect(s.browserTabs[ids[1]].openerTabId).toBe(parentId);
    expect(s.browserTabs[ids[1]].openerUrl).toBe("https://velaterm.com/zh-CN/game-center");
    expect(s.browserTabs[parentId].openerTabId).toBeUndefined();
  });
});

describe("applyBrowserState: feeding state events back in", () => {
  it("merges url, title and loading as a patch and silently ignores unknown tabs", () => {
    seed();
    useTermStore.getState().openBrowserTab();
    const id = soleBrowserId();

    useTermStore.getState().applyBrowserState(id, {
      url: "https://github.com/",
      title: "github.com",
      loading: true,
    });
    let tab = useTermStore.getState().browserTabs[id];
    expect(tab.url).toBe("https://github.com/");
    expect(tab.title).toBe("github.com");
    expect(tab.loading).toBe(true);

    useTermStore.getState().applyBrowserState(id, { loading: false });
    tab = useTermStore.getState().browserTabs[id];
    expect(tab.url).toBe("https://github.com/"); // Unspecified fields remain unchanged.
    expect(tab.loading).toBe(false);

    // Closed or unknown tabs are ignored without creation or errors.
    useTermStore.getState().applyBrowserState("browser-ghost", { loading: true });
    expect(useTermStore.getState().browserTabs["browser-ghost"]).toBeUndefined();
  });
});

describe("core regression: a session never overwrites a browser tab", () => {
  it("openSession in single-tab mode while a browser tab is active opens the session in a new tab and leaves the browser tab untouched", () => {
    seed();
    useTermStore.getState().openBrowserTab();
    const browserId = soleBrowserId();

    useTermStore.getState().openSession("A");

    const s = useTermStore.getState();
    expect(s.openTabs).toContain(browserId);
    expect(s.browserTabs[browserId]).toBeTruthy();
    expect(s.openTabs).toContain("A");
    expect(s.activeTabId).toBe("A");
    expect(s.activeSessionId).toBe("A");
    // A browser tab is not moved into terminal keep-alive state.
    expect(s.liveTabs).not.toContain(browserId);
  });

  it("switching from a browser tab to a session and back keeps both states correct", () => {
    seed();
    useTermStore.getState().openSession("A");
    useTermStore.getState().openBrowserTab();
    const browserId = soleBrowserId();

    useTermStore.getState().setActiveTab("A");
    expect(useTermStore.getState().activeSessionId).toBe("A");

    useTermStore.getState().setActiveTab(browserId);
    const s = useTermStore.getState();
    expect(s.activeTabId).toBe(browserId);
    expect(s.activeSessionId).toBeNull();
    expect(s.focusedPaneId).toBeNull();
  });
});

describe("a tree refresh (loadTree reconciliation) does not lose browser tabs", () => {
  it("a later loadTree keeps browser tabs, and deleting a session does not affect them", async () => {
    seed();
    // The first loadTree follows startup restoration; empty localStorage only flips the restored flag.
    await useTermStore.getState().loadTree();

    useTermStore.getState().openBrowserTab("https://github.com");
    const browserId = soleBrowserId();
    useTermStore.getState().openSession("A");

    // Simulate a tree-change refresh while mocked listTree still returns A/B.
    await useTermStore.getState().loadTree();
    let s = useTermStore.getState();
    expect(s.openTabs).toContain(browserId);
    expect(s.browserTabs[browserId]).toBeTruthy();

    // Simulate A being deleted elsewhere; reconciliation removes A but preserves the browser tab.
    const { listTree } = await import("../ipc/tree");
    vi.mocked(listTree).mockResolvedValueOnce({
      projects: [
        { id: "p1", name: "P", rootPath: "/tmp", color: null, sortOrder: 0, collapsed: false, createdAt: 0 },
      ],
      groups: [],
      sessions: [mkSession("B")],
    });
    await useTermStore.getState().loadTree();
    s = useTermStore.getState();
    expect(s.openTabs).not.toContain("A");
    expect(s.openTabs).toContain(browserId);
    expect(s.browserTabs[browserId]).toBeTruthy();
  });
});

describe("browser tree nodes (kind=browser, persistent pages in the sidebar tree)", () => {
  const mkBrowserNode = (id: string, url: string | null): Session => ({
    ...mkSession(id),
    kind: "browser",
    browserUrl: url,
  });

  it("openSession on a browser node opens a browser tab whose id is the node id and loads the node's URL", () => {
    seed();
    useTermStore.setState((s) => ({
      sessions: [...s.sessions, mkBrowserNode("W", "https://x.example/")],
    }));
    useTermStore.getState().openSession("W");

    const s = useTermStore.getState();
    expect(s.openTabs).toContain("W");
    expect(s.browserTabs["W"]).toBeTruthy();
    expect(s.browserTabs["W"].url).toBe("https://x.example/");
    expect(s.activeTabId).toBe("W");
    expect(s.activeSessionId).toBeNull();
    expect(s.paneTrees["W"]).toBeUndefined(); // Browser nodes do not create pane trees.
  });

  it("opening it again focuses the existing tab without recreating it or resetting the URL it navigated to", () => {
    seed();
    useTermStore.setState((s) => ({
      sessions: [...s.sessions, mkBrowserNode("W", null)],
    }));
    useTermStore.getState().openSession("W");
    expect(useTermStore.getState().browserTabs["W"].url).toBe("about:blank");
    // Navigation updates the URL through a state event.
    useTermStore.getState().applyBrowserState("W", { url: "https://y.example/" });
    // Switching away and reopening the browser node preserves its navigated URL.
    useTermStore.getState().openSession("A");
    useTermStore.getState().openSession("W");
    const s = useTermStore.getState();
    expect(s.activeTabId).toBe("W");
    expect(s.openTabs.filter((t) => t === "W").length).toBe(1);
    expect(s.browserTabs["W"].url).toBe("https://y.example/");
  });

  it("when a node disappears from sessions after a tree refresh its tab closes too, while standalone tabs are unaffected", async () => {
    seed();
    useTermStore.setState((s) => ({
      sessions: [...s.sessions, mkBrowserNode("W", "https://x.example/")],
    }));
    await useTermStore.getState().loadTree(); // Mocked listTree returns A/B; open W before reconciliation removes it.
    useTermStore.setState((s) => ({
      sessions: [...s.sessions, mkBrowserNode("W", "https://x.example/")],
    }));
    useTermStore.getState().openSession("W");
    useTermStore.getState().openBrowserTab("https://standalone.example/");
    expect(useTermStore.getState().openTabs).toContain("W");

    // Simulate node deletion: refresh removes W and closes its bound tab while preserving standalone tabs.
    await useTermStore.getState().loadTree();
    const s = useTermStore.getState();
    expect(s.openTabs).not.toContain("W");
    expect(s.browserTabs["W"]).toBeUndefined();
    const standalone = s.openTabs.filter((t) => t.startsWith("browser-"));
    expect(standalone.length).toBe(1);
    expect(s.browserTabs[standalone[0]]).toBeTruthy();
  });
});

describe("closeTab on a browser tab: clearing metadata and falling back to another active tab", () => {
  it("closing clears the browserTabs metadata", () => {
    seed();
    useTermStore.getState().openBrowserTab();
    const browserId = soleBrowserId();

    useTermStore.getState().closeTab(browserId);
    const s = useTermStore.getState();
    expect(s.openTabs).not.toContain(browserId);
    expect(s.browserTabs[browserId]).toBeUndefined();
  });

  it("falling back to an adjacent terminal tab restores the active session", () => {
    seed();
    useTermStore.getState().openSession("A");
    useTermStore.getState().openBrowserTab();
    const browserId = soleBrowserId();
    expect(useTermStore.getState().activeTabId).toBe(browserId);

    useTermStore.getState().closeTab(browserId);
    const s = useTermStore.getState();
    expect(s.activeTabId).toBe("A");
    expect(s.activeSessionId).toBe("A");
    expect(s.browserTabs[browserId]).toBeUndefined();
  });

  it("falling back to an adjacent browser tab keeps activeSessionId null", () => {
    seed();
    useTermStore.getState().openBrowserTab("https://a.example");
    useTermStore.getState().openBrowserTab("https://b.example");
    const s0 = useTermStore.getState();
    const ids = s0.openTabs.filter((t) => s0.browserTabs[t]);
    expect(ids.length).toBe(2);
    const [first, second] = ids;
    expect(s0.activeTabId).toBe(second);

    useTermStore.getState().closeTab(second);
    const s = useTermStore.getState();
    expect(s.activeTabId).toBe(first);
    expect(s.activeSessionId).toBeNull();
    expect(s.focusedPaneId).toBeNull();
    expect(s.browserTabs[first]).toBeTruthy();
  });

  it("closing the last tab returns to the empty state", () => {
    seed();
    useTermStore.getState().openBrowserTab();
    const browserId = soleBrowserId();
    useTermStore.getState().closeTab(browserId);
    const s = useTermStore.getState();
    expect(s.openTabs.length).toBe(0);
    expect(s.activeTabId).toBeNull();
    expect(s.activeSessionId).toBeNull();
    expect(Object.keys(s.browserTabs).length).toBe(0);
  });
});
