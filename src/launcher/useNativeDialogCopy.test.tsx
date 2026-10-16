import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const envMock = vi.hoisted(() => ({ env: { isTauri: true, isElectron: false } }));
vi.mock("../platform/env", () => envMock);
vi.mock("../ipc/transport", () => ({ invoke: vi.fn().mockResolvedValue(undefined) }));

import { invoke } from "../ipc/transport";
import { setLang } from "../i18n";
import { useNativeDialogCopy } from "./useNativeDialogCopy";

beforeEach(() => {
  envMock.env.isTauri = true;
  envMock.env.isElectron = false;
  setLang("en");
  vi.clearAllMocks();
});
afterEach(cleanup);

it("pushes the localized hidden-mode copy to the backend", async () => {
  setLang("es");
  renderHook(() => useNativeDialogCopy());
  await waitFor(() =>
    expect(invoke).toHaveBeenCalledWith("set_hidden_mode_copy", {
      copy: expect.objectContaining({
        hidePrompt: "¿Ocultar la ventana local mientras trabajas por SSH?",
        returnToLocal: "Volver a la app local",
        quit: "Salir de VelaTerm",
      }),
    }),
  );
});

it("does nothing in remote windows (browser transport)", () => {
  envMock.env.isTauri = false;
  renderHook(() => useNativeDialogCopy());
  expect(invoke).not.toHaveBeenCalled();
});

it("does nothing under Electron", () => {
  envMock.env.isElectron = true;
  renderHook(() => useNativeDialogCopy());
  expect(invoke).not.toHaveBeenCalled();
});
