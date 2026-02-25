use tauri::State;

use crate::scheduler;
use super::AppState;

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
pub fn scan_now(state: State<AppState>) -> Result<(), String> {
    let config = state.config.lock().map_err(|e| e.to_string())?;
    scheduler::scan_existing_files(&config, &state.db);
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
