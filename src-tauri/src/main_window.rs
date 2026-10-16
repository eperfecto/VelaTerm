//! Local main-window lifecycle while remote windows are open.
//!
//! Someone working entirely remotely has no use for the local main window, yet closing it used to quit the
//! whole application and take every remote window with it. While a remote window is open, closing `main`
//! therefore only hides it: the webview and all local sessions stay alive in the background. Bringing it
//! back (Dock click, quit prompt, last remote window closing) lives in `launcher`.

use tauri::{AppHandle, Manager, Runtime};

/// Label of the local main window, defined in tauri.conf.json.
pub const MAIN_LABEL: &str = "main";
/// Label prefix of a paired-URL remote window (`open_remote_window`).
pub const URL_REMOTE_PREFIX: &str = "remote-";
/// Label prefix of an account-linked remote window (`open_account_remote_window`).
pub const ACCOUNT_REMOTE_PREFIX: &str = "account-remote-";
/// Label prefix of an SSH remote window (`open_login_window`).
pub const SSH_REMOTE_PREFIX: &str = "ssh-";
/// Label prefix of a WSL workspace window (`open_login_window`).
pub const WSL_REMOTE_PREFIX: &str = "wsl-";

/// The single classification of a window label as a remote window. Window creation builds its labels from
/// the prefixes above, so the two cannot drift apart.
pub fn is_remote_window_label(label: &str) -> bool {
    [URL_REMOTE_PREFIX, ACCOUNT_REMOTE_PREFIX, SSH_REMOTE_PREFIX, WSL_REMOTE_PREFIX]
        .iter()
        .any(|prefix| label.starts_with(prefix))
}

/// Whether `labels` contain a remote window other than `except`. `except` optionally excludes one label from
/// the check; the current caller passes `None` because it queries live windows.
pub fn remote_window_among<'a>(
    labels: impl IntoIterator<Item = &'a str>,
    except: Option<&str>,
) -> bool {
    labels
        .into_iter()
        .any(|label| is_remote_window_label(label) && Some(label) != except)
}

fn open_labels<R: Runtime>(app: &AppHandle<R>) -> Vec<String> {
    app.webview_windows().into_keys().collect()
}

/// Handle a close request on the main window: while a remote window is open, hide `main` instead of
/// quitting and return true. False means the caller keeps the regular quit confirmation, including the
/// case where hiding fails, so the window never becomes unclosable.
pub fn hide_main_for_remote<R: Runtime>(app: &AppHandle<R>) -> bool {
    let labels = open_labels(app);
    if !remote_window_among(labels.iter().map(String::as_str), None) {
        return false;
    }
    app.get_webview_window(MAIN_LABEL)
        .is_some_and(|win| win.hide().is_ok())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifies_exactly_the_remote_window_labels() {
        for label in [
            "remote-1a2b3c4d",
            "account-remote-0123456789abcdef0123456789abcdef",
            "ssh-1a2b3c4d",
            "wsl-1a2b3c4d",
        ] {
            assert!(is_remote_window_label(label), "{label} is a remote window");
        }
        for label in [
            "main",
            "",
            "remote",
            "ssh",
            "wsl",
            "download-remote-test",
            "Remote-1a2b",
        ] {
            assert!(
                !is_remote_window_label(label),
                "{label} is not a remote window"
            );
        }
    }

    #[test]
    fn closing_main_hides_only_while_a_remote_window_is_open() {
        // Only main (or main plus non-remote windows): keep the quit confirmation.
        assert!(!remote_window_among(["main"], None));
        assert!(!remote_window_among(["main", "download-remote-test"], None));
        assert!(!remote_window_among([], None));
        // Any kind of remote window keeps the application running with main hidden.
        assert!(remote_window_among(["main", "remote-1a2b3c4d"], None));
        assert!(remote_window_among(["main", "ssh-1a2b3c4d"], None));
        assert!(remote_window_among(["account-remote-0123", "main"], None));
    }
}

// Tauri's mock runtime needs the `native-menu-tests` feature:
// cargo test --manifest-path src-tauri/Cargo.toml --features native-menu-tests main_window
// Its windows report `is_visible() == true` unconditionally, so these tests cover the decisions against real
// registered windows; the hide/show effect itself is not observable there. `destroy()` does not unregister a
// window in the mock either, so launcher tests assert the closure the helpers report.
#[cfg(all(test, feature = "native-menu-tests"))]
mod behavior_tests {
    use super::*;
    use tauri::WebviewWindowBuilder;

    fn window<R: Runtime>(app: &AppHandle<R>, label: &str) -> tauri::WebviewWindow<R> {
        WebviewWindowBuilder::new(app, label, Default::default())
            .build()
            .unwrap()
    }

    #[test]
    fn close_decision_follows_the_registered_windows() {
        let app = tauri::test::mock_app();
        let _main = window(app.handle(), MAIN_LABEL);
        let _other = window(app.handle(), "download-remote-test");
        assert!(!hide_main_for_remote(app.handle()));

        let _ssh = window(app.handle(), "ssh-1a2b3c4d");
        assert!(hide_main_for_remote(app.handle()));
    }

    fn launcher_app() -> tauri::App<tauri::test::MockRuntime> {
        let app = tauri::test::mock_app();
        app.manage(crate::launcher::LauncherState::default());
        app.manage(crate::QuitState::default());
        app
    }

    #[test]
    fn main_returns_only_after_the_last_remote_window_closes() {
        let app = launcher_app();
        let h = app.handle();
        let _main = window(h, MAIN_LABEL);
        let ssh = window(h, "ssh-1a2b3c4d");
        // Tauri may still list the destroyed window; the decision excludes it explicitly.
        assert!(crate::launcher::offers_return(h, ssh.label(), false));
        // A visible main window needs no prompt.
        assert!(!crate::launcher::offers_return(h, ssh.label(), true));
        // A non-remote window never offers the prompt.
        let _dl = window(h, "download-remote-test");
        assert!(!crate::launcher::offers_return(h, "download-remote-test", false));
        assert!(!crate::launcher::offers_return(h, MAIN_LABEL, false));
        // Another remote window is still open.
        let _other = window(h, "account-remote-3");
        assert!(!crate::launcher::offers_return(h, ssh.label(), false));
    }

    #[test]
    fn no_return_prompt_while_the_app_is_exiting() {
        use std::sync::atomic::Ordering;
        let app = launcher_app();
        let h = app.handle();
        let _main = window(h, MAIN_LABEL);
        let ssh = window(h, "ssh-1a2b3c4d");
        h.state::<crate::QuitState>().confirmed.store(true, Ordering::SeqCst);
        assert!(!crate::launcher::offers_return(h, ssh.label(), false));

        let app = launcher_app();
        let h = app.handle();
        let ssh = window(h, "ssh-1a2b3c4d");
        crate::launcher::mark_exiting(h);
        assert!(!crate::launcher::offers_return(h, ssh.label(), false));
    }

    #[test]
    fn no_return_prompt_while_the_launcher_is_open() {
        // A connect from the launcher whose window failed to open destroys the half-built window; the
        // launcher is still there for the user, so there is nothing to return to.
        let app = launcher_app();
        let h = app.handle();
        let _main = window(h, MAIN_LABEL);
        let _launcher = window(h, crate::launcher::LAUNCHER_LABEL);
        let ssh = window(h, "ssh-1a2b3c4d");
        assert!(!crate::launcher::offers_return(h, ssh.label(), false));
    }

    #[test]
    fn missing_main_window_counts_as_visible() {
        let app = launcher_app();
        assert!(crate::launcher::main_visible(app.handle()));
        let _main = window(app.handle(), MAIN_LABEL);
        assert!(crate::launcher::main_visible(app.handle()));
    }

    #[test]
    fn choosing_local_raises_main_and_closes_the_launcher() {
        let app = launcher_app();
        let h = app.handle();
        let _main = window(h, MAIN_LABEL);
        let _launcher = window(h, crate::launcher::LAUNCHER_LABEL);
        assert!(crate::launcher::leave_launcher_for_main(h));
        assert!(crate::launcher::main_visible(h));
    }

    #[test]
    fn choosing_local_keeps_the_launcher_when_main_cannot_be_shown() {
        let app = launcher_app();
        let h = app.handle();
        let _launcher = window(h, crate::launcher::LAUNCHER_LABEL);
        assert!(!crate::launcher::leave_launcher_for_main(h));
        assert!(h.get_webview_window(crate::launcher::LAUNCHER_LABEL).is_some());
    }

    #[test]
    fn ssh_window_opened_from_the_launcher_closes_it() {
        let app = launcher_app();
        let h = app.handle();
        let _main = window(h, MAIN_LABEL);
        let _launcher = window(h, crate::launcher::LAUNCHER_LABEL);
        let ssh = window(h, "ssh-1a2b3c4d");
        assert!(crate::launcher::on_ssh_window_opened(h, crate::launcher::LAUNCHER_LABEL, ssh.label()));
    }

    #[test]
    fn ssh_window_opened_from_another_remote_window_closes_nothing() {
        let app = launcher_app();
        let h = app.handle();
        let _launcher = window(h, crate::launcher::LAUNCHER_LABEL);
        let ssh = window(h, "ssh-1a2b3c4d");
        assert!(!crate::launcher::on_ssh_window_opened(h, "remote-1a2b3c4d", ssh.label()));
    }

    #[test]
    fn close_decision_without_a_main_window_falls_back_to_quit() {
        let app = tauri::test::mock_app();
        let _url = window(app.handle(), "remote-1a2b3c4d");
        // Nothing to hide: the caller must keep the quit confirmation.
        assert!(!hide_main_for_remote(app.handle()));
    }
}
