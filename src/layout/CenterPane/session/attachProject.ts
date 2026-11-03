//! "Attach project" chip of a Claude chat: lets the agent work in another project's folder. The backend
//! adds the folder to the session's launch arguments as `--add-dir` and the next message relaunches the
//! agent with it, resuming the same conversation.

import { projectRoot, type Project, type Session } from "../../../types";
import type { ChipOption } from "./controls";

/** Split launch arguments the way the backend's `split_extra_args` does: quotes group, a backslash
 *  escapes outside single quotes. Display-only, so it only needs to agree on well-formed input. */
function splitArgs(text: string): string[] {
  const out: string[] = [];
  let current = "";
  let started = false;
  let quote: string | null = null;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === "\\" && quote !== "'") {
      if (i + 1 < text.length) { current += text[++i]; started = true; }
    } else if ((c === "'" || c === '"') && quote === null) {
      quote = c; started = true;
    } else if (c === quote) {
      quote = null;
    } else if (/\s/.test(c) && quote === null) {
      if (started) out.push(current);
      current = ""; started = false;
    } else {
      current += c; started = true;
    }
  }
  if (started) out.push(current);
  return out;
}

const trimSep = (path: string) => path.replace(/[\\/]+$/, "");

/** Folders already passed with `--add-dir`, without trailing separators. */
function addedDirs(agentArgs: string | null | undefined): Set<string> {
  const args = splitArgs(agentArgs ?? "");
  const dirs = new Set<string>();
  args.forEach((arg, i) => {
    if (arg.startsWith("--add-dir=")) dirs.add(trimSep(arg.slice("--add-dir=".length)));
    else if (arg === "--add-dir" && i + 1 < args.length) dirs.add(trimSep(args[i + 1]));
  });
  return dirs;
}

/** Every other project that has a folder, in sidebar order, with its path as the hint and `attachedTag`
 *  on the ones this session already reaches. */
export function attachProjectOptions(
  projects: Project[],
  session: Session,
  attachedTag: string,
): ChipOption<string>[] {
  const added = addedDirs(session.agentArgs);
  return [...projects]
    .sort((a, b) => a.sortOrder - b.sortOrder)
    .flatMap((project) => {
      const root = projectRoot(project);
      if (!root || project.id === session.projectId) return [];
      const option: ChipOption<string> = { value: project.id, label: project.name, hint: root };
      if (added.has(trimSep(root))) option.tag = attachedTag;
      return [option];
    });
}

/** User-facing text for a failed attach: the backend's refusal codes get a sentence, anything else is
 *  shown as reported. */
export function attachProjectError(error: unknown, t: (key: never) => string): string {
  const text = error instanceof Error ? error.message : String(error);
  const keys: Record<string, string> = {
    CHAT_ATTACH_BUSY: "chat.attachProject.busy",
    // A permission restart of the same process is in progress: also a reason to wait.
    CHAT_PERMISSION_RESTART_BUSY: "chat.attachProject.busy",
    CHAT_ATTACH_NO_FOLDER: "chat.attachProject.noFolder",
    CHAT_ATTACH_OWN_PROJECT: "chat.attachProject.ownProject",
    CHAT_ATTACH_UNSUPPORTED: "chat.attachProject.unsupported",
  };
  const key = keys[text.trim()];
  return key ? t(key as never) : text;
}
