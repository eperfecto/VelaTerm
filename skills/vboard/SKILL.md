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

## As a worker

- You can `list` your board and `show`, `move` or `block` only tasks assigned to you. Only the chief adds
  and assigns tasks.
- When you finish, move the task and report in one step:
  `vboard move T3 review -m "what changed and how you verified it"`.
- When you need a decision or are stuck, `vboard block T3 -m "what is blocking you"`. Moving a task
  clears its blocked flag.
- End every turn that started from a `[Board]` message with a board update. Ending silently blocks the
  task.

Messages reach native chat sessions. A terminal-engine session keeps them as `retained` in the result
instead of receiving them. The commands require a VelaTerm-hosted session and its injected `VLX_*`
environment; an "Unknown action" or 404 error means the running backend predates `vboard`.
