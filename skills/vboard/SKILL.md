---
name: vboard
description: >-
  Manage a VelaTerm task board: a chief session owns tasks with statuses backlog, in_progress, review and
  done, assigns them to worker sessions, and workers move or block their own tasks while reporting to the
  chief in the same command. Use when the user asks to organize work as a board, track tasks across child
  sessions, assign a task to a worker, or when this session received a "[Board]" task brief.
---

# vboard

The board is stored by VelaTerm, not in an external tracker. Use these commands rather than editing
SQLite or sending free-form status messages.

```bash
vboard list
vboard show T3
vboard add "title" [--label FE] [--link URL] [--status backlog|in_progress|review|done] [--worker SESSION] [-m body]
vboard assign T3 SESSION|none
vboard move T3 backlog|in_progress|review|done [-m report]
vboard block T3 -m reason
vboard unblock T3
vboard profile SESSION [--labels BE,BFF] [-m instructions | -m -]
```

Text given with `-m`, or piped on stdin with `-m -`, is delivered to the other side of the task. Without
`-m -` the command never reads stdin. Quote titles and session names containing spaces; put `--` before
a title that starts with a dash. `SESSION` accepts a session ID, an ID prefix, an exact name or a unique
name substring.

## As the chief

- The first `vboard add` from a session makes it the chief of its own board. Tasks are numbered `T1`,
  `T2`, ... per board.
- Create worker sessions with `vspawn` as usual, then `vboard assign T3 <worker>`.
- `vboard move T3 in_progress` sends the assigned worker its task brief. Assigning a worker to a task that
  is already in progress sends the brief too. Other moves notify the worker.
- The worker's moves, reports and blockers arrive in your conversation as `[Board]` messages. Read
  `vboard list` for the whole board before deciding the next step; delivery does not prove completion.
- A worker whose turn ends without any board update after a board message has its task marked blocked,
  and you receive a notice. Inspect the worker with `vrefer` before resuming it.
- Only you move tasks to `done` and lift blockers with `vboard unblock T3` or by moving the task.
- Give each worker a profile on your board with `vboard profile <worker> --labels BE,BFF -m "instructions"`.
  Labels are comma-separated and stored uppercased. A task labeled `FE` cannot be assigned to (or added
  for) a worker whose labels do not include it: `T3 is labeled FE but <worker> only takes BE, BFF`. A
  worker without labels takes any task, and an unlabeled task fits any worker. The instructions are
  appended to every brief that worker receives on your board. An omitted `--labels` or `-m` keeps the
  current value; `--labels ""` or `-m ""` clears it. The user can edit profiles from the board view too,
  and you receive a `[Board] The user updated ...'s worker profile` notice. Changing a profile does not
  re-check tasks already assigned to that worker; review them with `vboard list` and reassign if needed.
- A session created as a board from VelaTerm is already a chief before its first task. The user can add,
  assign, move, block and unblock tasks from the board view with your permissions; each change reaches
  the worker as if you made it, and you receive a `[Board] The user ...` notice such as
  `[Board] The user moved T3 "title" backlog → in_progress.` Treat it as the user's decision and re-read
  `vboard list` before acting on the board.

## As a worker

- You can `list` your board and `show`, `move` or `block` only tasks assigned to you. Only the chief adds
  and assigns tasks.
- When you finish, move the task and report in one step:
  `vboard move T3 review -m "what changed and how you verified it"`.
- When you need a decision or are stuck, `vboard block T3 -m "what is blocking you"`. Only the chief
  unblocks a task, and you cannot move a blocked task; wait for the chief.
- Only the chief moves a task to `done`. Move finished work to `review`.
- A session works on one board at a time. Tasks in `done` no longer count, so once all your tasks are
  done another chief can assign you work.
- End every turn that started from a `[Board]` message with a board update. Ending silently blocks the
  task.

Messages reach native chat sessions. A terminal-engine session keeps them as `retained` in the result
instead of receiving them. The commands require a VelaTerm-hosted session and its injected `VLX_*`
environment; an "Unknown action" or 404 error means the running backend predates `vboard`.
