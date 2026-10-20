//! Built-in browser tabs.
//!
//! React renders the toolbar, while `Window::add_child` mounts a native child WebView in the main window.
//! Frontend placeholder bounds position it, tab switching shows/hides it, and tab closure destroys it.
//!
//! Security model—do not weaken:
//! - External pages cannot call Tauri commands. A window-scoped capability extends to every webview in the
//!   window, so `windows:["main"]` does cover `browser-*` children; it grants nothing to them only because it
//!   has no `remote` origins and their pages are never local. Remote-connection windows do allow 127.0.0.1
//!   origins, so they grant their runtime capability by webview label instead and children never match.
//! - No script is injected into third-party pages. Popups (`window.open` / `target=_blank`) are denied at the
//!   native layer and forwarded to the host window as an app-level new-tab request instead.
//! - Allow only HTTP, HTTPS, and about:blank through both normalization and `on_navigation`.
//! - Commands accept tabId only; BrowserManager owns labels and never trusts frontend labels.
//!
//! Host windows: the child view mounts in the window that invoked the command, so the main window and
//! remote-connection windows (SSH, WSL, paired URL) each host their own pages. Pages always load on this
//! desktop, never on the remote server, so `localhost` means this machine even in an SSH window. Tabs are keyed
//! per window because two windows connected to the same server see the same browser session IDs.
//!
//! Coordinate conversion, verified on macOS and Linux: macOS add_child uses the frame origin above the
//! native title bar, while CSS begins in the content area and tao reports frame size for both outer/inner.
//! Derive title-bar height as logical window height minus reported CSS viewport height. Fullscreen naturally
//! yields zero. Linux/Windows already use the client-area origin and must return zero; applying the macOS
//! formula there would mistake WebKit/tao scale-factor differences for an offset. See `y_offset()`.

use std::collections::HashMap;
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, LogicalPosition, LogicalSize, Manager, State};

#[cfg(target_os = "macos")]
mod macos;

/// Full Safari UA. WKWebView's default omits the Version/Safari suffix Google uses to detect and reject
/// embedded WebViews; this UA has been verified with Google login.
const SAFARI_UA: &str = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/26.0 Safari/605.1.15";

/// Shared browser-only persistent data-store identifier. It isolates browser data from main UI settings,
/// shares site login state across tabs, and lets the system persist cookies/localStorage/IndexedDB without
/// application access to plaintext credentials. Requires macOS 14+.
const VLX_BROWSER_STORE: [u8; 16] = *b"vlx-browser-v1\0\0";

/// Managed (host window label, tabId)-to-child-label state. Commands resolve through tabId within the calling
/// window and quietly return when a tab has already closed, preserving idempotence.
pub struct BrowserManager(Mutex<HashMap<(String, String), String>>);

impl BrowserManager {
    pub fn new() -> Self {
        Self(Mutex::new(HashMap::new()))
    }

    fn label_of(&self, host: &str, tab_id: &str) -> Option<String> {
        self.0.lock().ok()?.get(&(host.to_string(), tab_id.to_string())).cloned()
    }

    fn insert(&self, host: &str, tab_id: String, label: String) {
        if let Ok(mut map) = self.0.lock() {
            map.insert((host.to_string(), tab_id), label);
        }
    }

    fn remove(&self, host: &str, tab_id: &str) -> Option<String> {
        self.0.lock().ok()?.remove(&(host.to_string(), tab_id.to_string()))
    }

    /// Drop every tab hosted by a window and return their child labels.
    fn remove_host(&self, host: &str) -> Vec<String> {
        let Ok(mut map) = self.0.lock() else { return Vec::new() };
        let keys: Vec<_> = map.keys().filter(|(h, _)| h == host).cloned().collect();
        keys.into_iter().filter_map(|key| map.remove(&key)).collect()
    }
}

/// Forget the tabs of a destroyed window, whose child webviews died with it, so a later window cannot resolve
/// a stale label and silently skip mounting its page.
pub fn forget_host(app: &AppHandle, host: &str) {
    let labels = app.state::<BrowserManager>().remove_host(host);
    #[cfg(target_os = "windows")]
    for label in &labels {
        crate::focus_win::forget(label);
    }
    #[cfg(not(target_os = "windows"))]
    let _ = labels;
}

/// `browser://state/{tabId}` payload. Every field is optional so the document-title handler can reuse the
/// channel for title-only updates; the frontend merges each payload as a patch.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserState {
    #[serde(skip_serializing_if = "Option::is_none")]
    url: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    loading: Option<bool>,
}

/// `browser://popup/{tabId}` payload: a new-window request from the page, opened as an app browser tab.
#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct BrowserPopup {
    url: String,
}

/// Emit only to the host window; page state must never broadcast to other windows or remote clients.
fn emit_state(app: &AppHandle, host: &str, tab_id: &str, url: &url::Url, loading: bool) {
    let _ = app.emit_to(
        host,
        &format!("browser://state/{tab_id}"),
        BrowserState {
            url: Some(url.to_string()),
            title: None,
            loading: Some(loading),
        },
    );
}

/// Forward the real document title, which native page-title observers deliver after load. The tab strip
/// shows it instead of the URL host; Electron emits its equivalent through `page-title-updated`.
fn emit_title(app: &AppHandle, host: &str, tab_id: &str, title: &str) {
    let _ = app.emit_to(
        host,
        &format!("browser://state/{tab_id}"),
        BrowserState {
            url: None,
            title: Some(title.to_string()),
            loading: None,
        },
    );
}

/// Allow HTTP, HTTPS, and about only; reject file and other schemes to avoid exposing local files.
fn scheme_allowed(url: &url::Url) -> bool {
    matches!(url.scheme(), "http" | "https" | "about")
}

/// Normalize address input: validate explicit schemes, prepend HTTPS to domain-like or localhost values
/// without whitespace, and otherwise build a Google search URL.
fn normalize_url(input: &str) -> Result<url::Url, String> {
    let input = input.trim();
    if input.is_empty() {
        return Err("Empty address".into());
    }
    if input.eq_ignore_ascii_case("about:blank") {
        return Ok(url::Url::parse("about:blank").expect("constant URL"));
    }
    // Parse an explicit `xxx://` scheme and apply the allowlist.
    if let Some(pos) = input.find("://") {
        let scheme = &input[..pos];
        if scheme
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '+' | '-' | '.'))
        {
            let url = url::Url::parse(input).map_err(|e| format!("Invalid URL: {e}"))?;
            if !scheme_allowed(&url) {
                return Err(format!("Scheme not allowed: {}", url.scheme()));
            }
            return Ok(url);
        }
    }
    // Domain-like input contains a dot or localhost and no whitespace; prepend HTTPS.
    let no_space = !input.chars().any(char::is_whitespace);
    let host_part = input.split(['/', ':']).next().unwrap_or("");
    let domain_like = no_space && (host_part.contains('.') || host_part == "localhost");
    if domain_like {
        let url = url::Url::parse(&format!("https://{input}"))
            .map_err(|e| format!("Invalid URL: {e}"))?;
        if !scheme_allowed(&url) {
            return Err(format!("Scheme not allowed: {}", url.scheme()));
        }
        return Ok(url);
    }
    // Search terms.
    url::Url::parse_with_params("https://www.google.com/search", &[("q", input)])
        .map_err(|e| format!("Failed to build search URL: {e}"))
}

/// Y offset for add_child/set_position, nonzero only on macOS.
///
/// macOS shifts from frame origin to CSS content origin using logical height minus CSS viewport height.
/// Linux/Windows client origins already match CSS and return zero, avoiding cross-runtime scale mismatches.
#[cfg_attr(not(target_os = "macos"), allow(unused_variables))]
fn y_offset(window: &tauri::Window, css_viewport_h: f64) -> f64 {
    #[cfg(target_os = "macos")]
    {
        let (Ok(inner), Ok(scale)) = (window.inner_size(), window.scale_factor()) else {
            return 0.0;
        };
        (inner.height as f64 / scale - css_viewport_h).max(0.0)
    }
    #[cfg(not(target_os = "macos"))]
    {
        0.0
    }
}

/// Resolve a child WebView by tabId within its host window.
fn webview_of(
    app: &AppHandle,
    state: &State<'_, BrowserManager>,
    host: &tauri::Window,
    tab_id: &str,
) -> Option<tauri::Webview> {
    app.get_webview(&state.label_of(host.label(), tab_id)?)
}

/// Create and mount a child WebView in the calling window from frontend placeholder bounds and CSS viewport
/// height. Repeated calls for the same tabId update bounds idempotently.
///
/// Must remain async. On Windows add_child posts build to the main thread and blocks the caller on recv; a
/// synchronous main-thread command would deadlock waiting for itself. Async moves the wait to a worker so
/// the main loop can build. Other operations only post messages and may remain synchronous.
#[tauri::command]
pub async fn browser_open(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
    url: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    css_viewport_h: f64,
) -> Result<(), String> {
    let host = window.label().to_string();
    if state.label_of(&host, &tab_id).is_some() {
        return browser_set_bounds(app.clone(), window, state, tab_id, x, y, w, h, css_viewport_h);
    }
    let parsed = normalize_url(&url)?;
    let label = format!("browser-{}", &uuid::Uuid::new_v4().to_string()[..8]);

    let (nav_app, nav_host, nav_tab) = (app.clone(), host.clone(), tab_id.clone());
    let (load_app, load_host, load_tab) = (app.clone(), host.clone(), tab_id.clone());
    let (popup_app, popup_host, popup_tab) = (app.clone(), host.clone(), tab_id.clone());
    let (title_app, title_host, title_tab) = (app.clone(), host.clone(), tab_id.clone());
    let builder = tauri::webview::WebviewBuilder::new(&label, tauri::WebviewUrl::External(parsed))
        .user_agent(SAFARI_UA)
        .data_store_identifier(VLX_BROWSER_STORE)
        // Enforce the scheme allowlist for in-page navigation and report URL changes.
        .on_navigation(move |url| {
            if !scheme_allowed(url) {
                return false;
            }
            emit_state(&nav_app, &nav_host, &nav_tab, url, true);
            true
        })
        .on_page_load(move |_, payload| {
            let loading = matches!(payload.event(), tauri::webview::PageLoadEvent::Started);
            emit_state(&load_app, &load_host, &load_tab, payload.url(), loading);
        })
        // Deny native popups and let the frontend open them as app browser tabs instead.
        .on_new_window(move |url, _features| {
            if scheme_allowed(&url) {
                let _ = popup_app.emit_to(
                    popup_host.as_str(),
                    &format!("browser://popup/{popup_tab}"),
                    BrowserPopup {
                        url: url.to_string(),
                    },
                );
            }
            tauri::webview::NewWindowResponse::Deny
        })
        .on_document_title_changed(move |_webview, title| {
            emit_title(&title_app, &title_host, &title_tab, &title)
        })
        // Disable wry native drag/drop interception so macOS pages receive HTML5 file drops.
        .disable_drag_drop_handler();

    let offset = y_offset(&window, css_viewport_h);
    #[cfg(target_os = "macos")]
    if let Some(host_view) = app.get_webview(&host) {
        host_view.with_webview(|platform| unsafe {
            macos::isolate_host_mouse_tracking(platform.inner().cast());
        })
        .map_err(|e| format!("Failed to configure browser mouse tracking: {e}"))?;
    }
    let _webview = window
        .add_child(
            builder,
            LogicalPosition::new(x, y + offset),
            LogicalSize::new(w, h),
        )
        .map_err(|e| format!("Failed to create browser webview: {e}"))?;
    #[cfg(target_os = "windows")]
    crate::focus_win::track(&_webview);

    state.insert(&host, tab_id, label);
    Ok(())
}

/// Reports a browser command that runs long.
///
/// Each of these drives a native child WebView from the UI thread, so the cost is set by the platform
/// WebView rather than by this code: WKWebView, WebKitGTK and WebView2 charge very differently for the same
/// call, and only WebView2 crosses a process boundary to do it.
fn slow(command: &'static str) -> crate::diagnostics::Slow {
    crate::diagnostics::Slow::new(
        "ui_thread_slow",
        crate::commands::UI_THREAD_REPORT_THRESHOLD,
        serde_json::json!({ "command": command }),
    )
}

/// Address-bar navigation after HTTPS/search normalization and invalid-scheme rejection.
#[tauri::command]
pub fn browser_navigate(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
    input: String,
) -> Result<(), String> {
    let _slow = slow("browser_navigate");
    let url = normalize_url(&input)?;
    let Some(wv) = webview_of(&app, &state, &window, &tab_id) else {
        return Ok(());
    };
    wv.navigate(url)
        .map_err(|e| format!("Navigation failed: {e}"))
}

/// Navigate back through evaluated history API because Tauri exposes no goBack; no-op without history.
#[tauri::command]
pub fn browser_back(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
) {
    if let Some(wv) = webview_of(&app, &state, &window, &tab_id) {
        let _ = wv.eval("history.back()");
    }
}

/// Navigate forward.
#[tauri::command]
pub fn browser_forward(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
) {
    if let Some(wv) = webview_of(&app, &state, &window, &tab_id) {
        let _ = wv.eval("history.forward()");
    }
}

/// Reload through Webview::reload, available in 2.11.
#[tauri::command]
pub fn browser_reload(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
) {
    let _slow = slow("browser_reload");
    if let Some(wv) = webview_of(&app, &state, &window, &tab_id) {
        let _ = wv.reload();
    }
}

/// Stop loading.
#[tauri::command]
pub fn browser_stop(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
) {
    if let Some(wv) = webview_of(&app, &state, &window, &tab_id) {
        let _ = wv.eval("window.stop()");
    }
}

/// Synchronize bounds after placeholder ResizeObserver or window changes.
#[tauri::command]
pub fn browser_set_bounds(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
    x: f64,
    y: f64,
    w: f64,
    h: f64,
    css_viewport_h: f64,
) -> Result<(), String> {
    let _slow = slow("browser_set_bounds");
    let Some(wv) = webview_of(&app, &state, &window, &tab_id) else {
        return Ok(());
    };
    let offset = y_offset(&window, css_viewport_h);
    wv.set_position(LogicalPosition::new(x, y + offset))
        .map_err(|e| format!("Failed to move browser webview: {e}"))?;
    wv.set_size(LogicalSize::new(w, h))
        .map_err(|e| format!("Failed to resize browser webview: {e}"))?;
    Ok(())
}

/// Show or hide on tab changes while keeping hidden page processes and media alive.
#[tauri::command]
pub fn browser_set_visible(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
    visible: bool,
) {
    let _slow = slow("browser_set_visible");
    if let Some(wv) = webview_of(&app, &state, &window, &tab_id) {
        #[cfg(target_os = "windows")]
        if !visible {
            crate::focus_win::forget(wv.label());
        }
        let _ = if visible { wv.show() } else { wv.hide() };
    }
}

/// Close and destroy a child WebView when its tab closes.
#[tauri::command]
pub fn browser_close(
    app: AppHandle,
    window: tauri::Window,
    state: State<'_, BrowserManager>,
    tab_id: String,
) {
    let _slow = slow("browser_close");
    if let Some(label) = state.remove(window.label(), &tab_id) {
        #[cfg(target_os = "windows")]
        crate::focus_win::forget(&label);
        if let Some(wv) = app.get_webview(&label) {
            // Hide before close so occasional macOS delayed child-view removal cannot leave a white remnant.
            let _ = wv.hide();
            let _ = wv.close();
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{normalize_url, BrowserManager};

    #[test]
    fn forgetting_a_host_drops_only_its_tabs() {
        let manager = BrowserManager::new();
        manager.insert("main", "tab".into(), "browser-a".into());
        manager.insert("ssh-1", "tab".into(), "browser-b".into());
        manager.insert("ssh-1", "other".into(), "browser-c".into());
        let mut gone = manager.remove_host("ssh-1");
        gone.sort();
        assert_eq!(gone, ["browser-b", "browser-c"]);
        assert_eq!(manager.label_of("ssh-1", "tab"), None);
        assert_eq!(manager.label_of("main", "tab").as_deref(), Some("browser-a"));
    }

    #[test]
    fn tabs_are_scoped_to_their_host_window() {
        let manager = BrowserManager::new();
        manager.insert("main", "tab".into(), "browser-a".into());
        manager.insert("ssh-remote-1", "tab".into(), "browser-b".into());
        assert_eq!(manager.label_of("main", "tab").as_deref(), Some("browser-a"));
        assert_eq!(manager.label_of("ssh-remote-1", "tab").as_deref(), Some("browser-b"));
        assert_eq!(manager.label_of("ssh-remote-2", "tab"), None);
        assert_eq!(manager.remove("ssh-remote-1", "tab").as_deref(), Some("browser-b"));
        assert_eq!(manager.label_of("main", "tab").as_deref(), Some("browser-a"));
    }

    #[test]
    fn full_http_https_urls_pass_through() {
        assert_eq!(
            normalize_url("https://github.com/a/b?x=1")
                .unwrap()
                .as_str(),
            "https://github.com/a/b?x=1"
        );
        assert_eq!(
            normalize_url("http://example.com").unwrap().as_str(),
            "http://example.com/"
        );
    }

    #[test]
    fn domain_like_gets_https_prefix() {
        assert_eq!(
            normalize_url("github.com").unwrap().as_str(),
            "https://github.com/"
        );
        assert_eq!(
            normalize_url("news.ycombinator.com/item?id=1")
                .unwrap()
                .as_str(),
            "https://news.ycombinator.com/item?id=1"
        );
        assert_eq!(
            normalize_url("example.com:8080/path").unwrap().as_str(),
            "https://example.com:8080/path"
        );
        assert_eq!(
            normalize_url("localhost:1420").unwrap().as_str(),
            "https://localhost:1420/"
        );
    }

    #[test]
    fn search_terms_go_to_google() {
        let url = normalize_url("rust tauri webview").unwrap();
        assert_eq!(url.host_str(), Some("www.google.com"));
        assert_eq!(url.path(), "/search");
        assert!(url.query().unwrap().contains("rust"));
        // Input containing a dot and whitespace remains a search term.
        let url = normalize_url("what is tauri 2.0").unwrap();
        assert_eq!(url.host_str(), Some("www.google.com"));
    }

    #[test]
    fn disallowed_schemes_rejected() {
        assert!(normalize_url("file:///etc/hosts").is_err());
        assert!(normalize_url("ftp://example.com").is_err());
        // javascript:/data: without `://` becomes a harmless search or parse failure, never its original scheme.
        let url = normalize_url("javascript:alert(1)").unwrap();
        assert_eq!(url.host_str(), Some("www.google.com"));
    }

    #[test]
    fn about_blank_allowed() {
        assert_eq!(
            normalize_url("about:blank").unwrap().as_str(),
            "about:blank"
        );
        assert_eq!(
            normalize_url("ABOUT:BLANK").unwrap().as_str(),
            "about:blank"
        );
    }

    #[test]
    fn empty_and_whitespace_rejected() {
        assert!(normalize_url("").is_err());
        assert!(normalize_url("   ").is_err());
    }
}
