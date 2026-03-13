use std::io::Write;
use tauri::Manager;
use tauri::menu::{MenuBuilder, MenuItemBuilder};
use tauri::tray::TrayIconBuilder;

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

    let auth_path = config_dir.join("nexterm").join("auth.json");
    eprintln!("[nexterm] checking auth.json at: {}", auth_path.display());
    let contents = std::fs::read_to_string(&auth_path).ok()?;
    let parsed: serde_json::Value = serde_json::from_str(&contents).ok()?;
    let token = parsed.get("token")?.as_str()?.to_string();

    // Only inject if it looks like a valid 64-char lowercase hex string
    let valid = token.len() == 64 && token.chars().all(|c| matches!(c, 'a'..='f' | '0'..='9'));
    if valid { Some(token) } else { None }
}


#[tauri::command]
fn get_hub_auth_token() -> Option<String> {
    let result = read_hub_auth_token();
    match &result {
        Some(_) => eprintln!("[nexterm] auto-auth: token found in auth.json"),
        None => eprintln!("[nexterm] auto-auth: no valid token in auth.json"),
    }
    result
}


/// In release builds, spawn the hub sidecar and wait for it to become ready.
/// In dev builds, the hub is already running externally — just show the window.
fn setup_app(app: &mut tauri::App) -> Result<(), Box<dyn std::error::Error>> {
    // System tray
    let show = MenuItemBuilder::with_id("show", "Show Nexterm").build(app)?;
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

        let sidecar = app.shell().sidecar("nexterm-hub").unwrap();
        let (rx, _child) = sidecar.spawn().expect("failed to spawn hub sidecar");

        // Store the child handle so it stays alive for the app's lifetime
        // (dropping it would kill the sidecar)
        app.manage(_child);

        // Capture sidecar stdout/stderr to a log file
        let log_dir = dirs::data_local_dir()
            .unwrap_or_else(|| std::path::PathBuf::from("."))
            .join("nexterm");
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
        let url = format!("http://localhost:{}/api/health", 4100);
        let client = reqwest::blocking::Client::builder()
            .timeout(std::time::Duration::from_secs(2))
            .build()
            .unwrap();

        let mut ready = false;
        for _ in 0..30 {
            // 30 attempts × 500ms = 15s max wait
            match client.get(&url).send() {
                Ok(resp) if resp.status().is_success() => {
                    ready = true;
                    break;
                }
                _ => std::thread::sleep(std::time::Duration::from_millis(500)),
            }
        }

        if !ready {
            eprintln!("Hub sidecar did not become ready within 15 seconds");
        }
    }

    // Show the main window (hidden by default in config)
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.show();
        let _ = window.set_focus();
    }

    Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .invoke_handler(tauri::generate_handler![get_hub_auth_token])
        .setup(setup_app)
        .run(tauri::generate_context!())
        .expect("error while running nexterm");
}
