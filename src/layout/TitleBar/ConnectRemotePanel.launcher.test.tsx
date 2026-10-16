import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../../platform/env", () => ({ env: { isTauri: true, isElectron: false } }));
vi.mock("../../ipc/transport", () => ({ invoke: vi.fn(), listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../../hooks/nativeViewSuspend", () => ({ useSuspendNativeViews: vi.fn() }));
vi.mock("../../sharing/RemoteDevices", () => ({ RemoteDevices: () => null }));

import { invoke } from "../../ipc/transport";
import { setLang } from "../../i18n";
import { ConnectRemotePanel } from "./ConnectRemotePanel";

beforeEach(() => {
  setLang("en");
  vi.clearAllMocks();
  vi.mocked(invoke).mockImplementation(async () => []);
});
afterEach(cleanup);

it("sshOnly ignores ?connect=wsl and hides the mode tabs", () => {
  history.replaceState(null, "", "/?connect=wsl");
  render(<ConnectRemotePanel onClose={vi.fn()} sshOnly variant="embedded" />);
  expect(invoke).not.toHaveBeenCalledWith("wsl_options");
  expect(screen.queryByText("SSH")).toBeNull();
});

it("embedded variant ignores Escape", () => {
  const close = vi.fn();
  render(<ConnectRemotePanel onClose={close} sshOnly variant="embedded" />);
  fireEvent.keyDown(document.querySelector(".connect-panel")!, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
});
