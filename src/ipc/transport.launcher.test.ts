import { beforeAll, describe, expect, it, vi } from "vitest";

const tauriInvoke = vi.fn(async () => undefined);
vi.mock("@tauri-apps/api/core", () => ({ invoke: tauriInvoke, Channel: class {} }));
vi.mock("@tauri-apps/api/event", () => ({ listen: vi.fn(async () => () => {}) }));

let invoke: typeof import("./transport").invoke;

beforeAll(async () => {
  (window as unknown as Record<string, unknown>).__TAURI_INTERNALS__ = {};
  ({ invoke } = await import("./transport"));
});

describe("launcher commands on the desktop transport", () => {
  it.each([
    "launcher_choose_local",
    "launcher_resize",
    "set_hidden_mode_copy",
    "mark_internal_relaunch",
    "clear_internal_relaunch",
  ])("%s is invoked as a native command, not through desktop_call", async (cmd) => {
    tauriInvoke.mockClear();
    await invoke(cmd, {});
    expect(tauriInvoke).toHaveBeenCalledWith(cmd, expect.anything());
    expect(tauriInvoke).not.toHaveBeenCalledWith("desktop_call", expect.objectContaining({ cmd }));
  });
});
