use std::sync::atomic::Ordering;

use tauri::{Emitter, State};

use crate::scheduler;
use super::AppState;

#[derive(serde::Serialize, Clone)]
struct ScanStatusEvent {
    scope: String,
    folder_id: Option<String>,
    status: String,
    count: Option<u32>,
    error: Option<String>,
}

/// Opens a folder in the OS file explorer.
#[tauri::command]
pub fn open_in_explorer(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    if !p.exists() {
        return Err(format!("Path '{}' does not exist", path));
    }
    #[cfg(target_os = "windows")]
    {
        std::process::Command::new("explorer")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open explorer: {}", e))?;
    }
    #[cfg(target_os = "macos")]
    {
        std::process::Command::new("open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open Finder: {}", e))?;
    }
    #[cfg(target_os = "linux")]
    {
        std::process::Command::new("xdg-open")
            .arg(&path)
            .spawn()
            .map_err(|e| format!("Failed to open file manager: {}", e))?;
    }
    Ok(())
}

/// Ensure a directory exists, creating it (and parents) if needed.
/// Returns a clear error if the drive letter doesn't exist.
#[tauri::command]
pub fn ensure_dir(path: String) -> Result<(), String> {
    let p = std::path::Path::new(&path);
    // Check the root/drive exists first
    if let Some(root) = p.components().next() {
        let root_path = std::path::PathBuf::from(root.as_os_str());
        if !root_path.exists() {
            return Err(format!("Drive '{}' does not exist", root_path.display()));
        }
    }
    std::fs::create_dir_all(&path)
        .map_err(|e| format!("Failed to create directory '{}': {}", path, e))
}

#[tauri::command]
pub fn scan_now(app: tauri::AppHandle, state: State<AppState>) -> Result<(), String> {
    if state.scan_running.swap(true, Ordering::SeqCst) {
        return Err("A scan is already running".to_string());
    }

    let _ = app.emit(
        "scan-status",
        ScanStatusEvent {
            scope: "all".to_string(),
            folder_id: None,
            status: "started".to_string(),
            count: None,
            error: None,
        },
    );

    // Clone the config so we don't hold the mutex lock during the entire scan
    let config = match state.config.lock() {
        Ok(guard) => guard.clone(),
        Err(e) => {
            state.scan_running.store(false, Ordering::SeqCst);
            return Err(e.to_string());
        }
    };
    let db = state.db.clone();
    let scan_running = state.scan_running.clone();

    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            scheduler::scan_existing_files(&config, &db)
        }));

        match result {
            Ok(count) => {
                let _ = app.emit(
                    "scan-status",
                    ScanStatusEvent {
                        scope: "all".to_string(),
                        folder_id: None,
                        status: "finished".to_string(),
                        count: Some(count),
                        error: None,
                    },
                );
                let _ = app.emit("dashboard-data-changed", ());
            }
            Err(_) => {
                let _ = app.emit(
                    "scan-status",
                    ScanStatusEvent {
                        scope: "all".to_string(),
                        folder_id: None,
                        status: "failed".to_string(),
                        count: None,
                        error: Some("Scan panicked".to_string()),
                    },
                );
            }
        }

        scan_running.store(false, Ordering::SeqCst);
    });

    Ok(())
}

/// Scan a single folder for existing files and evaluate rules.
/// Returns the number of files processed.
#[tauri::command]
pub fn scan_folder(
    app: tauri::AppHandle,
    state: State<AppState>,
    folder_id: String,
) -> Result<(), String> {
    if state.scan_running.swap(true, Ordering::SeqCst) {
        return Err("A scan is already running".to_string());
    }

    let _ = app.emit(
        "scan-status",
        ScanStatusEvent {
            scope: "folder".to_string(),
            folder_id: Some(folder_id.clone()),
            status: "started".to_string(),
            count: None,
            error: None,
        },
    );

    let config = match state.config.lock() {
        Ok(guard) => guard.clone(),
        Err(e) => {
            state.scan_running.store(false, Ordering::SeqCst);
            return Err(e.to_string());
        }
    };
    let db = state.db.clone();
    let scan_running = state.scan_running.clone();

    std::thread::spawn(move || {
        let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
            scheduler::scan_single_folder(&config, &db, &folder_id)
        }));

        match result {
            Ok(count) => {
                let _ = app.emit(
                    "scan-status",
                    ScanStatusEvent {
                        scope: "folder".to_string(),
                        folder_id: Some(folder_id.clone()),
                        status: "finished".to_string(),
                        count: Some(count),
                        error: None,
                    },
                );
                let _ = app.emit("dashboard-data-changed", ());
            }
            Err(_) => {
                let _ = app.emit(
                    "scan-status",
                    ScanStatusEvent {
                        scope: "folder".to_string(),
                        folder_id: Some(folder_id.clone()),
                        status: "failed".to_string(),
                        count: None,
                        error: Some("Scan panicked".to_string()),
                    },
                );
            }
        }

        scan_running.store(false, Ordering::SeqCst);
    });

    Ok(())
}

#[tauri::command]
pub fn restart_watcher(state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    watcher.start(&config, state.db.clone(), state.config.clone())?;
    Ok(())
}

#[tauri::command]
pub fn stop_watcher(state: State<AppState>) -> Result<(), String> {
    let mut watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    watcher.stop();
    Ok(())
}

#[tauri::command]
pub fn get_watcher_status(state: State<AppState>) -> Result<bool, String> {
    let watcher = state.watcher.lock().map_err(|e| e.to_string())?;
    Ok(watcher.is_running())
}
