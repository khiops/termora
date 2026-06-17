use std::sync::atomic::{AtomicU16, Ordering};
#[cfg(not(dev))]
use std::io::Write;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

/// Stores the resolved hub port after startup (default 4100).
static HUB_PORT: AtomicU16 = AtomicU16::new(4100);

/// Resolves the hub config directory and reads the auth token from auth.json.
/// Returns `Some(token)` only if the token is a valid 64-char lowercase hex string.
fn read_hub_auth_token() -> Option<String> {
    let config_dir = {
        #[cfg(target_os = "windows")]
        {
            std::env::var("APPDATA")
                .ok()
                .map(std::path::PathBuf::from)
                .or_else(|| dirs::config_dir())?
        }
        #[cfg(not(target_os = "windows"))]
        {
            std::env::var("XDG_CONFIG_HOME")
                .ok()
                .map(std::path::PathBuf::from)
                .or_else(|| dirs::home_dir().map(|h| h.join(".config")))?
        }
    };

    let auth_path = config_dir.join("termora").join("auth.json");
    eprintln!("[termora] checking auth.json at: {}", auth_path.display());
    let contents = std::fs::read_to_string(&auth_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&contents).ok()?;
    let token = parsed.get("token")?.as_str()?.to_string();

    // Only inject if it looks like a valid 64-char lowercase hex string
    let valid = token.len() == 64 && token.chars().all(|c| matches!(c, 'a'..='f' | '0'..='9'));
    if valid { Some(token) } else { None }
}

/// Resolves the termora state directory:
/// - Linux/macOS: $XDG_STATE_HOME/termora or ~/.local/state/termora
/// - Windows: %LOCALAPPDATA%\termora
#[cfg(not(dev))]
fn get_state_dir() -> Option<std::path::PathBuf> {
    #[cfg(target_os = "windows")]
    {
        std::env::var("LOCALAPPDATA").ok().map(|p| std::path::PathBuf::from(p).join("termora"))
    }
    #[cfg(not(target_os = "windows"))]
    {
        std::env::var("XDG_STATE_HOME")
            .ok()
            .map(std::path::PathBuf::from)
            .or_else(|| dirs::home_dir().map(|h| h.join(".local").join("state")))
            .map(|p| p.join("termora"))
    }
}

/// Reads the hub port from runtime.json in the state dir.
#[cfg(not(dev))]
fn read_runtime_port() -> Option<u16> {
    let state_dir = get_state_dir()?;
    let runtime_path = state_dir.join("runtime.json");
    let contents = std::fs::read_to_string(&runtime_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&contents).ok()?;
    parsed.get("port")?.as_u64().map(|p| p as u16)
}

/// Checks whether a hub is alive by probing its /api/health endpoint.
#[cfg(not(dev))]
fn is_hub_alive(port: u16) -> bool {
    let client = reqwest::blocking::Client::builder()
        .timeout(std::time::Duration::from_secs(2))
        .build()
        .unwrap();
    matches!(
        client.get(format!("http://localhost:{}/api/health", port)).send(),
        Ok(resp) if resp.status().is_success()
    )
}


#[tauri::command]
fn get_hub_auth_token() -> Option<String> {
    let result = read_hub_auth_token();
    match &result {
        Some(_) => eprintln!("[termora] auto-auth: token found in auth.json"),
        None => eprintln!("[termora] auto-auth: no valid token in auth.json"),
    }
    result
}

/// Returns the resolved hub port (set at startup, cached in HUB_PORT).
#[tauri::command]
fn get_hub_port() -> u16 {
    HUB_PORT.load(Ordering::Relaxed)
}

#[tauri::command]
async fn read_agent_file(path: String) -> Result<Vec<u8>, String> {
    let file_path = std::path::PathBuf::from(path);
    if !file_path.is_absolute() {
        return Err("Agent file path must be absolute".to_string());
    }

    tauri::async_runtime::spawn_blocking(move || {
        std::fs::read(&file_path)
            .map_err(|error| format!("Failed to read {}: {}", file_path.display(), error))
    })
    .await
    .map_err(|error| error.to_string())?
}

/// In release builds, spawn the hub sidecar and wait for it to become ready.
/// In dev builds, the hub is already running externally — just show the window.
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // System tray
    let show = MenuItemBuilder::with_id("show", "Show Termora").build(app)?;
    let quit = MenuItemBuilder::with_id("quit", "Quit").build(app)?;
    let menu = MenuBuilder::new(app).items(&[&show, &quit]).build()?;

    let _tray = TrayIconBuilder::new()
        .menu(&menu)
        .on_menu_event(|app, event| match event.id().as_ref() {
            "show" => {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.set_focus();
                }
            }
            "quit" => {
                app.exit(0);
            }
            _ => {}
        })
        .build(app)?;

    // In release mode, spawn the hub sidecar
    #[cfg(not(dev))]
    {
        use tauri_plugin_shell::ShellExt;

        // Check if a hub is already running by reading runtime.json.
        // The hub writes this file with the actual listening port after bind.
        let mut hub_port: u16 = 4100;
        let mut need_spawn = true;

        if let Some(port) = read_runtime_port() {
            if is_hub_alive(port) {
                eprintln!("[termora] found existing hub on port {} (from runtime.json)", port);
                hub_port = port;
                need_spawn = false;
            }
        }

        if need_spawn {
            let sidecar = app.shell().sidecar("termora-hub").unwrap()
                .args(["start"]);
            let (mut rx, _child) = sidecar.spawn().expect("failed to spawn hub sidecar");

            // Store the child handle so it stays alive for the app's lifetime
            // (dropping it would kill the sidecar)
            app.manage(_child);

            // Capture sidecar stdout/stderr to a log file
            let log_dir = dirs::data_local_dir()
                .unwrap_or_else(|| std::path::PathBuf::from("."))
                .join("termora");
            let _ = std::fs::create_dir_all(&log_dir);
            let log_path = log_dir.join("hub.log");

            tauri::async_runtime::spawn(async move {
                let mut file = match std::fs::OpenOptions::new()
                    .create(true)
                    .append(true)
                    .open(&log_path)
                {
                    Ok(f) => f,
                    Err(_) => return,
                };

                use tauri_plugin_shell::process::CommandEvent;
                while let Some(event) = rx.recv().await {
                    match event {
                        CommandEvent::Stdout(line) => {
                            let _ = writeln!(file, "[hub:stdout] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Stderr(line) => {
                            let _ = writeln!(file, "[hub:stderr] {}", String::from_utf8_lossy(&line));
                        }
                        CommandEvent::Terminated(payload) => {
                            let _ = writeln!(file, "[hub:exit] code={:?} signal={:?}", payload.code, payload.signal);
                            break;
                        }
                        CommandEvent::Error(err) => {
                            let _ = writeln!(file, "[hub:error] {}", err);
                        }
                        _ => {}
                    }
                }
            });

            // Wait for hub to be ready (poll /api/health)
            let client = reqwest::blocking::Client::builder()
                .timeout(std::time::Duration::from_secs(2))
                .build()
                .unwrap();

            let mut ready = false;
            for _ in 0..30 {
                // 30 attempts × 500ms = 15s max wait
                match client.get(format!("http://localhost:{}/api/health", hub_port)).send() {
                    Ok(resp) if resp.status().is_success() => {
                        ready = true;
                        break;
                    }
                    _ => std::thread::sleep(std::time::Duration::from_millis(500)),
                }
            }

            if !ready {
                eprintln!("Hub sidecar did not become ready within 15 seconds");
            } else {
                // Read actual port from runtime.json (hub may have used zero_conf)
        // First check runtime.json for a known port
                if let Some(port) = read_runtime_port() {
                    hub_port = port;
                }
            }
        }

        HUB_PORT.store(hub_port, Ordering::Relaxed);
        eprintln!("[termora] hub port resolved to {}", hub_port);
    }

    // Show the main window (hidden by default in config)
    if let Some(window) = app.get_webview_window("main") {
        // Enable DevTools in debug builds only
        #[cfg(debug_assertions)]
        window.open_devtools();
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_os::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .plugin(tauri_plugin_dialog::init())
        .invoke_handler(tauri::generate_handler![
            get_hub_auth_token,
            get_hub_port,
            read_agent_file
        ])
        .setup(setup_app)
        .run(tauri::generate_context!())
        .expect("error while running termora");
}
