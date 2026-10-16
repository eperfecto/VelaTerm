//! Regression tests for automatic update "Skip This Version" semantics: skipping suppresses only the silent
//! startup prompt for that exact version; newer versions still appear, and a manual menu check can still show
//! and install a previously skipped version.

import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { LOCALES } from "../i18n";

const { check, message, relaunch, invoke } = vi.hoisted(() => ({
  check: vi.fn(),
  message: vi.fn().mockResolvedValue(undefined),
  relaunch: vi.fn().mockResolvedValue(undefined),
  invoke: vi.fn().mockResolvedValue("11111111-2222-3333-4444-555555555555"),
}));

vi.mock("@tauri-apps/plugin-updater", () => ({ check }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ message }));
vi.mock("@tauri-apps/plugin-process", () => ({ relaunch }));
vi.mock("./transport", () => ({ isTauri: true, invoke }));
// The desktop updater capability, reduced to the plugin calls above.
vi.mock("../platform", () => ({
  platform: {
    updater: {
      supported: true,
      check: (headers?: Record<string, string>) => check(headers ? { headers } : undefined),
      relaunch,
      message,
    },
  },
}));

import {
  checkForUpdates,
  dismissUpdate,
  loadSkippedVersion,
  restartApp,
  startInstall,
  startUpdateSchedule,
  useUpdateState,
} from "./updater";

function fakeUpdate(version: string) {
  return {
    version,
    currentVersion: "0.1.0",
    body: "",
    rawJson: { url: `https://example.com/${version}` },
    close: vi.fn().mockResolvedValue(undefined),
    downloadAndInstall: vi.fn().mockResolvedValue(undefined),
  };
}

/** Discover and skip a version through real interactions so the test does not depend directly on a private localStorage key. */
async function skipVersion(version: string) {
  const update = fakeUpdate(version);
  check.mockResolvedValueOnce(update);
  await act(() => checkForUpdates({ manual: true }));
  act(() => dismissUpdate({ skip: true }));
  expect(loadSkippedVersion()).toBe(version);
  return update;
}

beforeEach(() => {
  // Prevent a preceding test that failed mid-assertion from leaving the module-level store dirty.
  dismissUpdate();
  localStorage.clear();
  vi.clearAllMocks();
  invoke.mockResolvedValue("11111111-2222-3333-4444-555555555555");
});

afterEach(() => {
  dismissUpdate();
  cleanup();
});

describe("skipping a version in automatic updates", () => {
  it("the silent check at startup no longer prompts for a skipped version and releases the Update handle", async () => {
    await skipVersion("0.2.0");
    const repeated = fakeUpdate("0.2.0");
    check.mockResolvedValueOnce(repeated);
    const { result } = renderHook(() => useUpdateState());

    await act(() => checkForUpdates({ manual: false }));

    expect(result.current.prompt).toBeNull();
    expect(result.current.modalOpen).toBe(false);
    expect(repeated.close).toHaveBeenCalledOnce();
  });

  it("offers a newer version in the status bar without opening a dialog on its own", async () => {
    await skipVersion("0.2.0");
    check.mockResolvedValueOnce(fakeUpdate("0.3.0"));
    const { result } = renderHook(() => useUpdateState());

    await act(() => checkForUpdates({ manual: false }));

    expect(result.current.prompt?.version).toBe("0.3.0");
    expect(result.current.modalOpen).toBe(false);
  });

  it("a manual check from the menu ignores the skip record and opens the dialog for that version", async () => {
    await skipVersion("0.2.0");
    check.mockResolvedValueOnce(fakeUpdate("0.2.0"));
    const { result } = renderHook(() => useUpdateState());

    await act(() => checkForUpdates({ manual: true }));

    expect(result.current.prompt?.version).toBe("0.2.0");
    expect(result.current.modalOpen).toBe(true);
  });
});

describe("update-check telemetry", () => {
  // Each case needs a fresh module instance: the installation identifier is cached for the life of the
  // process, so a cache warmed by an earlier test would hide both the first read and a read failure.
  let mod: typeof import("./updater");
  let i18n: typeof import("../i18n");

  beforeEach(async () => {
    vi.resetModules();
    mod = await import("./updater");
    i18n = await import("../i18n");
    i18n.setLang("en");
  });

  afterEach(() => {
    mod.dismissUpdate();
    vi.restoreAllMocks();
  });

  it("sends the installation identifier as a header and reads it only once per process", async () => {
    check.mockResolvedValue(null);

    await act(() => mod.checkForUpdates({ manual: false }));
    await act(() => mod.checkForUpdates({ manual: false }));

    expect(check).toHaveBeenCalledWith({
      headers: {
        "X-Install-Id": "11111111-2222-3333-4444-555555555555",
        "X-App-Language": "en",
      },
    });
    // The identifier never changes, so it is cached rather than re-read on every check.
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("still reports the language when the installation identifier is unavailable", async () => {
    invoke.mockRejectedValue(new Error("no database"));
    check.mockResolvedValue(null);

    await act(() => mod.checkForUpdates({ manual: false }));

    expect(check).toHaveBeenCalledWith({ headers: { "X-App-Language": "en" } });
  });

  it.each(LOCALES)("reports the effective UI language %s", async (locale) => {
    i18n.setLang(locale);
    check.mockResolvedValue(null);

    await act(() => mod.checkForUpdates());

    expect(check).toHaveBeenCalledWith({
      headers: {
        "X-Install-Id": "11111111-2222-3333-4444-555555555555",
        "X-App-Language": locale,
      },
    });
  });

  it("reports the new language on the next check without re-reading the installation identifier", async () => {
    check.mockResolvedValue(null);
    i18n.setLang("zh-CN");
    await act(() => mod.checkForUpdates());
    i18n.setLang("ja");
    await act(() => mod.checkForUpdates({ manual: true }));

    expect(check.mock.calls.map(([options]) => options.headers["X-App-Language"])).toEqual(["zh-CN", "ja"]);
    expect(invoke).toHaveBeenCalledTimes(1);
  });

  it("reports the resolved system language when the language choice is auto", async () => {
    vi.spyOn(navigator, "languages", "get").mockReturnValue(["zh-Hant-HK"]);
    i18n.setLang("auto");
    check.mockResolvedValue(null);

    await act(() => mod.checkForUpdates());

    expect(check).toHaveBeenCalledWith({
      headers: {
        "X-Install-Id": "11111111-2222-3333-4444-555555555555",
        "X-App-Language": "zh-TW",
      },
    });
  });

  it("keeps reporting while a prompt is pending, releasing the duplicate handle", async () => {
    check.mockResolvedValueOnce(fakeUpdate("0.2.0"));
    await act(() => mod.checkForUpdates({ manual: false }));
    const duplicate = fakeUpdate("0.2.0");
    check.mockResolvedValueOnce(duplicate);

    await act(() => mod.checkForUpdates({ manual: false }));

    // Two requests reached the server, and the prompt still holds its original handle.
    expect(check).toHaveBeenCalledTimes(2);
    expect(duplicate.close).toHaveBeenCalledOnce();
  });
});

describe("a check while a prompt is already pending", () => {
  it("replaces a stale prompt when the menu check finds a newer release", async () => {
    const stale = fakeUpdate("0.1.101");
    check.mockResolvedValueOnce(stale);
    const { result } = renderHook(() => useUpdateState());
    await act(() => checkForUpdates({ manual: false }));
    expect(result.current.prompt?.version).toBe("0.1.101");

    check.mockResolvedValueOnce(fakeUpdate("0.1.104"));
    await act(() => checkForUpdates({ manual: true }));

    // The menu action reached the server rather than reopening what was already on screen.
    expect(check).toHaveBeenCalledTimes(2);
    expect(result.current.prompt?.version).toBe("0.1.104");
    expect(result.current.modalOpen).toBe(true);
    expect(stale.close).toHaveBeenCalledOnce();
  });

  it("replaces a stale prompt from a silent check too", async () => {
    check.mockResolvedValueOnce(fakeUpdate("0.1.101"));
    const { result } = renderHook(() => useUpdateState());
    await act(() => checkForUpdates({ manual: false }));

    check.mockResolvedValueOnce(fakeUpdate("0.1.104"));
    await act(() => checkForUpdates({ manual: false }));

    expect(result.current.prompt?.version).toBe("0.1.104");
    // A silent check lights the status bar without opening the dialog, replacement included.
    expect(result.current.modalOpen).toBe(false);
  });

  it("retires a pending prompt once the server reports no newer release", async () => {
    const stale = fakeUpdate("0.1.101");
    check.mockResolvedValueOnce(stale);
    const { result } = renderHook(() => useUpdateState());
    await act(() => checkForUpdates({ manual: false }));

    check.mockResolvedValueOnce(null);
    await act(() => checkForUpdates({ manual: false }));

    expect(result.current.prompt).toBeNull();
    expect(stale.close).toHaveBeenCalledOnce();
  });
});

describe("relaunch marker around installs and restarts", () => {
  function invokeOrder(cmd: string): number {
    const index = invoke.mock.calls.findIndex(([name]) => name === cmd);
    return invoke.mock.invocationCallOrder[index];
  }

  async function promptFor(version: string) {
    const update = fakeUpdate(version);
    check.mockResolvedValueOnce(update);
    await act(() => checkForUpdates({ manual: false }));
    return update;
  }

  function userAgent(ua: string) {
    vi.spyOn(navigator, "userAgent", "get").mockReturnValue(ua);
  }

  afterEach(() => vi.restoreAllMocks());

  it("marks an internal relaunch before installing so the next start skips the launcher", async () => {
    const update = await promptFor("0.2.0");

    await act(() => startInstall());

    expect(invoke).toHaveBeenCalledWith("mark_internal_relaunch");
    expect(invokeOrder("mark_internal_relaunch")).toBeLessThan(
      update.downloadAndInstall.mock.invocationCallOrder[0],
    );
  });

  it("clears the relaunch marker when installation fails", async () => {
    const update = await promptFor("0.2.0");
    update.downloadAndInstall.mockRejectedValueOnce(new Error("boom"));

    await act(() => startInstall());

    expect(invoke).toHaveBeenCalledWith("clear_internal_relaunch");
  });

  it("clears the marker after a successful install on macOS or Linux, where restartApp marks it again", async () => {
    userAgent("Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/605.1.15");
    const update = await promptFor("0.2.0");

    await act(() => startInstall());

    expect(invoke).toHaveBeenCalledWith("clear_internal_relaunch");
    expect(invokeOrder("clear_internal_relaunch")).toBeGreaterThan(
      update.downloadAndInstall.mock.invocationCallOrder[0],
    );
  });

  it("keeps the marker after a successful install on Windows, where the installer relaunches the app", async () => {
    userAgent("Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36");
    await promptFor("0.2.0");

    await act(() => startInstall());

    expect(invoke).not.toHaveBeenCalledWith("clear_internal_relaunch");
  });

  it("still installs when the marker cannot be written", async () => {
    const update = await promptFor("0.2.0");
    invoke.mockRejectedValue(new Error("no data dir"));

    await act(() => startInstall());

    expect(update.downloadAndInstall).toHaveBeenCalledOnce();
  });

  it("marks an internal relaunch before restarting", async () => {
    await restartApp();

    expect(invoke).toHaveBeenCalledWith("mark_internal_relaunch");
    expect(invokeOrder("mark_internal_relaunch")).toBeLessThan(relaunch.mock.invocationCallOrder[0]);
  });
});

describe("the silent check schedule", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it("checks shortly after launch and again once six hours of wall-clock time have passed", async () => {
    check.mockResolvedValue(null);
    const stop = startUpdateSchedule();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(5_000);
    });
    expect(check).toHaveBeenCalledTimes(1);

    // Five hours of ticks must not trigger a second check.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5 * 60 * 60 * 1000);
    });
    expect(check).toHaveBeenCalledTimes(1);

    // Past the six-hour mark the next tick checks again.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(70 * 60 * 1000);
    });
    expect(check).toHaveBeenCalledTimes(2);

    stop();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(12 * 60 * 60 * 1000);
    });
    expect(check).toHaveBeenCalledTimes(2);
  });
});
