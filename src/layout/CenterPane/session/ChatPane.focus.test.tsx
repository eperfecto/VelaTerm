//! Switching to a conversation's tab puts the keyboard in its composer, as switching to a terminal focuses it.

import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../../ipc/transport", async (original) => ({
  ...await original<typeof import("../../../ipc/transport")>(), invoke: vi.fn(), listen: vi.fn(), onTransportReconnect: vi.fn(),
}));
vi.mock("./engineSwitch", () => ({ useEngineSwitch: () => ({ switchTo: vi.fn(), confirm: null }) }));
vi.mock("./controls", () => ({ LevelBar: () => null, ControlChip: () => null }));

import { invoke, listen, onTransportReconnect } from "../../../ipc/transport";
import { useTermStore } from "../../../store/termStore";
import { ChatPane } from "./ChatPane";
import { useOutbox } from "./outbox";
import { clearChatCache } from "./chatCache";

const SESSION = { id: "s", projectId: "p", name: "Claude", kind: "claude", engine: "chat", collapsed: false, sortOrder: 0, createdAt: 0 } as const;

beforeEach(() => {
  clearChatCache();
  useOutbox.setState({ sessions: {} });
  vi.mocked(invoke).mockReset();
  vi.mocked(onTransportReconnect).mockImplementation(() => () => {});
  vi.mocked(listen).mockImplementation(() => Promise.resolve(() => {}));
  useTermStore.setState({
    chatModel: "m", chatModelByKind: { claude: "m" }, chatEffortByModel: {}, runtimes: {}, agentDefaults: {},
    activeSessionId: "s", mirrorFocusSessionId: null,
  });
  vi.mocked(invoke).mockImplementation((command) => {
    if (command === "chat_snapshot") return Promise.resolve({
      submissionReceipts: true, running: false, model: "m", mode: "default", rows: [], queue: [], permissions: [], commands: [], configKeys: [],
    }) as Promise<never>;
    if (command === "chat_models") return Promise.resolve([{ id: "m", label: "M", description: "", effortLevels: ["high"] }]) as Promise<never>;
    return Promise.resolve(undefined) as Promise<never>;
  });
});
afterEach(cleanup);

const pane = (hidden: boolean) => (
  <ChatPane session={SESSION} area={{}} hidden={hidden} focused={!hidden} multi={false}
    onActivate={() => {}} onSplit={() => {}} onClose={() => {}} />
);

async function mountHidden() {
  const view = render(pane(true));
  await waitFor(() => expect(vi.mocked(invoke).mock.calls.some(([command]) => command === "chat_snapshot")).toBe(true));
  await act(async () => {});
  return view;
}

async function show(view: ReturnType<typeof render>) {
  view.rerender(pane(false));
  // The focus waits one animation frame for the pane to be displayed.
  await act(async () => { await new Promise((resolve) => requestAnimationFrame(() => resolve(null))); });
}

describe("composer focus on tab switch", () => {
  it("focuses the composer when the conversation becomes the visible active session", async () => {
    const view = await mountHidden();
    await show(view);
    expect(document.activeElement).toBe(screen.getByRole("textbox"));
  });

  it("leaves focus alone when another session is active", async () => {
    useTermStore.setState({ activeSessionId: "other" });
    const view = await mountHidden();
    await show(view);
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));
  });

  it("does not take focus for an activation mirrored from another client, and consumes the marker", async () => {
    useTermStore.setState({ mirrorFocusSessionId: "s" });
    const view = await mountHidden();
    await show(view);
    expect(document.activeElement).not.toBe(screen.getByRole("textbox"));
    expect(useTermStore.getState().mirrorFocusSessionId).toBeNull();
  });
});
