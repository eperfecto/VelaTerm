import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

vi.mock("../platform/env", () => ({ env: { isTauri: true, isElectron: false } }));
vi.mock("../ipc/transport", () => ({ invoke: vi.fn(), listen: vi.fn().mockResolvedValue(() => {}) }));
vi.mock("../hooks/nativeViewSuspend", () => ({ useSuspendNativeViews: vi.fn() }));
vi.mock("../theme", () => ({ applyTheme: vi.fn(), loadTheme: vi.fn(() => "dark") }));
vi.mock("../sharing/RemoteDevices", () => ({ RemoteDevices: () => null }));

import { invoke } from "../ipc/transport";
import { setLang } from "../i18n";
import { LauncherApp } from "./LauncherApp";

beforeEach(() => {
  setLang("en");
  vi.clearAllMocks();
  history.replaceState(null, "", "/");
  vi.mocked(invoke).mockImplementation(async () => []);
});
afterEach(cleanup);

it("shows the two start choices", () => {
  render(<LauncherApp />);
  expect(screen.getByText("How do you want to start?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Local terminal" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect via SSH" })).toBeTruthy();
});

it("Local terminal asks the backend to reveal main", () => {
  render(<LauncherApp />);
  fireEvent.click(screen.getByRole("button", { name: "Local terminal" }));
  expect(invoke).toHaveBeenCalledWith("launcher_choose_local");
});

it("Connect via SSH shows the SSH-only form, Back returns to the choices", () => {
  render(<LauncherApp />);
  fireEvent.click(screen.getByRole("button", { name: "Connect via SSH" }));
  expect(invoke).toHaveBeenCalledWith("launcher_resize", { expanded: true });
  expect(screen.queryByText("URL")).toBeNull();
  fireEvent.click(screen.getByRole("button", { name: "Back" }));
  expect(invoke).toHaveBeenCalledWith("launcher_resize", { expanded: false });
  expect(screen.getByRole("button", { name: "Local terminal" })).toBeTruthy();
});

it("a failed connect keeps the form open with the error", async () => {
  vi.mocked(invoke).mockImplementation(async (c) => {
    if (c === "ssh_probe_host") return { status: "known", target: "u@h", keyType: "ed25519", fingerprint: "x" };
    if (c === "ssh_connect") throw "connection refused";
    return [];
  });
  render(<LauncherApp />);
  fireEvent.click(screen.getByRole("button", { name: "Connect via SSH" }));
  const input = document.querySelector(".connect-panel input") as HTMLInputElement;
  fireEvent.change(input, { target: { value: "u@h" } });
  fireEvent.click(screen.getByRole("button", { name: "Connect" }));
  expect(await screen.findByText(/connection refused/)).toBeTruthy();
});
