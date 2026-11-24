//! Update check run through the updater plugin's Rust builder.
//!
//! Upstream points this check at the selected server region's update service (velaterm.com / velaterm.cn).
//! This fork publishes its own signed builds, so the check keeps the endpoint from tauri.conf.json (the fork's
//! GitHub `latest.json`) and the download URL exactly as that manifest lists it; the server region setting does
//! not apply to fork updates. The result is registered in the webview's resource table exactly as the plugin
//! does, and the frontend wraps it in the plugin's `Update` class, so download, signature verification, install
//! and the Windows path in `updater_win.rs` all run unchanged.

use serde::Serialize;
use tauri::{Manager, ResourceId, Webview};
use tauri_plugin_updater::UpdaterExt;

/// The plugin's check result, in the shape its JS `Update` constructor expects.
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadata {
    rid: ResourceId,
    current_version: String,
    version: String,
    date: Option<String>,
    body: Option<String>,
    raw_json: serde_json::Value,
}

/// Check for a newer release on the fork's update endpoint (tauri.conf.json). Async: it is a network request.
#[tauri::command]
pub async fn updater_check(
    webview: Webview,
    headers: Option<Vec<(String, String)>>,
) -> Result<Option<UpdateMetadata>, String> {
    let mut builder = webview.updater_builder();
    for (key, value) in headers.unwrap_or_default() {
        builder = builder.header(key, value).map_err(|e| format!("Update check failed: {e}"))?;
    }
    let updater = builder.build().map_err(|e| format!("Update check failed: {e}"))?;
    let Some(update) = updater.check().await.map_err(|e| format!("Update check failed: {e}"))? else {
        return Ok(None);
    };

    let date = update
        .date
        .and_then(|d| d.format(&time::format_description::well_known::Rfc3339).ok());
    let metadata = UpdateMetadata {
        current_version: update.current_version.clone(),
        version: update.version.clone(),
        date,
        body: update.body.clone(),
        raw_json: update.raw_json.clone(),
        rid: 0,
    };
    let rid = webview.resources_table().add(update);
    Ok(Some(UpdateMetadata { rid, ..metadata }))
}
