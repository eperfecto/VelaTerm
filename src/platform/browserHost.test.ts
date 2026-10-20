import { afterEach, describe, expect, it, vi } from "vitest";

/** Load env and the Tauri adapter against one window kind; transport flags are read once at import time. */
async function load(flags: { isTauri: boolean; isRemoteWindow: boolean }) {
  vi.resetModules();
  const transport = {
    ...flags,
    isElectronShell: false,
    isMac: false,
    copyText: vi.fn(),
    invoke: vi.fn(() => Promise.resolve()),
    invokeNative: vi.fn(() => Promise.resolve()),
    listen: vi.fn(() => Promise.resolve(() => {})),
    listenNative: vi.fn(() => Promise.resolve(() => {})),
    openPath: vi.fn(),
    pickDirectory: vi.fn(),
    pickFile: vi.fn(),
    revealPath: vi.fn(),
  };
  vi.doMock("../ipc/transport", () => transport);
  vi.doMock("../notify", () => ({
    getEffectiveNotifyPermission: vi.fn(),
    getNotifyPermission: vi.fn(),
    notify: vi.fn(),
    requestEffectiveNotifyPermission: vi.fn(),
    requestNotifyPermission: vi.fn(),
  }));
  const { env } = await import("./env");
  const { tauriPlatform } = await import("./tauri");
  return { env, browser: tauriPlatform.browser, transport };
}

const rect = { x: 1, y: 2, w: 3, h: 4 };

afterEach(() => {
  vi.doUnmock("../ipc/transport");
  vi.doUnmock("../notify");
});

describe("built-in browser host", () => {
  it("is available in a remote-connection window and drives the child view through the local native bridge", async () => {
    const { env, browser, transport } = await load({ isTauri: false, isRemoteWindow: true });
    expect(env.hasBuiltinBrowser).toBe(true);

    await browser.open("tab-1", "https://example.com", rect);
    await browser.close("tab-1");
    await browser.onState("tab-1", () => {});
    await browser.onPopup("tab-1", () => {});

    expect(transport.invokeNative).toHaveBeenCalledWith("plugin:local-browser|open", expect.objectContaining({ tabId: "tab-1", url: "https://example.com", x: 1, y: 2, w: 3, h: 4 }));
    expect(transport.invokeNative).toHaveBeenCalledWith("plugin:local-browser|close", { tabId: "tab-1" });
    expect(transport.listenNative).toHaveBeenCalledWith("browser://state/tab-1", expect.any(Function));
    expect(transport.listenNative).toHaveBeenCalledWith("browser://popup/tab-1", expect.any(Function));
    // The WebSocket transport would send these to the remote server, which has no window to host the page.
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(transport.listen).not.toHaveBeenCalled();
  });

  it("drives the desktop main window through the same plugin and listens on its regular event bus", async () => {
    const { env, browser, transport } = await load({ isTauri: true, isRemoteWindow: false });
    expect(env.hasBuiltinBrowser).toBe(true);

    await browser.open("tab-1", "https://example.com", rect);
    await browser.onState("tab-1", () => {});

    expect(transport.invokeNative).toHaveBeenCalledWith("plugin:local-browser|open", expect.objectContaining({ tabId: "tab-1" }));
    expect(transport.listen).toHaveBeenCalledWith("browser://state/tab-1", expect.any(Function));
    expect(transport.invoke).not.toHaveBeenCalled();
    expect(transport.listenNative).not.toHaveBeenCalled();
  });

  it("is unavailable in a plain browser client", async () => {
    const { env } = await load({ isTauri: false, isRemoteWindow: false });
    expect(env.hasBuiltinBrowser).toBe(false);
  });
});
