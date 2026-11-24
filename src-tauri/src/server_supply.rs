//! Client-side vela-server supply for GUI builds. Download the version/platform artifact from the fork's GitHub
//! release, verify its minisign signature and SHA-256, then cache it locally.
//!
//! Trust is rooted in the embedded minisign public key shared with automatic updates, not the manifest
//! or network. Only signed artifacts enter the cache and they may be verified again before use.
//!
//! Releases from 0.2.10 on also publish the binary inside a signed zip (`zip_*` manifest fields). The
//! headless binary no longer stores its frontend compressed, because Huorong deletes such a file on
//! write as Trojan/MSIL.ShellLoader.q, so the zip carries the size saving instead: it is what gets
//! downloaded and uploaded over SSH, and the remote host unpacks it. Older manifests carry only the raw
//! binary and keep the original path.

use std::collections::HashMap;
use std::io::Read;
use std::path::{Path, PathBuf};
use std::time::Duration;

use base64::Engine;
use serde::Deserialize;

/// This fork's GitHub releases, which publish the vela-server artifacts and `server-manifest.json`. The
/// server region setting (`server_region`) does not apply here: upstream's dl.velaterm.com and its China
/// mirror carry upstream's artifacts, which are signed with upstream's key and never verify against this
/// fork's, so vela-server always comes from this fork's own release.
const RELEASES: &str = "https://github.com/eperfecto/VelaTerm/releases";

/// This fork's signing key, which must match `plugins.updater.pubkey` in tauri.conf.json. The fork's release
/// workflow signs both desktop updates and vela-server artifacts with it, so both verify against this key and
/// not upstream's. Tauri wraps the two-line minisign public-key file in base64. Update this constant whenever
/// the key rotates.
const UPDATE_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg5NDZBNTRDRTU4NTdBNzkKUldSNWVvWGxUS1ZHaWFEaWJYQjRaY0VrOFpSakp0ODRSQW85WDI1OGo0VXRDaEZQTktzTm5uOU4K";

/// The fork signs vela-server and desktop updates with one key.
const SERVER_KEY: &str = UPDATE_PUBKEY_B64;

/// server-manifest.json containing one `{url, sha256, signature}` entry per platform.
#[derive(Debug, Deserialize)]
pub struct ServerManifest {
    pub version: String,
    pub platforms: HashMap<String, PlatformEntry>,
}

#[derive(Debug, Deserialize, Clone)]
pub struct PlatformEntry {
    pub url: String,
    pub sha256: String,
    /// Base64 Tauri `.sig` content wrapping a minisign signature file.
    pub signature: String,
    /// The same binary as the only entry of a signed zip; absent in manifests published before 0.2.10.
    #[serde(default)]
    pub zip_url: Option<String>,
    #[serde(default)]
    pub zip_sha256: Option<String>,
    #[serde(default)]
    pub zip_signature: Option<String>,
}

impl PlatformEntry {
    /// The zip artifact as `(url, sha256, signature)` when the manifest publishes all three fields.
    fn zip(&self) -> Option<(&str, &str, &str)> {
        match (&self.zip_url, &self.zip_sha256, &self.zip_signature) {
            (Some(u), Some(h), Some(s)) if !u.is_empty() && !h.is_empty() && !s.is_empty() => {
                Some((u, h, s))
            }
            _ => None,
        }
    }
}

/// A verified vela-server ready to be placed on a host.
#[derive(Debug, Clone)]
pub struct Supplied {
    /// Local executable, used for local installs and as the upload fallback.
    pub bin: PathBuf,
    /// Lowercase SHA-256 of `bin`, which the remote copy must match.
    pub sha256: String,
    /// Zip whose only entry is `bin`, preferred for uploads when present.
    pub zip: Option<PathBuf>,
}

/// Upper bound on the unpacked binary. The real one is about 60 MB; this only stops a corrupt or
/// hostile size field from exhausting memory before the hash check could reject it.
const MAX_UNPACKED_BYTES: u64 = 512 * 1024 * 1024;

/// Map remote OS/architecture to the platform key shared with publish-server.sh and updater_target_key.
/// os ∈ {linux,macos,windows}，arch ∈ {x86_64,aarch64}。
pub fn platform_key(os: &str, arch: &str) -> String {
    let os_key = match os {
        "macos" => "darwin",
        other => other, // Linux and Windows remain unchanged.
    };
    format!("{os_key}-{arch}")
}

/// Cache path: `<app_data_dir>/server-cache/<version>/<platform>/vela-server`.
pub fn cache_path(app_data_dir: &Path, version: &str, platkey: &str) -> PathBuf {
    app_data_dir
        .join("server-cache")
        .join(version)
        .join(platkey)
        .join("vela-server")
}

/// Adjacent `vela-server.sig` path for offline re-verification.
fn cache_sig_path(bin: &Path) -> PathBuf {
    let mut p = bin.as_os_str().to_os_string();
    p.push(".sig");
    PathBuf::from(p)
}

/// Adjacent `vela-server.zip` path holding the signed archive the binary was unpacked from.
fn cache_zip_path(bin: &Path) -> PathBuf {
    let mut p = bin.as_os_str().to_os_string();
    p.push(".zip");
    PathBuf::from(p)
}

/// File name of the binary inside the published zip, which is also its name on the remote host.
pub fn binary_name(platkey: &str) -> &'static str {
    if platkey.starts_with("windows-") {
        "vela-server.exe"
    } else {
        "vela-server"
    }
}

/// Unpack the binary from a published zip. The archive must hold exactly one file, named `name` at
/// its root, so a repackaged archive cannot smuggle in extra files or paths.
pub fn unpack_zip(data: &[u8], name: &str) -> Result<Vec<u8>, String> {
    let mut archive = zip::ZipArchive::new(std::io::Cursor::new(data))
        .map_err(|e| format!("vela-server zip is unreadable: {e}"))?;
    if archive.len() != 1 {
        return Err(format!(
            "vela-server zip must contain exactly one file, found {}",
            archive.len()
        ));
    }
    let entry = archive
        .by_index(0)
        .map_err(|e| format!("vela-server zip entry is unreadable: {e}"))?;
    if entry.name() != name {
        return Err(format!(
            "vela-server zip holds {:?}, expected {name:?}",
            entry.name()
        ));
    }
    if entry.size() > MAX_UNPACKED_BYTES {
        return Err(format!("vela-server zip entry is too large: {} bytes", entry.size()));
    }
    let mut out = Vec::with_capacity(entry.size() as usize);
    // The bound applies to the bytes actually produced as well, not only to the declared size.
    entry
        .take(MAX_UNPACKED_BYTES + 1)
        .read_to_end(&mut out)
        .map_err(|e| format!("failed to unpack vela-server zip: {e}"))?;
    if out.len() as u64 > MAX_UNPACKED_BYTES {
        return Err("vela-server zip entry is too large".to_string());
    }
    Ok(out)
}

/// Write `data` to `path` through a temporary file and rename, so a partial file never appears.
fn write_atomic(path: &Path, data: &[u8]) -> Result<(), String> {
    if let Some(dir) = path.parent() {
        std::fs::create_dir_all(dir).map_err(|e| format!("failed to create cache dir: {e}"))?;
    }
    let mut tmp = path.as_os_str().to_os_string();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    std::fs::write(&tmp, data).map_err(|e| format!("failed to write cache temp file: {e}"))?;
    std::fs::rename(&tmp, path).map_err(|e| format!("failed to place cache file: {e}"))
}

/// Set the Unix executable bit for a consistent local cache, even though the file is uploaded remotely.
fn mark_executable(_bin: &Path) {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if let Ok(meta) = std::fs::metadata(_bin) {
            let mut perm = meta.permissions();
            perm.set_mode(0o755);
            let _ = std::fs::set_permissions(_bin, perm);
        }
    }
}

/// Unpack a verified zip next to the cache entry and return the supply. The binary is rewritten only
/// when its bytes differ, so a cache hit does not touch the disk.
fn supply_from_zip(bin: &Path, zip_data: &[u8], platkey: &str) -> Result<Supplied, String> {
    let unpacked = unpack_zip(zip_data, binary_name(platkey))?;
    let sha256 = sha256_hex(&unpacked);
    let current = std::fs::read(bin).ok();
    if current.as_deref() != Some(unpacked.as_slice()) {
        write_atomic(bin, &unpacked)?;
    }
    mark_executable(bin);
    Ok(Supplied {
        bin: bin.to_path_buf(),
        sha256,
        zip: Some(cache_zip_path(bin)),
    })
}

/// Supply a development build named by `VLX_DEV_SERVER_BIN`, which bypasses publication and signing.
/// A `.zip` is unpacked into the cache's `dev` slot so the zip upload path can be exercised end to end.
pub fn supply_dev_override(
    app_data_dir: &Path,
    path: &Path,
    platkey: &str,
) -> Result<Supplied, String> {
    let data = std::fs::read(path)
        .map_err(|e| format!("failed to read {}: {e}", path.display()))?;
    let is_zip = path
        .extension()
        .is_some_and(|e| e.eq_ignore_ascii_case("zip"));
    if !is_zip {
        return Ok(Supplied {
            bin: path.to_path_buf(),
            sha256: sha256_hex(&data),
            zip: None,
        });
    }
    let bin = cache_path(app_data_dir, "dev", platkey);
    write_atomic(&cache_zip_path(&bin), &data)?;
    supply_from_zip(&bin, &data, platkey)
}

/// Parse one of the embedded keys as a minisign PublicKey.
fn public_key(key_b64: &str) -> Result<minisign_verify::PublicKey, String> {
    let decoded = base64::engine::general_purpose::STANDARD
        .decode(key_b64.trim())
        .map_err(|e| format!("builtin public key base64 decode failed: {e}"))?;
    let text =
        String::from_utf8(decoded).map_err(|e| format!("builtin public key is not UTF-8: {e}"))?;
    // Select the first nonempty, non-comment line containing the `RW...` key.
    let key_line = text
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && !l.to_ascii_lowercase().starts_with("untrusted comment"))
        .ok_or("builtin public key file has no key line")?;
    minisign_verify::PublicKey::from_base64(key_line)
        .map_err(|e| format!("failed to parse minisign public key: {e}"))
}

/// Verify data against a base64 minisign signature using the given embedded key.
fn verify_with(key_b64: &str, data: &[u8], sig_b64: &str) -> Result<(), String> {
    let pk = public_key(key_b64)?;
    let sig_decoded = base64::engine::general_purpose::STANDARD
        .decode(sig_b64.trim())
        .map_err(|e| format!("signature base64 decode failed: {e}"))?;
    let sig_text =
        String::from_utf8(sig_decoded).map_err(|e| format!("signature is not UTF-8: {e}"))?;
    let sig = minisign_verify::Signature::decode(&sig_text)
        .map_err(|e| format!("failed to parse minisign signature: {e}"))?;
    pk.verify(data, &sig, false)
        .map_err(|e| format!("signature verification failed: {e}"))
}

/// Verify a vela-server artifact from the fork's release, which the fork signs.
pub fn verify_signature(data: &[u8], sig_b64: &str) -> Result<(), String> {
    verify_with(SERVER_KEY, data, sig_b64)
}

/// Verify a desktop update package, which this fork's release workflow signs.
pub fn verify_update_signature(data: &[u8], sig_b64: &str) -> Result<(), String> {
    verify_with(UPDATE_PUBKEY_B64, data, sig_b64)
}

/// `velaterm --verify-update <file> <signature>`: verify a downloaded desktop update with this fork's
/// updater key. The signature is the base64 `.sig` text from the updater manifest. Returns the process
/// exit status (0 verified, 1 rejected, 2 misuse) and prints only the failure reason.
pub fn run_verify_update(args: &[String]) -> i32 {
    let (Some(path), Some(sig)) = (args.get(2), args.get(3)) else {
        eprintln!("usage: velaterm --verify-update <file> <signature>");
        return 2;
    };
    let result = std::fs::read(path)
        .map_err(|e| format!("failed to read {path}: {e}"))
        .and_then(|data| verify_update_signature(&data, sig));
    match result {
        Ok(()) => 0,
        Err(e) => {
            eprintln!("{e}");
            1
        }
    }
}

/// Compute lowercase hexadecimal SHA-256 for bytes.
pub fn sha256_hex(data: &[u8]) -> String {
    use sha2::{Digest, Sha256};
    let d = Sha256::digest(data);
    d.iter().map(|b| format!("{b:02x}")).collect()
}

fn manifest_url(version: &str) -> String {
    format!("{RELEASES}/download/v{version}/server-manifest.json")
}

fn latest_manifest_url() -> String {
    format!("{RELEASES}/latest/download/server-manifest.json")
}

fn parse_manifest_version(body: &str) -> Option<String> {
    let value: serde_json::Value = serde_json::from_str(body).ok()?;
    value["version"].as_str().map(str::to_string)
}

/// Fetch server-manifest.json for a version.
pub fn fetch_manifest(version: &str) -> Result<ServerManifest, String> {
    let url = manifest_url(version);
    let body = ureq::get(&url)
        .timeout(Duration::from_secs(30))
        .call()
        .map_err(|e| format!("failed to fetch server manifest ({url}): {e}"))?
        .into_string()
        .map_err(|e| format!("failed to read server manifest: {e}"))?;
    serde_json::from_str(&body).map_err(|e| format!("failed to parse server manifest: {e}"))
}

/// Newest published vela-server version, read from the manifest attached to the fork's latest release.
pub fn fetch_latest_version() -> Result<String, String> {
    ureq::get(&latest_manifest_url())
        .timeout(Duration::from_secs(30))
        .call()
        .ok()
        .and_then(|r| r.into_string().ok())
        .and_then(|body| parse_manifest_version(&body))
        .ok_or_else(|| "cannot determine the latest vela-server version".to_string())
}

/// Download URL bytes and report received/Content-Length percentages from 0 through 100. Without
/// Content-Length, emit no percentage so the caller retains indeterminate stage text.
pub fn download(url: &str, on_pct: &dyn Fn(u8)) -> Result<Vec<u8>, String> {
    let resp = ureq::get(url)
        .timeout(Duration::from_secs(180))
        .call()
        .map_err(|e| format!("download failed ({url}): {e}"))?;
    let total: Option<usize> = resp
        .header("Content-Length")
        .and_then(|v| v.trim().parse().ok())
        .filter(|n: &usize| *n > 0);
    let mut reader = resp.into_reader();
    let mut buf: Vec<u8> = Vec::with_capacity(total.unwrap_or(0));
    let mut chunk = [0u8; 64 * 1024];
    let mut last_pct: i16 = -1;
    if total.is_some() {
        on_pct(0);
        last_pct = 0;
    }
    loop {
        // A stopped connect abandons the download between chunks.
        crate::connect_cancel::check()?;
        let n = reader
            .read(&mut chunk)
            .map_err(|e| format!("failed to read downloaded content: {e}"))?;
        if n == 0 {
            break;
        }
        buf.extend_from_slice(&chunk[..n]);
        if let Some(t) = total {
            let pct = ((buf.len() as u64 * 100) / t as u64).min(100) as i16;
            if pct != last_pct {
                last_pct = pct;
                on_pct(pct as u8);
            }
        }
    }
    Ok(buf)
}

/// Ensure a valid vela-server for the version/platform exists locally and return it. Reuse a verified
/// cache entry; otherwise fetch the manifest and artifact, verify signature and SHA-256, then
/// atomically cache it. Cache hits do not call `on_pct`.
///
/// A release that publishes a zip is fetched as the zip, unpacked locally, and supplied with it, so
/// uploads can send the smaller archive. Older releases supply the raw binary only.
pub fn ensure_supplied(
    app_data_dir: &Path,
    version: &str,
    platkey: &str,
    on_pct: &dyn Fn(u8),
) -> Result<Supplied, String> {
    let bin = cache_path(app_data_dir, version, platkey);

    // Fast paths: verify the cached artifact with its adjacent signature, avoiding a manifest request.
    // A valid signature already proves the artifact has not changed. The zip comes first because the
    // binary next to it is derived from it and carries no signature of its own.
    let zip_path = cache_zip_path(&bin);
    if let (Ok(data), Ok(sig_b64)) = (
        std::fs::read(&zip_path),
        std::fs::read_to_string(cache_sig_path(&zip_path)),
    ) {
        if verify_signature(&data, sig_b64.trim()).is_ok() {
            if let Ok(supplied) = supply_from_zip(&bin, &data, platkey) {
                return Ok(supplied);
            }
        }
    }
    if let (Ok(data), Ok(sig_b64)) = (std::fs::read(&bin), std::fs::read_to_string(cache_sig_path(&bin))) {
        if verify_signature(&data, sig_b64.trim()).is_ok() {
            return Ok(Supplied {
                sha256: sha256_hex(&data),
                bin,
                zip: None,
            });
        }
    }

    // Slow path: fetch manifest, select platform, download, verify twice, and persist.
    let manifest = fetch_manifest(version)?;
    if manifest.version != version {
        return Err(format!(
            "manifest version mismatch: expected {version}, got {}",
            manifest.version
        ));
    }
    let entry = manifest
        .platforms
        .get(platkey)
        .ok_or_else(|| format!("server-manifest has no vela-server for platform {platkey} (not published for this platform?)"))?;

    if let Some((url, sha256, signature)) = entry.zip() {
        let data = download_verified(url, sha256, signature, on_pct)?;
        // Unpack before caching the zip, so an archive with the wrong contents is never kept.
        let supplied = supply_from_zip(&bin, &data, platkey)?;
        write_atomic(&zip_path, &data)?;
        std::fs::write(cache_sig_path(&zip_path), signature.trim())
            .map_err(|e| format!("failed to write cache signature: {e}"))?;
        return Ok(supplied);
    }

    let data = download_verified(&entry.url, &entry.sha256, &entry.signature, on_pct)?;
    write_atomic(&bin, &data)?;
    // Store the signature for offline re-verification.
    std::fs::write(cache_sig_path(&bin), entry.signature.trim())
        .map_err(|e| format!("failed to write cache signature: {e}"))?;
    mark_executable(&bin);
    Ok(Supplied {
        sha256: sha256_hex(&data),
        bin,
        zip: None,
    })
}

/// Download one artifact, then verify its signature for authenticity and its SHA-256 against the
/// manifest, which the remote path also relies on.
fn download_verified(
    url: &str,
    sha256: &str,
    signature: &str,
    on_pct: &dyn Fn(u8),
) -> Result<Vec<u8>, String> {
    // The URL comes from this fork's manifest and is fetched as listed: the server region's mirror only
    // holds upstream's artifacts (see `RELEASES`).
    let data = download(url, on_pct)?;
    verify_signature(&data, signature)?;
    let got = sha256_hex(&data);
    if !got.eq_ignore_ascii_case(sha256) {
        return Err(format!(
            "downloaded content SHA-256 does not match manifest: expected {sha256}, got {got}"
        ));
    }
    Ok(data)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn platform_key_maps_os() {
        assert_eq!(platform_key("linux", "x86_64"), "linux-x86_64");
        assert_eq!(platform_key("macos", "aarch64"), "darwin-aarch64");
        // Intel Mac artifact published alongside darwin-aarch64 since 2026-07-02.
        assert_eq!(platform_key("macos", "x86_64"), "darwin-x86_64");
        assert_eq!(platform_key("windows", "x86_64"), "windows-x86_64");
    }

    #[test]
    fn cache_path_shape() {
        let p = cache_path(Path::new("/data"), "0.1.73", "linux-x86_64");
        assert!(p.ends_with("server-cache/0.1.73/linux-x86_64/vela-server"));
    }

    #[test]
    fn sha256_hex_known_vector() {
        // Standard SHA-256 vector for an empty string.
        assert_eq!(
            sha256_hex(b""),
            "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
        );
    }

    #[test]
    fn manifest_url_points_at_the_fork_release() {
        assert_eq!(
            manifest_url("0.2.15"),
            "https://github.com/eperfecto/VelaTerm/releases/download/v0.2.15/server-manifest.json"
        );
    }

    #[test]
    fn latest_manifest_url_uses_the_latest_release() {
        assert_eq!(
            latest_manifest_url(),
            "https://github.com/eperfecto/VelaTerm/releases/latest/download/server-manifest.json"
        );
    }

    #[test]
    fn latest_version_reads_the_manifest_version() {
        assert_eq!(
            parse_manifest_version(r#"{"version":"0.2.15","platforms":{}}"#).as_deref(),
            Some("0.2.15")
        );
    }

    #[test]
    fn latest_version_rejects_missing_or_bad_json() {
        assert_eq!(parse_manifest_version(r#"{"platforms":{}}"#), None);
        assert_eq!(parse_manifest_version("not json"), None);
    }

    #[test]
    fn manifest_parses() {
        let json = r#"{"version":"0.1.73","pub_date":"x","platforms":{
            "linux-x86_64":{"url":"https://x/vela-server","sha256":"ab","signature":"c2ln"}}}"#;
        let m: ServerManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.version, "0.1.73");
        let e = m.platforms.get("linux-x86_64").unwrap();
        assert_eq!(e.sha256, "ab");
    }

    #[test]
    fn manifest_zip_fields_are_optional() {
        // Manifests published before 0.2.10 have no zip fields and keep the raw-binary path.
        let json = r#"{"version":"0.2.9","platforms":{
            "windows-x86_64":{"url":"u","sha256":"ab","signature":"c2ln"}}}"#;
        let m: ServerManifest = serde_json::from_str(json).unwrap();
        assert!(m.platforms["windows-x86_64"].zip().is_none());

        let json = r#"{"version":"0.2.10","platforms":{
            "windows-x86_64":{"url":"u","sha256":"ab","signature":"c2ln",
              "zip_url":"z","zip_sha256":"cd","zip_signature":"c2ln"}}}"#;
        let m: ServerManifest = serde_json::from_str(json).unwrap();
        assert_eq!(m.platforms["windows-x86_64"].zip(), Some(("z", "cd", "c2ln")));
    }

    /// Build an in-memory zip from `(name, bytes)` entries.
    fn make_zip(entries: &[(&str, &[u8])]) -> Vec<u8> {
        use std::io::Write;
        let mut w = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opts = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Deflated);
        for (name, data) in entries {
            w.start_file(*name, opts).unwrap();
            w.write_all(data).unwrap();
        }
        w.finish().unwrap().into_inner()
    }

    #[test]
    fn unpack_zip_accepts_only_the_expected_single_entry() {
        let body = b"MZ fake vela-server".repeat(100);
        let z = make_zip(&[("vela-server.exe", &body)]);
        assert_eq!(unpack_zip(&z, "vela-server.exe").unwrap(), body);
        // Wrong name, nested path, and extra entries are all rejected.
        assert!(unpack_zip(&z, "vela-server").is_err());
        assert!(unpack_zip(&make_zip(&[("bin/vela-server", &body)]), "vela-server").is_err());
        let two = make_zip(&[("vela-server", &body), ("extra", b"x")]);
        assert!(unpack_zip(&two, "vela-server").is_err());
        assert!(unpack_zip(b"not a zip", "vela-server").is_err());
    }

    #[test]
    fn binary_name_follows_platform() {
        assert_eq!(binary_name("windows-x86_64"), "vela-server.exe");
        assert_eq!(binary_name("windows-aarch64"), "vela-server.exe");
        assert_eq!(binary_name("linux-x86_64"), "vela-server");
        assert_eq!(binary_name("darwin-aarch64"), "vela-server");
    }

    #[test]
    fn dev_override_unpacks_a_zip_into_the_cache() {
        let dir = std::env::temp_dir().join(format!("vlx-supply-dev-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let body = b"#!/bin/sh\necho dev\n".to_vec();
        let zpath = dir.join("vela-server.zip");
        std::fs::write(&zpath, make_zip(&[("vela-server", &body)])).unwrap();

        let s = supply_dev_override(&dir, &zpath, "linux-x86_64").unwrap();
        assert_eq!(std::fs::read(&s.bin).unwrap(), body);
        assert_eq!(s.sha256, sha256_hex(&body));
        assert!(s.zip.as_ref().unwrap().is_file());

        // A raw path is supplied as-is, with no zip.
        let raw = supply_dev_override(&dir, &s.bin, "linux-x86_64").unwrap();
        assert!(raw.zip.is_none());
        assert_eq!(raw.sha256, s.sha256);
        let _ = std::fs::remove_dir_all(&dir);
    }

    /// Upstream's release key, kept only to guard against copying it into the fork's updater slot.
    const UPSTREAM_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDg3QkY3RjE5NjU5NEIzN0YKUldSL3M1UmxHWCsvaDF4bkdReURmL2FLV2ZRbDU1V0xyRGV0dHZwQnBibWxPU3pGdXRjc2x4eCsK";

    /// Test-only key pair: the private key was discarded after signing `PAYLOAD`.
    const THROWAWAY_PUBKEY_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IDQ3MDlBMEU1MDIwQzc3RDYKUldUV2R3d0M1YUFKUndWeTNoem5DRmZVSU0wUXFjdXRIU3NzcC81UEhYUnVSNUkvZjArYTNzY3UK";
    const PAYLOAD: &[u8] = b"velaterm-test-01";
    const THROWAWAY_SIG_B64: &str = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVUV2R3d0M1YUFKUnhFMmUxTFp4WTc2WWdZbWxIMnY4RXNHa2pmZkNiQ2lKVWdmVkZvQUdsK1JmOWU1OEpMbUh4UGNWbzA2akRPSWJlald0WHRtaDB2a0xyck83QXpMeHdrPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzkyMTIwMjM4CWZpbGU6cGF5bG9hZC5iaW4KcmRpK1RwMW53dXJuUWRlNE5oYVBCTldWeWJHd1NadTJpV2VDdEpSL1FPbUgrTzBaVXdRQUJpcG1Qd2hiNm5HSFBMRDQwMWpCZG5ha0NKWkxPdnFNQWc9PQo=";

    #[test]
    fn builtin_public_keys_parse() {
        // Ensure minisign-verify parses the embedded keys, catching base64 transcription errors.
        assert!(
            public_key(UPDATE_PUBKEY_B64).is_ok(),
            "the updater key should parse"
        );
        assert!(
            public_key(UPSTREAM_PUBKEY_B64).is_ok(),
            "the upstream key should parse"
        );
    }

    #[test]
    fn upstream_key_is_not_the_fork_key() {
        // A fork that copies upstream's key into the updater slot cannot sign its own updates, and the
        // mistake is invisible until an update is rejected in the field.
        assert_ne!(
            UPSTREAM_PUBKEY_B64, UPDATE_PUBKEY_B64,
            "the updater key must be this fork's own, not upstream's"
        );
    }

    #[test]
    fn server_artifacts_verify_with_the_fork_updater_key() {
        assert_eq!(SERVER_KEY, UPDATE_PUBKEY_B64);
    }

    #[test]
    fn foreign_signature_is_rejected() {
        // Signed by a key that is not the fork's: verify_signature must refuse it.
        assert!(verify_with(THROWAWAY_PUBKEY_B64, PAYLOAD, THROWAWAY_SIG_B64).is_ok());
        assert!(verify_signature(PAYLOAD, THROWAWAY_SIG_B64).is_err());
    }
}
