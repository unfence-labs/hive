use base64::{engine::general_purpose::STANDARD, Engine};
use minisign_verify::{PublicKey, Signature};
use semver::Version;
use std::time::Duration;
use tauri::Manager;
use tauri_plugin_updater::UpdaterExt;

const RELEASES: &str = "https://github.com/unfence-labs/hive/releases/download";

pub(crate) fn validate_target_version(target: &str, current: &str) -> Result<(), String> {
    let version = Version::parse(target).map_err(|_| "Invalid target version")?;
    let current = Version::parse(current).map_err(|_| "Invalid app version")?;
    if version.to_string() != target || version.cmp_precedence(&current).is_lt() {
        return Err("The target release must not be older than this app".into());
    }
    Ok(())
}

fn release_url(target: &str, asset: &str) -> String {
    format!("{RELEASES}/v{target}/{asset}")
}

/// Register the plugin's own resource so JS can use Update.download/install.
/// Only release selection differs from the standard latest-release check.
#[tauri::command]
pub async fn check_desktop_update(
    webview: tauri::Webview,
    target_version: String,
) -> Result<serde_json::Value, String> {
    validate_target_version(&target_version, env!("CARGO_PKG_VERSION"))?;
    let endpoint = release_url(&target_version, "latest.json")
        .parse()
        .map_err(|error| format!("Invalid release URL: {error}"))?;
    let mut update = webview
        .updater_builder()
        .endpoints(vec![endpoint])
        .map_err(|error| error.to_string())?
        .timeout(Duration::from_secs(30))
        .build()
        .map_err(|error| error.to_string())?
        .check()
        .await
        .map_err(|error| error.to_string())?
        .ok_or_else(|| format!("Release {target_version} is not available for this app"))?;
    if update.version != target_version {
        return Err(format!(
            "Expected release {target_version}, received {}",
            update.version
        ));
    }
    // The metadata timeout must not also limit the full application download.
    update.timeout = None;
    let mut metadata = serde_json::json!({
        "currentVersion": env!("CARGO_PKG_VERSION"),
        "version": update.version,
        "body": update.body,
        "rawJson": update.raw_json,
    });
    metadata["rid"] = webview.resources_table().add(update).into();
    Ok(metadata)
}

fn verify_script(
    script: &[u8],
    signature: &str,
    public_key: &str,
    target: &str,
) -> Result<String, String> {
    let decode = |encoded: &str| -> Result<String, String> {
        String::from_utf8(STANDARD.decode(encoded.trim()).map_err(|e| e.to_string())?)
            .map_err(|e| e.to_string())
    };
    let public_key = PublicKey::decode(&decode(public_key)?).map_err(|e| e.to_string())?;
    let signature = Signature::decode(&decode(signature)?).map_err(|e| e.to_string())?;
    public_key
        .verify(script, &signature, true)
        .map_err(|e| e.to_string())?;
    let script = std::str::from_utf8(script).map_err(|e| e.to_string())?;
    let mut lines = script.lines();
    let version_line = format!("SCRIPT_VERSION=\"{target}\"");
    if lines.next() != Some("#!/usr/bin/env bash")
        || lines.find(|line| !line.starts_with('#')) != Some(version_line.as_str())
    {
        return Err("The signed installer does not match the target release".into());
    }
    Ok(script.to_string())
}

pub(crate) fn download_provision_script(target: &str) -> Result<String, String> {
    validate_target_version(target, env!("CARGO_PKG_VERSION"))?;
    let client = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|e| e.to_string())?;
    let fetch = |asset: &str| {
        client
            .get(release_url(target, asset))
            .send()
            .and_then(|response| response.error_for_status())
            .and_then(|response| response.bytes())
            .map_err(|e| format!("Unable to fetch {asset} for {target}: {e}"))
    };
    let script = fetch("provision.sh")?;
    let signature = fetch("provision.sh.sig")?;
    let config: serde_json::Value =
        serde_json::from_str(include_str!("../tauri.conf.json")).map_err(|e| e.to_string())?;
    let key = config["plugins"]["updater"]["pubkey"]
        .as_str()
        .ok_or("Missing updater public key")?;
    verify_script(
        &script,
        std::str::from_utf8(&signature).map_err(|e| e.to_string())?,
        key,
        target,
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn target_versions_are_exact_and_never_downgrade() {
        assert!(validate_target_version("0.1.5", "0.1.4").is_ok());
        assert!(validate_target_version("0.1.4", "0.1.4").is_ok());
        assert!(validate_target_version("0.1.3", "0.1.4").is_err());
        assert!(validate_target_version("0.1.4-beta.1", "0.1.4").is_err());
        assert!(validate_target_version("0.1.5-beta.1", "0.1.4").is_ok());
        assert!(validate_target_version("0.1.5-beta.10", "0.1.5-beta.2").is_ok());
        assert!(validate_target_version("0.1.5", "0.1.5-beta.10").is_ok());
        assert!(validate_target_version("0.1.5-beta.1", "0.1.5").is_err());
        assert!(validate_target_version("0.1.5-beta.2", "0.1.5-beta.10").is_err());
        for target in ["v0.1.5", "0.1", "../latest", "0.1.5/path"] {
            assert!(validate_target_version(target, "0.1.4").is_err());
        }
        assert_eq!(
            release_url("0.1.5", "latest.json"),
            "https://github.com/unfence-labs/hive/releases/download/v0.1.5/latest.json"
        );
    }

    #[test]
    fn signed_installers_must_match_the_bytes_key_and_release() {
        let script = "#!/usr/bin/env bash\n# Hive provision.sh — generated by scripts/provision/build.sh; do not edit directly.\nSCRIPT_VERSION=\"0.1.5\"\necho fixture\n".as_bytes();
        let key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEQ3NkE1NTdDNEJGMTMwQTAKUldTZ01QRkxmRlZxMS9SdHpoWHRqajdnYkU3eDJkM1JUQk5iRkFvekhkeVc2d1diU1NrUXdLTjcK";
        let signature = "dW50cnVzdGVkIGNvbW1lbnQ6IHNpZ25hdHVyZSBmcm9tIHRhdXJpIHNlY3JldCBrZXkKUlVTZ01QRkxmRlZxMXlGMEpTalh4T1oyWEhEc3RYKzduelF6SXVJOEhqL1NuZ1BBVHZRbGlVazZ2VDVTMTdsWm5UejJMUUtXUmpvVktqb25POUZiYW1oY25RNlIvNG9pZEFNPQp0cnVzdGVkIGNvbW1lbnQ6IHRpbWVzdGFtcDoxNzg5MTI2MDMzCWZpbGU6cHJvdmlzaW9uLnNoClZZZkNuUUNJd0ROZ0F0cFU4dkFQV2dBQ3pxencwUTBLWXEwVU8ycjlSMXZMYWVMdFBiQ0VyM0l3WHY3M1Jlbm8xZ3NUeCtvQysreTVPZHk4M2FrUUFBPT0K";
        assert_eq!(
            verify_script(script, signature, key, "0.1.5")
                .unwrap()
                .as_bytes(),
            script
        );
        assert!(verify_script(b"modified", signature, key, "0.1.5").is_err());
        assert!(verify_script(script, signature, key, "0.1.6").is_err());
        assert!(verify_script(script, signature, "invalid", "0.1.5").is_err());
        assert!(verify_script(script, "", key, "0.1.5").is_err());
        let other_key = "dW50cnVzdGVkIGNvbW1lbnQ6IG1pbmlzaWduIHB1YmxpYyBrZXk6IEYwM0U0NDU0RjIwMzc5MjkKUldRcGVRUHlWRVErOEhTbmZrZ25aNGxzaVc2YmNmNm9TTWZ3NmFMWG1taXlDMnZ0TVc5TWNvLzIK";
        assert!(verify_script(script, signature, other_key, "0.1.5").is_err());
        let mut tampered = STANDARD.decode(signature).unwrap();
        let packet_start = tampered.iter().position(|byte| *byte == b'\n').unwrap() + 1;
        tampered[packet_start + 20] = if tampered[packet_start + 20] == b'A' {
            b'B'
        } else {
            b'A'
        };
        assert!(verify_script(script, &STANDARD.encode(tampered), key, "0.1.5").is_err());
    }

    #[test]
    fn unsigned_installers_are_rejected() {
        assert!(verify_script(b"echo unsafe", "", "", "0.1.5").is_err());
    }
}
