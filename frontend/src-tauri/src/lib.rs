pub mod provision;

use serde::Serialize;
use std::path::Path;
use std::process::Command;
use tauri::Manager;

#[derive(Serialize)]
pub struct TerminalApp {
    id: String,
    name: String,
}

#[tauri::command]
fn detect_terminals() -> Vec<TerminalApp> {
    let mut terminals = vec![TerminalApp {
        id: "terminal_app".into(),
        name: "Terminal".into(),
    }];

    if Path::new("/Applications/iTerm.app").exists() {
        terminals.push(TerminalApp {
            id: "iterm2".into(),
            name: "iTerm".into(),
        });
    }

    terminals
}

#[tauri::command]
fn open_terminal_ssh(terminal_id: String, command: String) -> Result<(), String> {
    let escaped = command.replace('\\', "\\\\").replace('"', "\\\"");

    let script = match terminal_id.as_str() {
    "terminal_app" => format!(
      "if application \"Terminal\" is not running then\ntell application \"Terminal\"\nactivate\ndo script \"{escaped}\" in front window\nend tell\nelse\ntell application \"Terminal\"\ndo script \"{escaped}\"\nactivate\nend tell\nend if"
    ),
    "iterm2" => format!(
      "tell application \"iTerm\"\nactivate\ncreate window with default profile\ntell current session of current window\nwrite text \"{escaped}\"\nend tell\nend tell"
    ),
    _ => return Err(format!("Unknown terminal: {terminal_id}")),
  };

    Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to run osascript: {e}"))?;

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            detect_terminals,
            open_terminal_ssh,
            provision::provision_list_keys,
            provision::provision_test_connection,
            provision::provision_trust_host,
            provision::provision_preflight,
            provision::provision_start,
            provision::provision_cancel
        ])
        .setup(|app| {
            app.manage(provision::ProvisionState::default());
            if cfg!(debug_assertions) {
                app.handle().plugin(
                    tauri_plugin_log::Builder::default()
                        .level(log::LevelFilter::Info)
                        .build(),
                )?;
            }
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
