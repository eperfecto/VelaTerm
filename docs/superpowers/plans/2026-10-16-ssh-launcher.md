# SSH Launcher and Hidden Local Window Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every plain launch shows a small launcher (Local terminal / Connect via SSH), and SSH sessions can run with the local `main` window hidden, while always leaving the user a visible window or a clean way to quit.

**Architecture:** A new Rust module `src-tauri/src/launcher.rs` owns the hidden-mode state (managed `LauncherState`), the pure decisions (show launcher? offer return? which window to focus?) and the window operations (open launcher, hide/reveal main, silent quit). "Hidden mode" is derived from `main.is_visible()`, never from a separate flag, so every existing `show()` call keeps it consistent. The launcher is a second local webview (`label = "launcher"`) that renders a small React tree (`src/launcher/LauncherApp.tsx`) reusing `ConnectRemotePanel` in an embedded SSH-only variant. Native prompts use `tauri-plugin-dialog` from Rust, with copy pushed from the main webview's i18n.

**Tech Stack:** Tauri v2 (Rust, `tauri-plugin-dialog`, `tauri-plugin-single-instance`), React 18 + TypeScript, Vitest + Testing Library, `cargo test`.

**Spec:** `docs/superpowers/specs/2026-10-16-ssh-launcher-design.md`

## Global Constraints

- Tauri v2, Windows and macOS. Electron shell behaviour is unchanged (new platform methods are no-ops there).
- Main window is **hidden, never closed**: never call `close()`/`destroy()` on `"main"`.
- The process must never be left with zero visible windows.
- No persistent preference: hiding is per session; the launcher always asks on a plain launch.
- Launcher: label `launcher`, ~480x320, centered, non-resizable, title `VelaTerm`; SSH only (no WSL / URL / Remote).
- Remote window label prefixes: `ssh-`, `wsl-`, `remote-`, `account-remote-`.
- Rust commands live in `commands.rs` / new module, called from the frontend with `invoke` (`src/ipc/transport.ts`).
- All UI copy in English through `useT`; add every new key to all 11 locales in `src/i18n/locales/` (`en, es, de, fr, ja, ko, pt-BR, ru, vi, zh-CN, zh-TW`), non-English entries carrying the `// English` trailing comment like existing keys.
- Code, comments, commit messages in English. Conventional commits. **No `Co-Authored-By` or any AI attribution in commits.**
- Do not stage the unrelated working-tree change in `src-tauri/Cargo.toml`.
- Test commands: Rust `cargo test --manifest-path src-tauri/Cargo.toml --lib <filter>`; frontend `pnpm vitest run <file>`; type check `pnpm exec tsc --noEmit`.

## Review Focus

1. **Exit-time window destruction** (quit confirmed, updater restart, `app.exit`) destroys SSH windows while main is hidden — the "Return / Quit" prompt must NOT appear during an exit. Pinned by `should_offer_return` tests with `exiting = true` (Task 1) and the `exiting` latch set in the run loop (Task 6).
2. **`Destroyed` sees the dying window in `webview_windows()`** (Tauri does not guarantee removal order) — counting must exclude the destroyed label or the last window never triggers the prompt. Pinned by `remote_count_excluding` test (Task 1).
3. **SSH window creation fails after `ssh_connect` succeeded** (today the error is only logged at `commands.rs:1166`) — from the launcher this would close the launcher with nothing visible. `ssh_connect` must now await window creation and return its error. Pinned by Task 5 step "window open failure keeps launcher".
4. **Hidden main webview cannot show the quit dialog** — any quit while main is hidden must either reveal main first or take the silent path, and the silent path must still exit if the hidden webview never answers (watchdog). Pinned by Task 2 tests.
5. **Launcher X during an in-flight `ssh_connect`** — must quit cleanly (silent path), not leave a hidden main plus an orphan SSH window. Pinned by Task 3 launcher `CloseRequested` handling and manual checklist item L5.

---

### Task 1: Pure hidden-mode decisions and state (`launcher.rs`)

**Files:**
- Create: `src-tauri/src/launcher.rs`
- Modify: `src-tauri/src/lib.rs:30-92` (add `#[cfg(feature = "gui")] mod launcher;` next to `mod native_menu;`), `src-tauri/src/lib.rs:608-640` (`.manage(launcher::LauncherState::default())`)
- Modify: `src-tauri/src/commands.rs:822-829` (`remote_window_count` uses `launcher::is_remote_label`)
- Test: `src-tauri/src/launcher.rs` (`#[cfg(test)] mod tests`)

**Interfaces:**
- Produces:
  - `pub(crate) const LAUNCHER_LABEL: &str = "launcher";`
  - `pub(crate) const RELAUNCH_MARKER: &str = "launcher-skip-once";` and `pub(crate) const RELAUNCH_MARKER_TTL: Duration = Duration::from_secs(30 * 60);`
  - `pub(crate) fn is_remote_label(label: &str) -> bool`
  - `pub(crate) fn remote_count_excluding<'a>(labels: impl Iterator<Item = &'a str>, excluded: &str) -> usize`
  - `pub(crate) fn should_show_launcher(has_open_project: bool, internal_relaunch: bool) -> bool`
  - `pub(crate) fn write_relaunch_marker(dir: &Path) -> std::io::Result<()>`
  - `pub(crate) fn clear_relaunch_marker(dir: &Path)`
  - `pub(crate) fn consume_relaunch_marker(dir: &Path, now: SystemTime) -> bool` — deletes the file always; true only if its mtime is within TTL.
  - `pub(crate) fn should_offer_return(remaining_remote: usize, main_visible: bool, exiting: bool) -> bool`
  - `#[derive(Debug, PartialEq)] pub(crate) enum FocusTarget { Main, Launcher, Remote(String) }`
  - `pub(crate) fn pick_focus_target(main_visible: bool, launcher_open: bool, recent_remotes: &[String]) -> FocusTarget` — `recent_remotes` ordered oldest→newest.
  - `#[derive(Default)] pub(crate) struct LauncherState { pub exiting: AtomicBool, pub focus_order: Mutex<Vec<String>>, pub copy: Mutex<HiddenModeCopy> }`
  - `#[derive(Clone, serde::Deserialize)] #[serde(rename_all = "camelCase")] pub(crate) struct HiddenModeCopy { pub hide_prompt: String, pub hide: String, pub keep_open: String, pub last_closed_prompt: String, pub return_to_local: String, pub quit: String }` with `Default` = the English strings from Task 4's key table.

- [ ] **Step 1: Write the failing tests**

```rust
#[test] fn remote_labels_match_every_connection_prefix() {
    for l in ["ssh-1a2b3c4d", "wsl-1a2b3c4d", "remote-x", "account-remote-x"] { assert!(is_remote_label(l)); }
    for l in ["main", "launcher", "screenshot", "sshx"] { assert!(!is_remote_label(l)); }
}
#[test] fn destroyed_window_is_not_counted() {
    let labels = ["main", "ssh-a", "ssh-b"];
    assert_eq!(remote_count_excluding(labels.iter().copied(), "ssh-a"), 1);
    assert_eq!(remote_count_excluding(["main", "ssh-a"].iter().copied(), "ssh-a"), 0);
}
#[test] fn launcher_shows_only_on_plain_launch() {
    assert!(should_show_launcher(false, false));
    assert!(!should_show_launcher(true, false));
    assert!(!should_show_launcher(false, true));
}
#[test] fn relaunch_marker_is_one_shot_and_expires() {
    let dir = tempfile::tempdir().unwrap();
    write_relaunch_marker(dir.path()).unwrap();
    let now = SystemTime::now();
    assert!(consume_relaunch_marker(dir.path(), now));
    assert!(!consume_relaunch_marker(dir.path(), now));            // consumed
    write_relaunch_marker(dir.path()).unwrap();
    assert!(!consume_relaunch_marker(dir.path(), now + RELAUNCH_MARKER_TTL + Duration::from_secs(1)));
    assert!(!dir.path().join(RELAUNCH_MARKER).exists());           // stale marker removed too
}
#[test] fn return_prompt_only_for_last_remote_with_hidden_main() {
    assert!(should_offer_return(0, false, false));
    assert!(!should_offer_return(1, false, false));
    assert!(!should_offer_return(0, true, false));
    assert!(!should_offer_return(0, false, true));                 // exiting: Review Focus 1
}
#[test] fn focus_prefers_visible_main_then_launcher_then_newest_remote() {
    let r = vec!["ssh-old".to_string(), "ssh-new".to_string()];
    assert_eq!(pick_focus_target(true, false, &r), FocusTarget::Main);
    assert_eq!(pick_focus_target(false, true, &r), FocusTarget::Launcher);
    assert_eq!(pick_focus_target(false, false, &r), FocusTarget::Remote("ssh-new".into()));
    assert_eq!(pick_focus_target(false, false, &[]), FocusTarget::Main);
}
```

If `tempfile` is not already a dev-dependency, use `std::env::temp_dir().join(uuid::Uuid::new_v4().to_string())` instead of adding a crate.

- [ ] **Step 2: Run tests to verify they fail**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib launcher::`
Expected: FAIL to compile (functions not defined).

- [ ] **Step 3: Implement the pure functions, `LauncherState`, `HiddenModeCopy` in `src-tauri/src/launcher.rs`; register module and managed state in `lib.rs`; make `commands::remote_window_count` filter with `is_remote_label`.**

- [ ] **Step 4: Run tests to verify they pass**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib launcher::`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/launcher.rs src-tauri/src/lib.rs src-tauri/src/commands.rs
git commit -m "feat(launcher): add hidden-mode decision logic and state"
```

---

### Task 2: Quit paths that work with a hidden main window

**Files:**
- Modify: `src-tauri/src/launcher.rs` (window ops)
- Modify: `src-tauri/src/lib.rs:1347-1385` (`request_quit_confirmation`), `src-tauri/src/lib.rs:1282-1293` (run loop `ExitRequested` arm)
- Modify: `src/platform/types.ts:162-171` (`QuitCapability`), `src/platform/tauri.ts:196-215`, `src/platform/electron.ts:216-228`
- Modify: `src/components/QuitConfirmModal.tsx:34-53`
- Test: `src/components/QuitConfirmModal.test.tsx`

**Interfaces:**
- Consumes: `LauncherState`, `LAUNCHER_LABEL` (Task 1); `crate::QuitState` (`lib.rs:103`).
- Produces:
  - `pub(crate) fn reveal_main(app: &AppHandle)` — unminimize + show + set_focus on `"main"`.
  - `pub(crate) fn hide_main(app: &AppHandle)`
  - `pub(crate) fn main_visible(app: &AppHandle) -> bool` — `is_visible().unwrap_or(true)`; missing window counts as visible (no hidden mode).
  - `pub(crate) fn quit_without_prompt(app: &AppHandle)` — sets `LauncherState.exiting`, emits `app://quit-silent` to `"main"` only (`emit_to`), then a 3000 ms watchdog thread that sets `QuitState.confirmed` and calls `app.exit(0)` if the process is still alive.
  - Event `app://quit-silent` (no payload).
  - `QuitCapability.onSilentRequested(cb: () => void): Promise<UnlistenFn | null>` (Electron: returns `null`).

- [ ] **Step 1: Write the failing frontend tests** (extend the existing `quit` mock with `onSilentRequested`, capturing `fireSilentQuit`)

```tsx
it("silent quit saves the workspace when the remembered preference is on, then confirms", async () => {
  store.saveWorkspaceOnQuit = true;
  render(<QuitConfirmModal />);
  await waitFor(() => expect(quit.onSilentRequested).toHaveBeenCalled());
  act(() => fireSilentQuit());
  await waitFor(() => expect(quit.confirm).toHaveBeenCalled());
  expect(store.saveWorkspaceSnapshot).toHaveBeenCalledTimes(1);
  expect(screen.queryByText("quit.title")).toBeNull();     // no dialog drawn
  expect(quit.ack).not.toHaveBeenCalled();
});
it("silent quit skips the snapshot when the remembered preference is off", async () => {
  store.saveWorkspaceOnQuit = false;
  /* same flow */ expect(store.saveWorkspaceSnapshot).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/components/QuitConfirmModal.test.tsx`
Expected: FAIL (`onSilentRequested` is not a function / not called).

- [ ] **Step 3: Implement**
  - `QuitConfirmModal`: second subscription in the same `useEffect`; handler does `await flushNow(FLUSH_TIMEOUT_MS)`, `if (useTermStore.getState().saveWorkspaceOnQuit) saveWorkspaceSnapshot()`, `void platform.quit.confirm()`. Guard re-entry with the existing `exiting` flag pattern.
  - `tauri.ts`: `listen("app://quit-silent", () => cb())`, same `env.isTauri` guard as `onRequested`.
  - Rust `request_quit_confirmation`: at the top, if the launcher window exists and main is not visible → `launcher::quit_without_prompt(app); return;` (quit at the launcher stage = closing the launcher). Else if `!launcher::main_visible(app)` → `launcher::reveal_main(app)` before emitting `app://quit-requested` (spec: Cmd+Q / OS shutdown in hidden mode shows main first).
  - Run loop: in the `ExitRequested` handling, when the exit is not prevented (code `Some(_)` or `QuitState.confirmed`), set `LauncherState.exiting = true`. Also set it in `commands::confirm_quit` and `native_quit_confirmation`'s confirm branch.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/components/QuitConfirmModal.test.tsx` → PASS (existing + 2 new).
Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib launcher::` → PASS; `pnpm exec tsc --noEmit` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/launcher.rs src-tauri/src/lib.rs src-tauri/src/commands.rs src/platform src/components/QuitConfirmModal.tsx src/components/QuitConfirmModal.test.tsx
git commit -m "feat(launcher): quit without the main-window dialog while main is hidden"
```

---

### Task 3: Launcher window, startup routing and skip rules (Rust + updater marker)

**Files:**
- Modify: `src-tauri/src/launcher.rs`
- Modify: `src-tauri/src/lib.rs:874-878` (setup: show main vs open launcher), `src-tauri/src/lib.rs:1208+` (`generate_handler!` registrations)
- Create: `src-tauri/capabilities/launcher.json`
- Modify: `src/ipc/updater.ts:157-187` (`startInstall`, `restartApp`)
- Test: `src/ipc/updater.test.tsx`

**Interfaces:**
- Consumes: `should_show_launcher`, `consume_relaunch_marker`, `write_relaunch_marker`, `clear_relaunch_marker`, `reveal_main`, `quit_without_prompt` (Tasks 1-2).
- Produces:
  - `pub(crate) fn open_launcher(app: &AppHandle) -> tauri::Result<()>` — `WebviewWindowBuilder::new(app, LAUNCHER_LABEL, WebviewUrl::App("index.html".into()))`, `.title("VelaTerm")`, `.inner_size(480.0, 320.0)`, `.resizable(false)`, `.maximizable(false)`, `.center()`, `.theme(crate::native_theme(app))`, `.initialization_script("window.__VLX_LAUNCHER__=true;")`, `.disable_drag_drop_handler()`. Registers `on_window_event`: `CloseRequested` → `api.prevent_close(); quit_without_prompt(app)` (user X = quit; programmatic close always uses `destroy()`, which skips `CloseRequested`).
  - `#[tauri::command] pub fn launcher_choose_local(app: AppHandle)` — `reveal_main`, then destroy launcher.
  - `#[tauri::command] pub fn launcher_resize(window: WebviewWindow, expanded: bool)` — rejects callers other than `launcher`; sets inner size 480x320 or 480x600 and re-centers (SSH form does not fit 320 px).
  - `#[tauri::command] pub fn mark_internal_relaunch(app: AppHandle)` / `clear_internal_relaunch(app: AppHandle)` — write/clear marker in `app_data_dir`.
  - Window global `window.__VLX_LAUNCHER__: true` (consumed by Task 4).
- Setup rule (replaces `lib.rs:874-877`): `let launch = launcher::should_show_launcher(pending_open_project.is_some(), launcher::consume_relaunch_marker(&data_dir, SystemTime::now()));` read `PendingOpenProject` before it is taken; if `launch` → `open_launcher(app.handle())?`, keep main hidden; else `win.show()` as today. Main still initializes fully (it is created by `tauri.conf.json`; nothing deferred).
- `capabilities/launcher.json`: `"windows": ["launcher"]`, permissions `core:default`, `core:event:allow-listen`, `core:event:allow-unlisten`. Do **not** add `launcher` to `default.json` (it carries updater/process permissions).

- [ ] **Step 1: Write the failing updater tests** (the file already mocks `@tauri-apps/plugin-process`; add `invoke` mock for `../ipc/transport` or `@tauri-apps/api/core` following the file's existing pattern)

```ts
it("marks an internal relaunch before installing so the next start skips the launcher", async () => {
  /* drive a prompt as existing tests do */ await startInstall();
  expect(invoke).toHaveBeenCalledWith("mark_internal_relaunch");
  expect(invokeOrder("mark_internal_relaunch")).toBeLessThan(callOrder(downloadAndInstall));
});
it("clears the relaunch marker when installation fails", async () => {
  downloadAndInstall.mockRejectedValueOnce(new Error("boom"));
  await startInstall();
  expect(invoke).toHaveBeenCalledWith("clear_internal_relaunch");
});
it("marks an internal relaunch before restarting", async () => {
  await restartApp();
  expect(invoke).toHaveBeenCalledWith("mark_internal_relaunch");
  expect(relaunch).toHaveBeenCalled();
});
```

Use `vi.fn().mock.invocationCallOrder` for the ordering assertion. Marking happens before `downloadAndInstall` because on Windows the plugin launches the installer and exits without returning (`updater.ts:176`), and the NSIS installer relaunches the app with no arguments.

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/ipc/updater.test.tsx` → FAIL (no `mark_internal_relaunch` call).

- [ ] **Step 3: Implement** the updater calls (guarded by `env.isTauri`; Electron untouched; marker failures are swallowed with `.catch(() => {})`), then the Rust functions, setup change, command registration and capability file.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/ipc/updater.test.tsx` → PASS.
Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib launcher::` → PASS.
Run: `cargo check --manifest-path src-tauri/Cargo.toml` → no errors.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/launcher.rs src-tauri/src/lib.rs src-tauri/capabilities/launcher.json src/ipc/updater.ts src/ipc/updater.test.tsx
git commit -m "feat(launcher): open a start launcher on plain launches"
```

---

### Task 4: Launcher UI and embedded SSH form

**Files:**
- Create: `src/launcher/LauncherApp.tsx`, `src/launcher/launcher.css`
- Modify: `src/main.tsx:69-75` (render branch)
- Modify: `src/layout/TitleBar/ConnectRemotePanel.tsx:63-76, 299-308, 472-530` (new props)
- Modify: `src/i18n/locales/*.ts` (11 files)
- Test: `src/launcher/LauncherApp.test.tsx`, `src/layout/TitleBar/ConnectRemotePanel.launcher.test.tsx`

**Interfaces:**
- Consumes: `launcher_choose_local`, `launcher_resize`, `ssh_connect` (Task 3 / existing), `window.__VLX_LAUNCHER__`.
- Produces:
  - `export function isLauncherWindow(): boolean` in `src/launcher/LauncherApp.tsx` (`!!(window as any).__VLX_LAUNCHER__`).
  - `export function LauncherApp(): JSX.Element`.
  - `ConnectRemotePanel` new optional props: `variant?: "popover" | "embedded"` (default `"popover"`; `"embedded"` renders the panel body without `Backdrop` and without fixed positioning, Escape does nothing), `sshOnly?: boolean` (forces `mode = "ssh"`, hides the mode tabs). Existing callers unchanged.
  - i18n keys (en values; Task 5 pushes the `hiddenMode.*` ones to Rust):

| Key | English |
| --- | --- |
| `launcher.title` | How do you want to start? |
| `launcher.local` | Local terminal |
| `launcher.ssh` | Connect via SSH |
| `launcher.back` | Back |
| `hiddenMode.hidePrompt` | Hide the local window while you work over SSH? |
| `hiddenMode.hide` | Hide |
| `hiddenMode.keepOpen` | Keep open |
| `hiddenMode.lastClosedPrompt` | No remote windows are open. Return to the local app or quit VelaTerm? |
| `hiddenMode.returnToLocal` | Return to local app |
| `hiddenMode.quit` | Quit VelaTerm |

- `main.tsx`: if `isLauncherWindow()` render `<ErrorBoundary><LauncherApp /></ErrorBoundary>` (no `LoginGate`, no `App`); else today's tree. `LauncherApp` applies `applyTheme(loadTheme())` on mount (`src/theme.ts:208,243`; the launcher shares main's origin and localStorage).
- Launcher states: `"choose"` (heading + two buttons) and `"ssh"` (Back button + `<ConnectRemotePanel variant="embedded" sshOnly onClose={() => {}} />`). Entering `"ssh"` calls `launcher_resize({ expanded: true })`, Back calls it with `false`. On successful connect the panel's `onClose` fires, but the launcher is closed by Rust (Task 5), so the launcher keeps its state and does nothing on `onClose`.

- [ ] **Step 1: Write the failing tests**

```tsx
// LauncherApp.test.tsx — mock ../ipc/transport invoke/listen as ConnectRemotePanel.wsl.test.tsx does
it("shows the two start choices", () => {
  render(<LauncherApp />);
  expect(screen.getByText("How do you want to start?")).toBeTruthy();
  expect(screen.getByRole("button", { name: "Local terminal" })).toBeTruthy();
  expect(screen.getByRole("button", { name: "Connect via SSH" })).toBeTruthy();
});
it("Local terminal asks the backend to reveal main", () => {
  fireEvent.click(screen.getByRole("button", { name: "Local terminal" }));
  expect(invoke).toHaveBeenCalledWith("launcher_choose_local");
});
it("Connect via SSH shows the SSH-only form, Back returns to the choices", async () => {
  fireEvent.click(screen.getByRole("button", { name: "Connect via SSH" }));
  expect(invoke).toHaveBeenCalledWith("launcher_resize", { expanded: true });
  expect(screen.queryByText("URL")).toBeNull();            // no mode tabs
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
  /* enter host "u@h", click Connect */
  expect(await screen.findByText(/connection refused/)).toBeTruthy();
});

// ConnectRemotePanel.launcher.test.tsx
it("sshOnly ignores ?connect=wsl and hides the mode tabs", () => {
  history.replaceState(null, "", "/?connect=wsl");
  render(<ConnectRemotePanel onClose={vi.fn()} sshOnly variant="embedded" />);
  expect(invoke).not.toHaveBeenCalledWith("wsl_options");
  expect(screen.queryByText("SSH")).toBeNull();
});
it("embedded variant ignores Escape", () => {
  const close = vi.fn(); render(<ConnectRemotePanel onClose={close} sshOnly variant="embedded" />);
  fireEvent.keyDown(document.querySelector(".connect-panel")!, { key: "Escape" });
  expect(close).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/launcher src/layout/TitleBar/ConnectRemotePanel.launcher.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement** `LauncherApp`, `launcher.css` (theme variables only: `--bg-0`, `--bg-2`, `--text`, `--accent`, `--border-strong`), the `ConnectRemotePanel` props, the `main.tsx` branch and the i18n keys in all 11 locales. Ensure `wsl_options` is not invoked when `sshOnly`.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/launcher src/layout/TitleBar` → PASS (including the existing `ConnectRemotePanel.wsl.test.tsx`).
Run: `pnpm exec tsc --noEmit` → no errors (catches a locale missing a key).

- [ ] **Step 5: Commit**

```bash
git add src/launcher src/main.tsx src/layout/TitleBar/ConnectRemotePanel.tsx src/layout/TitleBar/ConnectRemotePanel.launcher.test.tsx src/i18n/locales
git commit -m "feat(launcher): add launcher UI with embedded SSH form"
```

---

### Task 5: Enter hidden mode after SSH connect (launcher and main)

**Files:**
- Modify: `src-tauri/src/commands.rs:1042-1172` (`ssh_connect`), `:1203-1208` (`wsl_connect` call site), `:1232-1375` (`open_login_window` return type)
- Modify: `src-tauri/src/launcher.rs`
- Create: `src/launcher/useNativeDialogCopy.ts`
- Modify: `src/App.tsx` (call the hook once, near `<QuitConfirmModal />` at line 282's component)
- Test: `src/launcher/useNativeDialogCopy.test.tsx`

**Interfaces:**
- Consumes: `HiddenModeCopy`, `LAUNCHER_LABEL`, `hide_main`, `main_visible` (Tasks 1-2); i18n keys (Task 4).
- Produces:
  - `fn open_login_window(...) -> Result<String, String>` — returns the new window label.
  - `ssh_connect` gains `window: tauri::WebviewWindow` (injected by Tauri, no frontend change). Window creation still runs via `app.run_on_main_thread`, but the result is sent back over a `tokio::sync::oneshot` channel and awaited, so `ssh_connect` returns `Err` when the window cannot be created (Review Focus 3).
  - `pub(crate) fn on_ssh_window_opened(app: &AppHandle, caller: &str, ssh_label: &str)`:
    - `caller == LAUNCHER_LABEL` → destroy launcher; main stays hidden.
    - `caller == "main" && main_visible(app)` → native dialog (`MessageDialogButtons::OkCancelCustom(copy.hide, copy.keep_open)`, message `copy.hide_prompt`, title `VelaTerm`, `.parent(&ssh_window)`); `true` → `hide_main(app)`. Esc/close = Keep open.
    - otherwise no-op.
  - `#[tauri::command] pub fn set_hidden_mode_copy(state: State<LauncherState>, copy: HiddenModeCopy)`.
  - `export function useNativeDialogCopy(): void` — when `env.isTauri && !env.isElectron`, invokes `set_hidden_mode_copy` with the six `hiddenMode.*` strings on mount and whenever `getLocale()` changes (depend on the `t` returned by `useT()` plus `getLocale()`).

- [ ] **Step 1: Write the failing test**

```tsx
it("pushes the localized hidden-mode copy to the backend", () => {
  setLang("es"); renderHook(() => useNativeDialogCopy());
  expect(invoke).toHaveBeenCalledWith("set_hidden_mode_copy", { copy: expect.objectContaining({
    hidePrompt: t("hiddenMode.hidePrompt"), returnToLocal: t("hiddenMode.returnToLocal"), quit: t("hiddenMode.quit") }) });
});
it("does nothing in remote windows (browser transport)", () => {
  /* env mock isTauri: false */ expect(invoke).not.toHaveBeenCalled();
});
```

- [ ] **Step 2: Run to verify failure**

Run: `pnpm vitest run src/launcher/useNativeDialogCopy.test.tsx` → FAIL (module not found).

- [ ] **Step 3: Implement** the hook and wire it in `App.tsx`; then the Rust changes. In `ssh_connect`, capture `let caller = window.label().to_string();` before the blocking work; inside the `run_on_main_thread` closure call `open_login_window`, and on `Ok(label)` call `launcher::on_ssh_window_opened(&app2, &caller, &label)` before sending `Ok(())` on the channel. Register `set_hidden_mode_copy` in `generate_handler!`. Keep the `diagnostic_warn!` on failure and also return the error string.

- [ ] **Step 4: Verify**

Run: `pnpm vitest run src/launcher` → PASS.
Run: `cargo check --manifest-path src-tauri/Cargo.toml` → no errors.
Manual (dev build): from the launcher, connect to an unreachable-after-provision host or temporarily force `open_login_window` to return `Err` → launcher stays open showing the error (Review Focus 3). Revert the forced error.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/commands.rs src-tauri/src/launcher.rs src-tauri/src/lib.rs src/launcher/useNativeDialogCopy.ts src/launcher/useNativeDialogCopy.test.tsx src/App.tsx
git commit -m "feat(launcher): hide the local window after an SSH connect"
```

---

### Task 6: Hidden-mode lifecycle (last close, focus routing, reveal sites)

**Files:**
- Modify: `src-tauri/src/launcher.rs`
- Modify: `src-tauri/src/lib.rs:594-600` (single-instance callback), `:248-257` (`queue_open_project` returns `bool`), `:1280-1316` (run loop arms)
- Modify: `src-tauri/src/notify_win.rs:159-165` (fallback reveal → `crate::launcher::reveal_main`)
- Test: `src-tauri/src/launcher.rs` tests (pure parts already covered in Task 1; add the one below)

**Interfaces:**
- Consumes: everything from Tasks 1-2.
- Produces:
  - `pub(crate) fn note_focus(app: &AppHandle, label: &str)` — remote labels only; moves label to the end of `focus_order`.
  - `pub(crate) fn recent_remote_labels(app: &AppHandle) -> Vec<String>` — `focus_order` filtered to live windows, with live untracked remote labels prepended (oldest position).
  - `pub(crate) fn focus_preferred(app: &AppHandle)` — applies `pick_focus_target`; `Main` → `reveal_main`.
  - `pub(crate) fn on_window_destroyed(app: &AppHandle, label: &str)` — drops label from `focus_order`; if `is_remote_label(label)` and `should_offer_return(remote_count_excluding(live_labels, label), main_visible(app), exiting)` where `exiting = LauncherState.exiting || QuitState.confirmed`, show native dialog `OkCancelCustom(copy.quit, copy.return_to_local)` with message `copy.last_closed_prompt`, title `VelaTerm`, no parent. `true` → `quit_without_prompt`; `false` (button, Esc, dialog closed) → `reveal_main`.
  - `pub(crate) fn forget_focus(order: &mut Vec<String>, label: &str)` and `pub(crate) fn push_focus(order: &mut Vec<String>, label: &str)` — pure helpers for the order list.
- Run loop additions (before the existing `match`, so the Windows `Focused(true)` arm still runs): `WindowEvent { label, event: Focused(true) }` → `note_focus`; `WindowEvent { label, event: Destroyed }` → `on_window_destroyed`; `#[cfg(target_os = "macos")] RunEvent::Reopen { .. }` → `focus_preferred`.
- Single-instance (release only): `let has_project = queue_open_project(app, &args, &cwd); if has_project { launcher::reveal_main(app) } else { launcher::focus_preferred(app) }`.
- Spec "app-level input targeting main": the only Rust site that raises `"main"` as a fallback is `notify_win.rs:161`; route it through `reveal_main`. `notify_native.rs` raises the source window by label (an SSH window stays an SSH window). macOS menu actions go to the focused window (`native_menu::dispatch`), so they never target hidden main; no change. `open-project://request` from a second instance is covered by `has_project`.

- [ ] **Step 1: Write the failing test**

```rust
#[test] fn focus_order_moves_refocused_window_to_newest_and_forgets_destroyed() {
    let mut o = Vec::new();
    push_focus(&mut o, "ssh-a"); push_focus(&mut o, "ssh-b"); push_focus(&mut o, "ssh-a");
    assert_eq!(o, ["ssh-b", "ssh-a"]);
    forget_focus(&mut o, "ssh-a");
    assert_eq!(o, ["ssh-b"]);
    push_focus(&mut o, "main");            // non-remote labels are ignored
    assert_eq!(o, ["ssh-b"]);
}
```

- [ ] **Step 2: Run to verify failure**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib launcher::` → FAIL (`push_focus` not defined).

- [ ] **Step 3: Implement** the helpers, window functions, run-loop arms, single-instance change and `notify_win.rs` reroute.

- [ ] **Step 4: Verify**

Run: `cargo test --manifest-path src-tauri/Cargo.toml --lib launcher::` → PASS (7 tests).
Run: `cargo check --manifest-path src-tauri/Cargo.toml` and `cargo clippy --manifest-path src-tauri/Cargo.toml -- -D warnings` (if the repo's CI uses clippy) → clean.

- [ ] **Step 5: Commit**

```bash
git add src-tauri/src/launcher.rs src-tauri/src/lib.rs src-tauri/src/notify_win.rs
git commit -m "feat(launcher): offer return or quit when the last remote window closes"
```

---

### Task 7: Full verification and manual checklist

**Files:** none changed unless a check fails.

- [ ] **Step 1:** `pnpm vitest run` → all PASS. `pnpm exec tsc --noEmit` → clean. `cargo test --manifest-path src-tauri/Cargo.toml --lib` → all PASS.
- [ ] **Step 2:** Build a **release** binary on each OS (single-instance is release-only, `lib.rs:590-599`) and run the checklist below. Record results in the PR description.

#### Manual test checklist (Windows and macOS)

Launch and launcher
- [ ] L1 Plain launch: launcher appears centered (~480x320), non-resizable, titled `VelaTerm`, in the current light/dark theme; main window is not visible anywhere (taskbar / Alt+Tab on Windows; Window list on macOS).
- [ ] L2 Local terminal: main appears with the restored workspace and running shells; launcher is gone.
- [ ] L3 Connect via SSH → form fits after resize; Back returns to the two choices and shrinks the window.
- [ ] L4 SSH success from launcher: SSH window opens and focuses, launcher closes, main stays hidden; Windows: only the SSH window in taskbar and Alt+Tab; macOS: Dock icon present, Cmd+Tab shows VelaTerm, only the SSH window in Mission Control.
- [ ] L5 Close launcher with X (idle and while a connect is in progress): app exits; no leftover process (Task Manager / Activity Monitor), no orphan SSH window.
- [ ] L6 SSH failure from launcher (wrong host, auth refused): launcher stays open with the error; password prompt still works.

Hidden mode
- [ ] H1 From visible main, connect via SSH: "Hide the local window while you work over SSH?" appears over the SSH window. Hide → main disappears from taskbar / Alt+Tab. Keep open (and Esc) → main stays.
- [ ] H2 Second launch (`VelaTerm.exe` again / `open -a VelaTerm`) while hidden: newest-focused SSH window comes forward; no launcher, main stays hidden.
- [ ] H3 macOS: click the Dock icon while hidden → SSH window focuses; with no remote windows and main hidden → main shows.
- [ ] H4 Windows notification click for a main session while hidden (fallback path) → main is revealed.

Closing the last SSH window
- [ ] C1 Two SSH windows, hidden main: close one → stop/keep prompt only; no return prompt.
- [ ] C2 Close the last one → stop/keep prompt first (unchanged), then "Return to local app / Quit VelaTerm".
- [ ] C3 Return → main shows and focuses. Esc / closing the dialog → same as Return.
- [ ] C4 Quit → app exits without the quit dialog; with "save workspace on quit" on, the next launch (choose Local) restores the workspace; with it off, it does not.
- [ ] C5 Cancel in the stop/keep prompt → window stays, no return prompt.
- [ ] C6 Main visible: closing the last SSH window shows no return prompt.
- [ ] C7 SSH window attached to a remote desktop app (mirror link, no stop/keep prompt): closing it still triggers the return prompt when main is hidden.

Quit paths while hidden
- [ ] Q1 macOS Cmd+Q / Dock → Quit with main hidden: main shows, then the normal quit dialog (save workspace checkbox, translated copy).
- [ ] Q2 Windows: sign out / shutdown with main hidden: main is revealed and the quit flow runs; or the OS-forced exit completes without a hang.
- [ ] Q3 Confirming any quit with SSH windows open never shows the return prompt while windows are being torn down.
- [ ] Q4 Cmd+Q while only the launcher is open → app exits directly.

Skip-launcher cases
- [ ] S1 `vela <project-path>` / `--open-project <path>` cold start → main shows with the project; no launcher.
- [ ] S2 Second instance with a project path while hidden → main revealed with the project.
- [ ] S3 Update install + relaunch (macOS "Restart", Windows passive installer relaunch) → main shows directly; the following plain launch shows the launcher again.
- [ ] S4 Failed update install → next plain launch still shows the launcher.

Locale
- [ ] I1 Switch language to Spanish, then trigger H1 and C2: native prompts use the Spanish strings; the launcher uses the Spanish strings on next launch.

---

## Self-Review Notes

- Spec coverage: Launch (Tasks 3-4), connect from normal app (Task 5), hidden mode + single instance + Dock (Task 6), last-SSH close (Task 6), quitting while hidden (Task 2), skip launcher (Task 3), app-level input (Task 6), UI copy (Task 4), unit tests for pure logic + manual checklist (Tasks 1, 6, 7).
- Clarification beyond the spec: a quit request while only the launcher is open is treated like closing the launcher (direct exit), since there is no session to confirm. "Settings-triggered relaunch" does not exist in the codebase today; the only internal restarts are the updater paths, which the marker covers.
