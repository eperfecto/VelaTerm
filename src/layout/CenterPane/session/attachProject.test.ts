import { describe, expect, it } from "vitest";
import type { Project, Session } from "../../../types";
import { attachProjectError, attachProjectOptions } from "./attachProject";

const project = (id: string, name: string, rootPath: string | null, sortOrder = 0): Project =>
  ({ id, name, rootPath, sortOrder, collapsed: false, createdAt: 0, collectionId: null }) as Project;
const session = (agentArgs?: string): Session =>
  ({ id: "s", projectId: "own", name: "chat", kind: "claude", engine: "chat", agentArgs }) as Session;

describe("attachProjectOptions", () => {
  it("offers every other project with a folder, marking the attached ones", () => {
    const projects = [
      project("own", "Own", "/repo/own"),
      project("api", "API", "/repo/api"),
      project("set", "Collection", null),
      project("web", "Web", "/repo/my web"),
    ];
    const options = attachProjectOptions(projects, session("--model opus --add-dir '/repo/my web'"), "attached");
    expect(options).toEqual([
      { value: "api", label: "API", hint: "/repo/api" },
      { value: "web", label: "Web", hint: "/repo/my web", tag: "attached" },
    ]);
  });

  it("marks nothing as attached when the session has no extra folders", () => {
    const options = attachProjectOptions([project("api", "API", "/repo/api")], session(), "attached");
    expect(options).toEqual([{ value: "api", label: "API", hint: "/repo/api" }]);
  });
});

describe("attachProjectError", () => {
  it("words the known refusals and passes anything else through", () => {
    const t = (key: string) => key;
    expect(attachProjectError("CHAT_ATTACH_BUSY", t)).toBe("chat.attachProject.busy");
    expect(attachProjectError(new Error("CHAT_ATTACH_BUSY"), t)).toBe("chat.attachProject.busy");
    expect(attachProjectError("CHAT_ATTACH_NO_FOLDER", t)).toBe("chat.attachProject.noFolder");
    expect(attachProjectError("disk full", t)).toBe("disk full");
  });
});
