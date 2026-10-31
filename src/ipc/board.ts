//! Chief-owned task boards: a chat session flagged as a board, its tasks, and the actions the UI takes on them
//! as the human user. Mirrors the backend `board_*` commands one-to-one in camelCase.

import { invoke } from "./transport";

export type BoardStatus = "backlog" | "in_progress" | "review" | "done";

/** Fixed column order; blocked is a flag on a task, never a column. */
export const BOARD_STATUSES: BoardStatus[] = ["backlog", "in_progress", "review", "done"];

export interface BoardTask {
  id: string;
  chiefId: string;
  number: number;
  /** Per-board reference such as `T3`. */
  ref: string;
  title: string;
  body: string;
  label: string | null;
  link: string | null;
  status: BoardStatus;
  blockedReason: string | null;
  workerId: string | null;
  position: number;
  createdAt: number;
  updatedAt: number;
  workerName?: string | null;
  workerState?: string | null;
}

/** A worker's profile on one board: the task labels it takes and instructions appended to its task briefs. */
export interface BoardWorker {
  workerId: string;
  name: string | null;
  /** Uppercase labels; empty accepts any task. */
  labels: string[];
  instructions: string;
}

export interface BoardList {
  chiefId: string;
  board: string | null;
  role: "chief";
  columns: { status: BoardStatus; tasks: BoardTask[] }[];
  /** Worker profiles on this board, ordered by name. */
  workers: BoardWorker[];
}

export interface BoardActionRequest {
  action: "add" | "assign" | "move" | "block" | "unblock" | "show" | "profile";
  /** Task reference such as `T3`. */
  task?: string;
  title?: string;
  label?: string;
  link?: string;
  status?: BoardStatus;
  /** Worker session ID, or `"none"` to unassign. */
  worker?: string;
  /** Task body for `add`, report for `move`, reason for `block`, instructions for `profile` ("" clears). */
  text?: string;
  /** Comma-separated worker labels for `profile`, e.g. "BE, BFF"; omitted keeps them, "" clears them. */
  labels?: string;
}

/** Flag a chief chat session as a board. */
export const boardRegister = (chiefId: string) => invoke<{ chiefId: string }>("board_register", { chiefId });

/** Every session currently flagged as a board. */
export const boardIds = () => invoke<string[]>("board_ids", {});

export const boardList = (chiefId: string) => invoke<BoardList>("board_list", { chiefId });

/** Act on the board as the human user; the backend notifies the chief and the affected worker.
 *  Task actions return `task`; `profile` returns `worker`. */
export const boardAction = (chiefId: string, request: BoardActionRequest) =>
  invoke<{ task?: BoardTask; worker?: BoardWorker; message?: unknown }>("board_action", { chiefId, request });
