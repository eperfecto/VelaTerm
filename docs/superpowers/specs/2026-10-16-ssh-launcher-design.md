# SSH Launcher and Hidden Local Window — Design

## Intent

When the user connects over SSH, VelaTerm ends up with two windows: the new SSH window and the local ("main") window. In practice the local window goes unused during the SSH session and only adds noise when switching windows (Alt+Tab, Cmd+Tab, taskbar). The user wants to work in the SSH window alone, at least for that session.

## Goals

1. Every app launch shows a small launcher window asking how to start: **Local terminal** or **Connect via SSH**.
2. Choosing SSH from the launcher connects without ever showing the local window.
3. Connecting over SSH from the normal app (existing flow, unchanged location) asks whether to hide the local window.
4. When the last SSH window closes while the local window is hidden, ask: return to the local app, or quit.

## Non-goals

- No persistent preference. Hiding is per session; the launcher always asks.
- No WSL / URL / remote-account options in the launcher (builder's call: SSH only, per the user's "normal or SSH").
- No tray icon.
- No change to where SSH lives in the normal app.

## Anti-goals

- Closing (destroying) the main window. Closing main quits the app today (`src-tauri/src/lib.rs` run loop, `CloseRequested` on `"main"` → `request_quit_confirmation`), which would kill SSH windows. Main must be **hidden**, never closed.
- Leaving the user with no visible window and a running process (e.g. SSH connect fails after launcher closed, or SSH window closes and no prompt appears).

## Current state (from code recon)

- Main window: defined in `src-tauri/tauri.conf.json:13-24`, label `"main"`, starts `visible: false`, shown in `.setup()` at `src-tauri/src/lib.rs:874-877`.
- Single-instance plugin focuses `"main"` on relaunch (`lib.rs:594-598`).
- SSH flow: `src/layout/TitleBar/ConnectRemotePanel.tsx` → `ssh_probe_host` / `ssh_trust_host` / `ssh_connect` (`src-tauri/src/commands.rs:1042`) → `open_login_window(..., RemoteWindowKind::Ssh)` (`commands.rs:1232`), window label `ssh-<8hex>`.
- SSH window `CloseRequested` handler (`commands.rs:1305+`) already asks stop/keep remote service.
- `ConnectRemotePanel` props `{onClose, showSharedDb?}`; depends on `invoke`, `useSharingLocation`/`sharingNavigate`, `useT`. `wsl_connect` rejects non-main callers (`commands.rs:1191`) — irrelevant since launcher is SSH-only, but `ssh_connect` must accept the launcher as caller.
- Settings: SQLite `app_settings` via `src/ipc/settingsSync.ts` (not needed — no persistence).
- Remote window counting: `remote_window_count` (`commands.rs:826`).

## Behaviour

### Launch

- On startup, do **not** show main. Open a new window, label `launcher`, ~480x320, centered, non-resizable, title `VelaTerm`.
- Launcher content: heading "How do you want to start?", two buttons **Local terminal** / **Connect via SSH**.
- **Local terminal** → show + focus main, close launcher.
- **Connect via SSH** → launcher shows the SSH connect form (reuse `ConnectRemotePanel` in SSH mode, or its SSH part). On successful `ssh_connect`, the SSH window opens, launcher closes, main stays hidden ("hidden mode").
- Launcher has a way back from the SSH form to the two choices.
- Closing the launcher with the window X quits the app (builder's call).
- If SSH connect fails, the launcher stays open with the error, as the panel does today.

- Main still initializes normally while hidden: it restores the saved workspace and starts local shells in the background (user decision). No deferred initialization.

### Connecting from the normal app

- After a successful `ssh_connect` invoked from main (main visible), ask: "Hide the local window while you work over SSH?" — **Hide** / **Keep open**. Hide → main hidden (hidden mode).

### Hidden mode

- Main is hidden (not in Alt+Tab, taskbar). On macOS the Dock icon remains (process alive).
- Single-instance relaunch while in hidden mode: focus the most recent SSH window rather than revealing main (builder's call).
- macOS Dock click (`RunEvent::Reopen`, not handled today): focus an SSH window; if none exist, show main (builder's call).

### Closing the last SSH window in hidden mode

- Existing stop/keep remote service prompt runs first, unchanged.
- Then, if no other remote windows remain (`ssh-`, `wsl-`, `remote-`, `account-remote-` labels) and main is hidden, ask: **Return to local app** / **Quit VelaTerm**.
  - Return → show + focus main, exit hidden mode.
  - Quit → exit the app through the existing quit path.
- If other SSH windows remain, no prompt.
- Must never leave the process with zero visible windows.
- Dismissing the prompt (Esc) = Return to local app. The check also runs on `Destroyed`, not only `CloseRequested`.

### Quitting while main is hidden (decided by Claude)

The existing quit confirmation (`request_quit_confirmation`, `lib.rs:1347`) is drawn by main's webview; with main hidden it would render invisibly and block exit. So:

- **Quit VelaTerm** from the last-SSH-window prompt and closing the launcher with X are explicit quits: skip the confirmation and exit directly, keeping the default workspace-save behaviour.
- Any other quit request in hidden mode (Cmd+Q, OS shutdown) shows main first, then runs the normal confirmation.

### Launches that skip the launcher (decided by Claude)

The launcher shows on a plain user launch. It is skipped (main shows directly, as today) when the app starts with a project path (`run(initial_open_project)`, `vopen`, open-folder, macOS file open) or on an internal restart (update, settings-triggered relaunch). A second-instance launch never shows the launcher.

### App-level input in hidden mode (decided by Claude)

Menu actions, global shortcuts and notification clicks that target `"main"` reveal main first (exiting hidden mode), then act as today. No rerouting into SSH windows.

## UI copy

English, through the existing i18n (`useT`) — add keys for every locale the app ships, following existing patterns.

## Constraints

- Tauri v2, Windows and macOS.
- Follow existing patterns: Rust commands in `commands.rs`, called from the frontend with `invoke`.
- Window-level behaviour cannot be fully unit-tested; the builder should add unit tests where logic is pure (e.g. "should prompt on close" decision) and provide a manual test checklist for Windows and macOS.

## Left to the builder

- How the launcher webview identifies itself (URL query vs init script, mirroring how SSH windows use `__VLX_REMOTE__`).
- Whether dialogs are native (`tauri-plugin-dialog`) or in-webview.
- Where hidden-mode state lives (Rust managed state is the natural fit).
- Exact launcher styling, matching the current theme (light/dark).
